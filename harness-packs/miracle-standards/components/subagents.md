# Miracle standards: subagents

Delegate when the work is separable and the result can be checked. Keep one owner
for the claimed item: the main agent.

## Roster

| Subagent | Use it for | Must not |
|---|---|---|
| `explorer` | Finding where behaviour lives in an unfamiliar repo | Edit files |
| `implementer` | A bounded change inside files the item names | Touch CI, deps, or schema |
| `test-writer` | Tests that encode the item's acceptance criteria | Weaken an assertion to pass |
| `reviewer` | Pre-PR review against the Miracle PR checklist | Approve anything |

## Rules

1. Every delegation carries the item handle, the acceptance criteria, and the file scope.
2. Subagents inherit the guardrails. A subagent cannot commit.
3. The main agent verifies a subagent's output by running tests, never by trusting the report.
4. Delegation does not transfer accountability: the claimed item stays with the main agent.
