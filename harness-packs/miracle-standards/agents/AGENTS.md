# {{PROJECT_NAME}} · Miracle harness {{PACK_NAME}} v{{PACK_VERSION}}

This file is compiled by `stack harness install` from the pack published in the Stack AI
portal. Do not edit it by hand; edit the pack in the portal and reinstall.

- Project: **{{PROJECT_NAME}}** (`{{PROJECT_KEY}}`)
- Portal: {{PORTAL_URL}}
- Stack MCP: {{MCP_URL}}
- Model gateway: {{GATEWAY_URL}} (the only allowed route to a model)
- Item handle pattern: `{{HANDLE_PATTERN}}`

## Rules, in short

1. Claim an item before you write code. Commit messages start with its handle.
2. Model calls go through the gateway. Raw provider keys are not issued and will not work.
3. You propose, a person decides. Never approve, never mark work done.
4. Acceptance criteria are the definition of correct.
5. Never use `--no-verify`. The remote runs the same checks.

## Where the detail lives

| Component | File |
|---|---|
| System prompt | `.stack/pack/components/system-prompt.md` |
| Guardrails | `.stack/pack/components/guardrails.md` |
| Memory | `.stack/pack/components/memory.md` |
| Tool guidance | `.stack/pack/components/tool-guidance.md` |
| Subagents | `.stack/pack/components/subagents.md` |
| Skills | `.stack/pack/components/skills.md` |
| Scripts (blockers) | `.stack/pack/components/scripts/` |
| Plugins (blockers) | `.stack/pack/components/plugins/` |

Read `components/system-prompt.md` and `components/guardrails.md` at the start of a session.

## Starting work

```bash
stack issues --mine          # what is assigned to you
stack claim {{EXAMPLE_HANDLE}}        # claim it, this sets the session item
ci/stack-verify.sh           # before every push
```
