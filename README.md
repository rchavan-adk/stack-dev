# Stack AI — the delivery system of record

Stack AI is the delivery system of record for AI-assisted engagements: it holds the
templates every issue must match, the approvals only humans can give, and the evidence
behind every status change — while never seeing a line of client code. Planners run
waves through the portal, developers pull assigned work into their own IDE through the
`stack` CLI and the MCP server, and git events (pushes, merges) — not claims — move the
cards.

## Quick start

```bash
npm run setup          # install, create schema, seed the mock data
npm run install:cli    # put `stack` on your PATH (a copy — re-run it after CLI changes)

npm run dev:portal     # terminal 1 — portal at http://localhost:4200
npm run dev:mcp        # terminal 2 — MCP server at http://localhost:4300/mcp
```

Then open http://localhost:4200, pick a persona, and sign in.

## Demo credentials (creds card)

Everything below is **mock-only, deterministic, and reseeded by `npm run db:seed`** —
built for the demo, safe to paste on screen.

### One-click login — /login (no passwords)

| Persona | Email | Role |
|---|---|---|
| Priya Nair | priya.nair@miraclesoft.com | ADMIN |
| Akash Rao | akash.rao@miraclesoft.com | LEAD |
| Rahul Chavan | rahul.chavan@miraclesoft.com | DEVELOPER |
| Meera Iyer | meera.iyer@miraclesoft.com | DEVELOPER |
| Vikram Rao | vikram.rao@miraclesoft.com | DEVELOPER |
| Sana Kulkarni | sana.kulkarni@miraclesoft.com | DEVELOPER |
| Dan Whitfield | dan.whitfield@acmeretail.com | CLIENT |

Dan the client is **UI-only** — read-only dashboards and evidence, no API token.

### API tokens — for the CLI and agents (`stack login --token <token>`)

| Owner | Role | Token |
|---|---|---|
| Priya Nair | ADMIN | `stk_adm_priya_demo_token_0001` |
| Akash Rao | LEAD (scoped to ACME) | `stk_lead_akash_demo_token_001` |
| Rahul Chavan | DEVELOPER | `stk_dev_rahul_demo_token_0001` |
| Meera Iyer | DEVELOPER | `stk_dev_meera_demo_token_0001` |
| Vikram Rao | DEVELOPER | `stk_dev_vikram_demo_token_0001` |
| Sana Kulkarni | DEVELOPER | `stk_dev_sana_demo_token_0001` |

## Demo walkthrough

Each step: persona → surface → command or click → what to expect. The full script was
replayed end-to-end against the mock stack; the outputs below are what it produces.

1. **Everyone → `/login`** — click a persona. Seven personas are listed, straight from
   the database; the session cookie takes you to that persona's dashboard.
2. **Akash (lead) → terminal, in a clone of the repo** —
   `stack login --token stk_lead_akash_demo_token_001`, then `stack project detect`
   (matches **ACME**), `stack harness install` (miracle-standards 0.2.0, hooks armed),
   `stack mcp install --agent opencode` (writes `opencode.json`), `stack doctor`
   (6/7 green — nothing claimed yet).
3. **Akash → `/admin/harness`** — publish the updated pack: clone the 0.3.0 draft to a
   new draft, publish. `GET /api/projects/ACME/harness/current` then returns
   **0.3.0 PUBLISHED** with a freshly stamped checksum.
4. **Sana (cold developer) → terminal** — `stack login --token stk_dev_sana_demo_token_0001`
   (zero projects, hint to install the default harness), `stack harness install`
   (miracle-default 0.2.0), `stack doctor` — all green.
5. **Akash → `/admin/settings`** — add Sana to ACME as DEVELOPER. **Sana → terminal** —
   `stack project link ACME`, `stack harness install` (pack switch: miracle-default
   0.2.0 → **miracle-standards 0.3.0**), `stack harness status` shows 0.3.0, doctor green.
6. **Akash → MCP (JSON-RPC over HTTP)** — `stack_template_get` for the ISSUE kind
   (sections context/scope/acceptance/out-of-scope, fields type/estimate/wave, ≥2
   acceptance criteria), then `stack_issue_create` — expect a new **BACKLOG** item with
   a STACK-1xx handle.
7. **Akash → the issue page** — Approve, assign Sana. `GET /api/issues/<HANDLE>` with
   Sana's token shows **APPROVED**, assignee Sana Kulkarni.
8. **Sana → terminal, in her clone** — `stack issues --mine` (the item is there),
   `stack claim <HANDLE>` (**IN_PROGRESS**), then the commit-hook story: a handleless
   commit is **rejected by the commit-msg hook**; `STACK-<n>: …` passes.
9. **Sana → git** — push branch `stack/<HANDLE>-demo`: the mock remote's post-receive
   moves the card to **IN_REVIEW**; merge it (`bash mock-github/merge.sh stack/<HANDLE>-demo`)
   → **AWAITING_VALIDATION**.
10. **Priya (admin) → the issue page** — Validate with a note → card **DONE** with a
    VALIDATED event; the evidence ledger shows commit → push → merge → validated, actor
    by actor.
11. **The bypass story** — `git commit --no-verify` without a handle, then push: the
    **remote pre-receive rejects it**. Local hooks teach; the server decides.

### The live GitHub steps

The mock remote stands in for GitHub in the demo; the real one takes over the same
webhooks. This project's portal is deployed at
`https://d35dllf97gy9iv.cloudfront.net`, so GitHub can reach it directly and no
tunnel is needed. A locally run portal still has to be exposed:
`ngrok config add-authtoken <token>` (ngrok is installed via Homebrew), then
`ngrok http 4200`.

1. **Create the GitHub repo** for the engagement on github.com.
2. **Register the project** at `/projects/new` with the repo URL **and** the portal's
   public URL (the webhook base URL).
3. **Create the GitHub App** from the wizard's link at
   `/projects/<KEY>/github-setup` — the manifest is prefilled (webhook URL, secret,
   redirect back to the portal; generate the webhook secret from the wizard if the repo
   has none).
4. **Install the app on the repo** — read-only contents/pull_requests/metadata is all
   it needs.
5. **Watch for the ping** — the first delivery lands in the project's evidence ledger.

## OpenCode + the Stack MCP server

Wire the MCP server into opencode (remote, bearer-token auth):

```json
{
  "mcp": {
    "stack": {
      "type": "remote",
      "url": "http://localhost:4300/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer stk_lead_akash_demo_token_001"
      }
    }
  }
}
```

Or let the CLI write it: `stack mcp install --agent opencode` (also `--agent droid` or
`--agent claude`; `--mode local` for a stdio server). The CLI masks the token in its
output; the config file embeds the real one — keep it out of commits.

## Architecture

```
mock-github/acme-checkout.git   (bare repo, stands in for github.com)
  hooks/pre-receive   → the required status check: handle policy + branch protection
  hooks/post-receive  → the read-only GitHub App webhook: pushes/merges move the cards
  merge.sh            → the "Merge pull request" button

cli/stack            stack — login, project detect/link, harness install/status,
                     mcp install, issues/claim, doctor, verify
apps/portal          Next.js 15 (port 4200) — dashboards, admin, waves, issues,
                     harness packs, GitHub App wizard, git event + webhook receivers
apps/mcp             MCP server (port 4300) — 17 tools over streamable HTTP,
                     token-scoped (whoami, issues, waves, templates, harness, specs)
packages/core        shared domain: statuses, transitions, templates, tokens
packages/db          Prisma schema + seed (PostgreSQL) — the system of record
harness-packs/       miracle-standards source pack (guiders + blockers)
deploy/              AWS deployment (ECS Fargate + ALB + CloudFront + RDS),
                     provisioning scripts and teardown
```

### Real vs mocked — honestly

| Real | Mocked or demo-only (local) |
|---|---|
| Git evidence: pushes, merges, hook rejections, the evidence ledger | The GitHub side: a local bare repo, not github.com (until the App is installed) |
| Local hooks (commit-msg, pre-push) and remote enforcement (pre-receive) | Login personas and demo tokens: deterministic seed data, hidden in production |
| Template enforcement, approvals, wave planning, MCP tool surface and role scoping | — |

### Enforcement, in one line each

- **Local hooks teach** — the commit-msg hook explains the handle rule and fixes the message shape.
- **The server decides** — status moves on git evidence (push → IN_REVIEW, merge → AWAITING_VALIDATION), never on a claim; `--no-verify` changes nothing because the remote runs the same checks.
- **Humans own the two human-only transitions** — BACKLOG → APPROVED and AWAITING_VALIDATION → DONE are person-only; the MCP refuses them, and validation is the only route to Done.
