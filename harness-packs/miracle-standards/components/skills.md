# Miracle standards: skills

## Skill: commit

1. Stage only files related to the claimed item.
2. Message format: `<HANDLE>: <imperative summary under 72 chars>`.
3. Body, when the change needs context: what changed, why, and the acceptance criterion it serves.
4. Never bypass hooks.

## Skill: pull request

Title: `<HANDLE>: <summary>`. Body sections, all required by the Miracle PR template:

```
## What changed
## Why
## Acceptance criteria
- [ ] criterion, each one checked against the item
## Evidence
commands run, tests passed, screenshots when UI changed
## Risk and rollback
```

Open the PR, then report status through MCP. Do not self-merge.

## Skill: verify before push

Run, in order: the project's install, lint, test commands, then `ci/stack-verify.sh`.
Paste the output summary into the PR Evidence section.

## Skill: wave awareness

An item belongs to a wave. Before proposing extra work, check the wave goal with
`stack_wave_list`. Work that does not serve the current wave goes back to the portal
as a proposed item, never into the current branch.
