#!/usr/bin/env bash
#
# merge.sh <branch> [--no-ff]
#
# Stands in for the "Merge pull request" button. It clones the bare repo into a
# temporary directory, merges the branch into main there, and pushes main back
# with STACK_MERGE=1, which is the only thing the pre-receive hook accepts as a
# legitimate move of a protected branch.
#
#   bash mock-github/merge.sh stack/STACK-101-rounding           # fast-forward
#   bash mock-github/merge.sh stack/STACK-101-rounding --no-ff   # merge commit
#
# The post-receive hook then posts action:"merge" to the portal, which moves the
# item to AWAITING_VALIDATION.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BARE="$ROOT/acme-checkout.git"
WORK="$ROOT/workspace/acme-checkout"
BRANCH="${1:-}"
MODE="${2:-}"

say() { printf '%s\n' "$*"; }

if [ -z "$BRANCH" ]; then
  cat >&2 <<EOF
usage: bash mock-github/merge.sh <branch> [--no-ff]

  <branch>   the feature branch to merge into main, as it exists on the remote
  --no-ff    create a merge commit instead of fast-forwarding
EOF
  exit 2
fi

if [ ! -d "$BARE" ]; then
  say "no bare repo at $BARE"
  say "run: bash mock-github/init.sh"
  exit 1
fi

if ! git -C "$BARE" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  say "no branch '$BRANCH' on the remote. Branches that exist:"
  git -C "$BARE" for-each-ref --format='  %(refname:short)' refs/heads/ >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/stack-merge.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

git clone --quiet "$BARE" "$TMP/repo"
cd "$TMP/repo"
git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
git switch --quiet main

BASE="$(git rev-parse HEAD)"
say ""
say "merging $BRANCH into main"
say ""
say "  commits coming in"
git log --oneline "$BASE..origin/$BRANCH" | sed 's/^/    /'
say ""

if [ "$MODE" = "--no-ff" ]; then
  # a merge commit needs an identity; reuse the one the mock workspace uses
  IDENT_NAME="$(git -C "$WORK" config user.name 2>/dev/null || true)"
  IDENT_EMAIL="$(git -C "$WORK" config user.email 2>/dev/null || true)"
  if [ -z "$IDENT_NAME" ] || [ -z "$IDENT_EMAIL" ]; then
    IDENT_NAME="${IDENT_NAME:-Stack Demo Developer}"
    IDENT_EMAIL="${IDENT_EMAIL:-demo@stack.local}"
    say "  no identity on the mock workspace, merging as $IDENT_NAME <$IDENT_EMAIL>"
  fi
  git config user.name "$IDENT_NAME"
  git config user.email "$IDENT_EMAIL"
  git merge --no-ff --quiet -m "Merge branch '$BRANCH' into main" "origin/$BRANCH"
  say "  merged with a merge commit: $(git rev-parse --short HEAD)"
else
  git merge --ff-only --quiet "origin/$BRANCH"
  say "  fast-forwarded main to $(git rev-parse --short HEAD)"
fi

say "  pushing main with STACK_MERGE=1 (the pre-receive hook only allows that)"
STACK_MERGE=1 git push --quiet origin main

say ""
say "main is now $(git rev-parse --short HEAD) on the remote"
if [ -d "$WORK/.git" ]; then
  say ""
  say "  your clone is behind, catch up with:"
  say "    git -C $WORK switch main && git -C $WORK pull --ff-only"
  say "  delete the branch when you are done with it:"
  say "    git -C $WORK push origin --delete $BRANCH"
fi
say ""
