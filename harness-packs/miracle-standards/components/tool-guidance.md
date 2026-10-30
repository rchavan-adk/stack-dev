# Miracle standards: tool guidance

## Stack MCP server

| Need | Tool |
|---|---|
| Who am I, what can I do | `stack_whoami` |
| My assigned work | `stack_issue_list` with `mine: true` |
| Full item, spec, acceptance criteria | `stack_issue_get` |
| Take an item | `stack_issue_claim` |
| Report progress | `stack_issue_report_status` |
| Wave context | `stack_wave_list` |
| Current team harness | `stack_harness_current` |
| Issue or spec template | `stack_template_get` |

Pull work through MCP rather than asking the developer to paste a ticket. If a tool
returns a template violation, fix the submission and retry; do not work around it.

## Git

- Branch from the default branch: `git switch -c stack/<handle>-<slug>`.
- One logical change per commit, message starting with the item handle.
- Never `--no-verify`. The hooks exist to stop broken work early, and the server
  re-runs the same checks on push, so bypassing locally only wastes a round trip.

## Shell

- Prefer repository scripts over ad hoc commands: `ci/stack-verify.sh` before every push.
- Never run a command that deletes untracked files.
- Keep network access to the gateway, the portal, and the client's git remote.
