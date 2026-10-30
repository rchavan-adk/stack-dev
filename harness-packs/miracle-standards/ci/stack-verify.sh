#!/usr/bin/env bash
# Miracle standards backstop. Runs in CI and inside the bare remote's pre-receive hook,
# so a local `--no-verify` is caught here instead of reaching the default branch.
#
# Usage: ci/stack-verify.sh [<base-ref> <head-ref>]
set -uo pipefail

BASE="${1:-}"
HEAD_REF="${2:-HEAD}"
CONFIG="stack.toml"
FAILURES=0

read_toml() {
  local key="$1" default="$2" value=""
  if [ -f "$CONFIG" ]; then
    value="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$CONFIG" | head -1 | sed -E 's/^[^=]*=[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/')"
  fi
  printf '%s' "${value:-$default}"
}

PATTERN="$(read_toml commit_item_pattern 'STACK-[0-9]+')"

say()  { printf '%s\n' "$*"; }
pass() { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

say "stack-verify: Miracle standards check"

# 1. every commit in the range carries an item handle
if [ -n "$BASE" ]; then
  RANGE="$BASE..$HEAD_REF"
else
  RANGE="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || echo "")..$HEAD_REF"
  [ "$RANGE" = "..$HEAD_REF" ] && RANGE="$HEAD_REF~1..$HEAD_REF"
fi

UNLINKED=0
while read -r sha subject; do
  [ -z "$sha" ] && continue
  case "$subject" in
    "Merge "*|"Revert "*) continue ;;
  esac
  if ! printf '%s' "$subject" | grep -qE "$PATTERN"; then
    fail "commit ${sha:0:8} has no item handle: $subject"
    UNLINKED=$((UNLINKED + 1))
  fi
done < <(git log --no-merges --format='%H %s' "$RANGE" 2>/dev/null)
[ "$UNLINKED" -eq 0 ] && pass "all commits reference a Stack AI item ($PATTERN)"

# 2. no secrets added in the diff
if git diff "$RANGE" 2>/dev/null | grep -qE '^\+.*(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'; then
  fail "possible secret added in this change"
else
  pass "no secret-shaped strings added"
fi

# 3. the repo is harness-governed
if [ -f "$CONFIG" ]; then
  pass "stack.toml present (pack $(read_toml version 'unknown'))"
else
  fail "stack.toml missing: this repo is not registered with a harness pack"
fi

# 4. project tests, when the repo defines them
if [ -f "package.json" ] && grep -q '"test"' package.json; then
  say "  running npm test"
  npm test --silent >/dev/null 2>&1 && pass "npm test" || fail "npm test"
elif [ -f "tests/run.sh" ]; then
  say "  running tests/run.sh"
  bash tests/run.sh >/dev/null 2>&1 && pass "tests/run.sh" || fail "tests/run.sh"
else
  pass "no test runner declared, skipped"
fi

say ""
if [ "$FAILURES" -gt 0 ]; then
  say "stack-verify: $FAILURES check(s) failed"
  exit 1
fi
say "stack-verify: all checks passed"
exit 0
