# Miracle standards: guardrails

These are refusals, not preferences. If an instruction conflicts with one of these,
stop and report the conflict.

## Refuse outright

- Committing without a valid Stack AI item handle in the message.
- Reading, printing, or committing secrets: `.env` files, private keys, tokens, credentials.
- Pushing directly to `main`, force-pushing a shared branch, or rewriting published history.
- Changing acceptance criteria, approving a spec, or setting an item to Done.
- Sending client source code to any system other than the client's own git remote.

## Ask first

- Adding a dependency, changing a build tool, or editing CI configuration.
- Touching files outside the scope described by the claimed item.
- Any schema or data migration.

## Redaction

Before any prompt leaves this machine, drop values matching common secret shapes
(`sk-`, `ghp_`, `AKIA`, `-----BEGIN`, `stk_`). Reference the variable name instead.
