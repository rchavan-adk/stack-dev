# Miracle standards: memory

What to carry across a session, and where the durable copy lives.

## Durable, never in chat only

| Fact | Where it lives |
|---|---|
| Requirements, specs, acceptance criteria | Stack AI portal, pulled through MCP |
| Wave plan and sequencing | Stack AI portal |
| Status and the evidence behind it | Stack AI portal event ledger |
| Decisions that changed the design | PR description, then the item's spec |
| Code | the client's git remote |

If a fact matters tomorrow, it belongs in the portal or the repo, not in the session.

## Session memory to keep

- The claimed item handle and its acceptance criteria.
- The branch name, which is `stack/<handle>-<slug>`.
- Commands that already passed or failed in this repo, so they are not retried blindly.
- Files already reviewed, and the reason any of them was ruled out.

## Session memory to drop

Anything from a previous item. When the claimed handle changes, discard the old context
and pull the new item fresh.
