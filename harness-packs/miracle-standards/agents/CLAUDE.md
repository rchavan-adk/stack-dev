# {{PROJECT_NAME}} · Stack AI project guidance

This file is compiled by `stack harness install` from the project harness published
in the Stack AI portal. Do not edit it by hand; edit the project harness and reinstall.

## Project context

- Project: **{{PROJECT_NAME}}** (`{{PROJECT_KEY}}`)
- Portal: {{PORTAL_URL}}
- Stack MCP: {{MCP_URL}}
- Item handle pattern: `{{HANDLE_PATTERN}}`

## Required workflow

1. Read the claimed item through Stack MCP before changing code.
2. Claim the item before writing code:

   ```bash
   stack issues --mine
   stack claim {{EXAMPLE_HANDLE}}
   ```

3. Keep every commit tied to the claimed item. Commit messages start with its handle.
4. Use the acceptance criteria as the definition of correct.
5. Run the project checks and `ci/stack-verify.sh` before opening a pull request.
6. Report progress through Stack MCP and wait for a person to validate the result.

## Guardrails

- You may propose; a person approves specifications and validates completion.
- Never mark work done or approve a specification yourself.
- Never use `--no-verify`.
- Do not edit generated `CLAUDE.md` or `AGENTS.md` by hand. Change the published project
  harness instead.

## Read next

Read these files at the start of the work session:

- `.stack/pack/components/system-prompt.md`
- `.stack/pack/components/guardrails.md`
- `.stack/pack/components/tool-guidance.md`
