# {{PROJECT_NAME}} · Miracle harness {{PACK_NAME}} v{{PACK_VERSION}}

This file is compiled by `stack harness install` from the pack published in the Stack AI
portal. Do not edit it by hand; edit the pack in the portal and reinstall.

- Project: **{{PROJECT_NAME}}** (`{{PROJECT_KEY}}`)
- Portal: {{PORTAL_URL}}
- Stack MCP: {{MCP_URL}}
- Item handle pattern: `{{HANDLE_PATTERN}}`

## Rules, in short

1. Claim an item before you write code. Commit messages start with its handle.
2. You propose, a person decides. Never approve, never mark work done.
3. Acceptance criteria are the definition of correct.
4. Never use `--no-verify`. The remote runs the same checks.

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

Read `components/system-prompt.md` and `components/guardrails.md` at the start of a session.

## Starting work

```bash
stack issues --mine          # what is assigned to you
stack claim {{EXAMPLE_HANDLE}}        # claim it, this sets the session item
ci/stack-verify.sh           # before every push
```
