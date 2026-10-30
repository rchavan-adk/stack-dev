# @stack/gateway — the real model gateway

Port 4400. This is the real counterpart of the portal's policy endpoint
(`apps/portal/app/api/gateway/model-call`): same allowlist, same prices, same
budget math, same evidence ledger — but the request is actually forwarded to
the Anthropic Messages API and metered from the response's real `usage`,
not self-reported token counts.

```
agent ──> POST :4400/v1/messages ──> policy checks ──> api.anthropic.com/v1/messages
              x-api-key: <stack token>                   x-api-key: <real Anthropic key>
              x-stack-item: STACK-110
```

## Endpoints

| Route | What it does |
| --- | --- |
| `POST /v1/messages` | Anthropic Messages proxy (JSON and SSE `stream: true`), with Stack auth, item attribution, allowlist, routing, budget and metering. |
| `GET /health` | `{ ok, gateway, provider, providerConfigured, allowlist, routed, requireItem }` — shape-compatible with the portal health route (`gateway`, `allowlist`). |

## Auth

Send the Stack token (the one `stack login` stores) as either:

- `x-api-key: stk_dev_...`, or
- `Authorization: Bearer stk_dev_...`

Only the sha256 of a token is stored server-side (same scheme as the MCP
server). Scoped tokens carry their project. Admin (unscoped) tokens must
add `X-Stack-Project: ACME` and are still checked for project membership.

## Item attribution

Every call must carry an item handle, via either:

- `X-Stack-Item: STACK-110` (what agents should send), or
- `metadata.user_id: "STACK-110"` in the request body — the standards-shaped
  fallback for clients that cannot set custom headers.

The handle must exist and belong to the token's project. Calls without one are
refused (`STACK_GATEWAY_REQUIRE_ITEM=false` disables this for local tests;
the portal policy endpoint keeps enforcing it regardless).

## Policy order

1. **Allowlist** — the engagement plan (`MODEL_ALLOWLIST` in
   `packages/core/src/gateway.ts`, shared with the portal).
2. **Routing** — an allowlisted model this deployment holds no credentials for
   (e.g. `gpt-*` with only an Anthropic key) is refused with a clear reason
   instead of failing obscurely upstream.
3. **Item attribution** — unknown or cross-project handles are refused.
4. **Budget** — a call is refused when the engagement is already at budget.
   Cost is metered after the call from real usage, so the ledger can show a
   small overage on the call that crossed the line; the *next* call is then
   refused. (The portal mock could pre-check because agents self-reported
   tokens; a real proxy cannot know the cost before forwarding.)

Denials are ledgered exactly like the portal mock: a `ModelCall` row
(`allowed: false`, `reason`) plus a `MODEL_CALL` Event with the deny summary.
Allowed calls are a `ModelCall` row with real `tokensIn/tokensOut/costUsd`
(spend pages read these; no Event row, matching the mock's ledger shape).

Responses carry `x-stack-item`, `x-stack-cost-usd`, `x-stack-spend-usd`, and
`x-stack-budget-warning` when under 20 percent of budget remains.

## Pricing

Per-token prices come from the shared table. Cache tokens
(`cache_creation_input_tokens`, `cache_read_input_tokens`) are metered at the
plain input rate — writes actually cost 1.25x and reads 0.1x upstream; keeping
one shared formula outranks the rounding for now.

## Model names

The allowlist holds *engagement* model names (what the contract allows and how
it is priced). Providers have their own IDs on their own schedule, so
`src/models.ts` maps between them: `claude-sonnet-5 → claude-sonnet-4-5`,
`claude-haiku-4.5 → claude-haiku-4-5`. The ledger and the allowlist keep the
engagement name; only the upstream call uses the provider ID. Override per
deployment with `STACK_MODEL_MAP="claude-haiku-4.5=claude-haiku-4-5"`.

## Env

`apps/gateway/.env` (written by `scripts/write-env.mjs`):

- `DATABASE_URL` — SQLite path (Postgres after the migration phase)
- `STACK_GATEWAY_PORT` — 4400
- `STACK_GATEWAY_REQUIRE_ITEM` — default `true`

`ANTHROPIC_API_KEY` lives only in the gitignored `secrets/.env` at the repo
root (or `apps/gateway/.env`); `src/env.ts` loads it. Without it the gateway
starts and serves `/health` with `providerConfigured: false`, and model calls
answer 503 rather than silently pretending to work.

## Pointing agents at it

```bash
npm run dev:gateway
```

opencode provider (`opencode.json`):

```json
{
  "provider": {
    "stack-claude": {
      "npm": "@anthropic-ai/sdk",
      "options": { "apiKey": "{env:STACK_TOKEN}", "baseURL": "http://localhost:4400" },
      "models": { "claude-haiku-4.5": {} }
    }
  }
}
```

Claude Code: `ANTHROPIC_BASE_URL=http://localhost:4400` and
`ANTHROPIC_AUTH_TOKEN=<stack token>` (sent as `Authorization: Bearer`).

The harness pack's `gateway-only` plugin already blocks model traffic that does
not go through the project's `gatewayUrl` (seeded to `http://localhost:4400`
and written into `stack.toml` by `stack harness install`).

## Smoke tests

Free (no spend — each expects an Anthropic-shaped error JSON):

```bash
curl -s localhost:4400/health

# 401 unknown token
curl -s -X POST localhost:4400/v1/messages -H 'x-api-key: stk_dev_wrong' \
  -H 'content-type: application/json' -d '{"model":"claude-haiku-4.5","max_tokens":1}'

# 400 missing item handle
curl -s -X POST localhost:4400/v1/messages -H 'x-api-key: <token>' \
  -H 'content-type: application/json' -d '{"model":"claude-haiku-4.5","max_tokens":1}'

# 403 off-allowlist / unrouted
curl -s -X POST localhost:4400/v1/messages -H 'x-api-key: <token>' -H 'x-stack-item: STACK-110' \
  -H 'content-type: application/json' -d '{"model":"gpt-4o","max_tokens":1}'
```

Real (tiny spend, metered into the ledger):

```bash
curl -s -X POST localhost:4400/v1/messages -H 'x-api-key: <token>' -H 'x-stack-item: STACK-110' \
  -H 'content-type: application/json' \
  -d '{"model":"claude-haiku-4.5","max_tokens":16,"messages":[{"role":"user","content":"Reply with the single word OK."}]}'
```

Streaming works the same way with `"stream": true`; usage is parsed from the
SSE events (`message_start` / `message_delta`) and metered when the stream
ends, even if the client disconnects early.
