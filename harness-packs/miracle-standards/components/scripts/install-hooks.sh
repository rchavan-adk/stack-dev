#!/usr/bin/env bash
# Installs the pack's blockers into .git/hooks. Run from the repository root,
# or let `stack harness install` call it for you.
set -euo pipefail

PACK_DIR="${1:-.stack/pack}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_DIR="$REPO_ROOT/.git/hooks"

mkdir -p "$HOOK_DIR"

for hook in commit-msg pre-push; do
  src="$REPO_ROOT/$PACK_DIR/components/scripts/$hook"
  if [ ! -f "$src" ]; then
    echo "missing hook source: $src" >&2
    exit 1
  fi
  cp "$src" "$HOOK_DIR/$hook"
  chmod 755 "$HOOK_DIR/$hook"
  echo "installed .git/hooks/$hook"
done

echo "hooks installed from $PACK_DIR"
