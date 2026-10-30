# mock-github

A GitHub-shaped remote for the Stack AI demo, small enough to run on a laptop and
honest about what each piece stands in for.

```bash
bash mock-github/init.sh          # idempotent, safe to re-run
cd mock-github/workspace/acme-checkout
```

## What each piece stands in for

| Here | In the real system |
|---|---|
| `acme-checkout.git` (bare repo) | the repository on github.com |
| `hooks/pre-receive` | the required status check on the default branch (branch protection + commit policy), enforced by the server, not the laptop |
| `hooks/post-receive` | the read-only GitHub App webhook the portal installed; it observes pushes and merges and moves the card |
| `merge.sh` | the "Merge pull request" button |
| `workspace/acme-checkout` | a developer's clone |
| `ci/stack-verify.sh` (in the harness pack) | the same checks running in CI on a pull request |

Nothing here talks to GitHub. The point is that the rules are enforced *outside*
the developer's machine, so `git commit --no-verify` and
`git push --no-verify` change nothing: the remote runs the same checks.

## The bare repo

`mock-github/acme-checkout.git` is created by `init.sh`, with `main` as its
default branch. `init.sh` also writes `stack-portal-url` inside it, so the hooks
know which portal to call; override it with `PORTAL_URL=http://host:4200 bash mock-github/init.sh`.

## `hooks/pre-receive`

Runs on every push and rejects it when:

1. **a pushed commit has no item handle.** The subject must match
   `STACK-[0-9]+` (or `STACK_HANDLE_PATTERN`). The message is the same shape as
   the client-side `commit-msg` hook installed by `stack harness install`, so a
   developer who stripped the local hook sees the identical rejection.
2. **the push targets a protected branch** (`main`, `master`, `release`, or
   `STACK_PROTECTED_BRANCHES`). Creating a branch for the first time is allowed
   (that is how `init.sh` seeds `main`), and so is `STACK_MERGE=1`, which only
   `merge.sh` sets.

Merge commits and reverts are exempt from the handle rule, exactly like the
client hook.

## `hooks/post-receive`

Reads the pushed ref and commits and posts them to the portal:

```json
{ "repo": "acme-checkout", "action": "push",  "branch": "stack/STACK-101-rounding", "commits": [ { "sha": "…", "message": "…", "author": "…" } ] }
{ "repo": "acme-checkout", "action": "merge", "branch": "main",                     "commits": [ … ] }
```

* a feature branch push sends `action: "push"` and the portal moves the item to
  `IN_REVIEW`
* a push to a protected branch sends `action: "merge"` and the portal moves the
  item to `AWAITING_VALIDATION`
* `STACK_PR=<n>` adds `prNumber` to the payload (the demo has no real PRs, so it
  is optional)

It calls `curl` with a 4 second timeout, prints what it sent and what the portal
answered, and **never fails the push**: a portal that is down must not block a
developer. The portal's reply is what shows the card moving:

```
  post-receive  acme-checkout  action=push  branch=stack/STACK-101-rounding  commits=1
  post-receive  -> POST http://localhost:4200/api/git/events
  post-receive  <- {"ok":true,"moved":[{"handle":"STACK-101","from":"IN_PROGRESS","to":"IN_REVIEW"}]}
```

## `merge.sh`

```bash
bash mock-github/merge.sh stack/STACK-101-rounding            # fast-forward
bash mock-github/merge.sh stack/STACK-101-rounding --no-ff    # merge commit
```

Clones the bare repo into a temporary directory, merges the branch into `main`
there, and pushes with `STACK_MERGE=1` so the pre-receive hook accepts the move.
The push then triggers `post-receive`, which tells the portal the work is ready
for a person to validate.

## The workspace

`mock-github/workspace/acme-checkout` is a real project: a checkout service with
a seeded rounding bug in `src/order.js` and a failing suite in `tests/run.sh`.

```bash
bash tests/run.sh     # fails until STACK-101 is fixed
npm test              # same thing
```

`main` is protected, so the demo flow is:

```bash
stack claim STACK-101
git switch -c stack/STACK-101-rounding
# fix src/order.js, then:
bash tests/run.sh
stack verify
git commit -m "STACK-101: round order totals to cents"
git push -u origin stack/STACK-101-rounding     # post-receive -> IN_REVIEW
bash mock-github/merge.sh stack/STACK-101-rounding   # post-receive -> AWAITING_VALIDATION
```

Generated state (`mock-github/*.git/`, `mock-github/workspace/`) is ignored by
the stack-ecosystem `.gitignore`, so `init.sh` never dirties the outer repository.
The workspace's own `.gitignore` keeps the installed `.stack/` directory out of
commits, while `stack.toml` and `AGENTS.md` are committed on purpose: they travel
with the code.
