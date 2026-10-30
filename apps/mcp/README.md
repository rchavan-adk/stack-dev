# Stack AI MCP server

The model-facing surface of the Stack AI delivery platform. Coding agents
(OpenCode, Claude Code, anything MCP-capable) authenticate with a portal-issued
API token, see exactly the tools their role allows, and every mutation they
make lands in the portal's evidence ledger.

Two transports, one server implementation:

| Transport | Entry | Use |
| --- | --- | --- |
| Streamable HTTP (stateless) | `src/http.ts` → `POST http://localhost:4300/mcp` | Remote agents, CI, the portal |
| stdio | `src/stdio.ts` | Local MCP servers launched by OpenCode |

## Running

```bash
# from the workspace root
npm run setup            # install + prisma db push + seed (once)
npm run dev:mcp          # http transport on http://localhost:4300/mcp (tsx watch)

# or directly
npm -w @stack/mcp run start      # same, no watch
npm -w @stack/mcp run stdio -- --token stk_dev_rahul_demo_token_0001
npm -w @stack/mcp run typecheck  # tsc --noEmit
```

Configuration lives in `apps/mcp/.env` and is loaded at startup (values already
present in the environment win):

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | SQLite file backing the Prisma client (`@stack/db`) |
| `STACK_SIGNING_SECRET` | HMAC secret for the short-lived harness download URLs |
| `STACK_PORTAL_URL` | Portal base URL, used for register/download links |
| `STACK_MCP_PORT` | HTTP transport port (default 4300) |

The seed prints deterministic demo tokens; the ones used in these docs:

```
ADMIN  stk_adm_priya_demo_token_0001
LEAD   stk_lead_akash_demo_token_001
DEV    stk_dev_rahul_demo_token_0001     (scoped to project ACME)
DEV    stk_dev_meera_demo_token_0001     (scoped to project ACME)
```

## Authentication

Tokens are issued by the portal (`stk_<role>_<random>`); only the SHA-256 hash
is stored. On every request the server:

1. reads the token from `Authorization: Bearer <token>` (HTTP) or
   `STACK_TOKEN` / `--token` (stdio),
2. looks up `ApiToken` by hash, rejecting unknown or revoked tokens,
3. stamps `lastUsedAt`,
4. builds a **fresh MCP server for that request** from the resolved context
   `{ token, user, role, projectId? }`.

Because a token's role decides which tools are registered, the tool list the
client sees is the enforcement itself — a DEVELOPER token literally has no
`stack_issue_create` to call. The role table lives in one place
(`TOOL_SPECS` + `ROLE_RANK` in `src/server.ts`), and `stack_whoami` reads the
same table when it lists the tools available to the token.

HTTP behavior:

- `POST /mcp` — Streamable HTTP, stateless (`sessionIdGenerator: undefined`),
  one fresh server per request. `GET`/`DELETE /mcp` answer with the documented
  `405` JSON-RPC error. Send one JSON-RPC message per POST: a bare
  `tools/list` or `tools/call` works without a handshake, because the server
  is stateless. Batching `initialize` together with a call in a single POST is
  rejected ("Only one initialization request is allowed") — the transport
  treats the batch as a second initialization.
- Missing/unknown token → HTTP `401` with a JSON-RPC error body.
- `GET /health` (no auth) → `{ "ok": true, "tools": 17, "transport": "streamable-http" }`.
- One stderr line per tool call: `timestamp [token-prefix] tool outcome` where
  outcome is `ok`, `refused` or `error`.

## OpenCode configuration

Remote mode (HTTP transport):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "stack": {
      "type": "remote",
      "url": "http://localhost:4300/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer stk_dev_rahul_demo_token_0001"
      }
    }
  }
}
```

Local mode (stdio transport, from the workspace root):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "stack": {
      "type": "local",
      "enabled": true,
      "command": ["npm", "-w", "@stack/mcp", "run", "stdio", "--", "--token", "stk_dev_rahul_demo_token_0001"]
    }
  }
}
```

The token can also be passed via `STACK_TOKEN` in the environment instead of
`--token`. Exits with a clear stderr message when no token is given.

## Tools

All tools return structured content (JSON with an `ok` flag) plus a short
human-readable text summary. Expected failures come back as `ok: false` with a
reason, not as protocol errors. "Project" arguments default to the token's
scope, or to your only visible project.

### Every role (CLIENT, DEVELOPER, LEAD, ADMIN)

| Tool | What it does |
| --- | --- |
| `stack_whoami` | User, role, token scope, visible projects with issue counts, and the tools this token may call |
| `stack_project_list` | Projects the token can see (ADMIN: all, others: memberships) |
| `stack_project_detect` `{ repoName?, remote? }` | Is this repo registered to a project? If not, the portal URL to register it |
| `stack_issue_list` `{ project?, mine?, status?, wave? }` | Issues with wave, assignee and parsed acceptance criteria |
| `stack_issue_get` `{ handle }` | Full issue: body, acceptance, spec, wave, last 20 evidence events |
| `stack_wave_list` `{ project? }` | Waves with issue counts per status |
| `stack_template_get` `{ kind }` | Active ISSUE/SPEC/WAVE template: definition + markdown skeleton |
| `stack_harness_current` `{ project? }` | Published pack name/version/checksum/components + `stack harness install` |
| `stack_harness_download_url` `{ project? }` | Short-lived signed URL (10 min) for the published harness tarball |
| `stack_spec_get` `{ handle? \| specId? }` | A spec by issue handle or id |

### DEVELOPER and above

| Tool | What it does |
| --- | --- |
| `stack_issue_claim` `{ handle }` | Assign yourself an APPROVED/IN_PROGRESS issue and move it to IN_PROGRESS; refuses anything already assigned to someone else or in another status |
| `stack_issue_report_status` `{ handle, status, note? }` | Move an issue along `ISSUE_TRANSITIONS`; refuses human-only moves (`BACKLOG→APPROVED`, `AWAITING_VALIDATION→DONE`) with "a person must do this in the portal" |
| `stack_evidence_append` `{ handle, summary, kind?, payload? }` | Append to the issue's evidence ledger (COMMIT, PR_OPENED, PR_MERGED, STATUS_REPORTED) |

### LEAD and ADMIN only

| Tool | What it does |
| --- | --- |
| `stack_issue_create` `{ project, title, body, type?, estimate?, waveId?, acceptance[], fields? }` | Creates a BACKLOG issue with the next handle in the project's sequence; validates against the active ISSUE template, refusing drafts with the violation list (and recording a TEMPLATE_REJECTED event) |
| `stack_wave_create` `{ project, name, goal, number?, startsOn?, endsOn?, acceptance?, fields? }` | Creates a PLANNED wave; `goal` is the markdown body and must follow the WAVE template |
| `stack_spec_submit` `{ project, title, body, issueHandle?, acceptance?, fields? }` | Submits a spec (SUBMITTED); body must follow the SPEC template |
| `stack_harness_publish` `{ project, packName, version, notes? }` | Publishes a DRAFT harness version: PUBLISHED status, publisher, timestamp, checksum |

Template notes for the create tools:

- Fetch the template first (`stack_template_get`, or the `stack://templates/*`
  resources) and follow its sections; a draft that misses them is refused with
  the exact violations and nothing is written.
- Acceptance criteria are taken from the `acceptance` argument, or extracted
  from the body's `Acceptance criteria` / `Exit criteria` checklist.
- `fields` carries anything else the active template requires (`type`,
  `estimate` and the wave label are derived automatically for issues;
  `shape` defaults to HORIZONTAL and `duration_weeks` is derived from the dates
  for waves; `author_role` defaults to PLANNER_AGENT for specs).

Every mutation writes an `Event` row (CLAIMED, STATUS_REPORTED,
HARNESS_INSTALLED, TEMPLATE_REJECTED), which is what the portal shows as the
evidence trail on an issue.

## Resources

| URI | Contents |
| --- | --- |
| `stack://templates/issue` | Active ISSUE template: JSON definition + markdown skeleton |
| `stack://templates/spec` | Same for the SPEC template |
| `stack://templates/wave` | Same for the WAVE template |
| `stack://project/{key}/context` | Project summary, open work by status, waves, gateway URL, handle pattern, published harness |
| `stack://harness/{key}/manifest` | Published pack manifest: version, checksum, components with paths and modes |

Resources are visibility-scoped the same way tools are: a project-scoped token
only sees its own project. URIs complete from the client (try `stack://project/…`).

## Prompts

| Prompt | Arguments | Output |
| --- | --- | --- |
| `start-issue` | `handle` | Workflow message: read the spec, restate the goal, commit with the handle, append evidence, never self-validate |
| `open-pull-request` | `handle` | The Miracle PR body skeleton: summary, changes, evidence, acceptance checklist, out of scope |

## Implementation notes

- `@stack/core` is imported through source subpaths (`@stack/core/src/...`)
  because tsx loads that package as CommonJS — named imports through its
  `export *` barrel fail at link time. This can go back to the barrel once the
  package declares `"type": "module"`.
- The published-pack checksum follows the seed's convention: `sha256` over the
  sorted `path:sha256(content)` lines, so versions published through MCP
  verify the same way as the seeded ones.
- No rows are created at import time; the seed owns all data.
