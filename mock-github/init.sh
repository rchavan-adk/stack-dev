#!/usr/bin/env bash
#
# init.sh — stand up the mock GitHub remote and the developer workspace.
#
# Idempotent: run it as often as you like. It creates
#   mock-github/acme-checkout.git              the bare repo that stands in for GitHub
#   mock-github/workspace/acme-checkout        the developer's clone, seeded with a real project
#
# The seed commit is pushed straight to main, which is only allowed because the
# branch does not exist yet. After this, main is protected and the pre-receive
# hook rejects direct pushes to it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BARE="$ROOT/acme-checkout.git"
WORK="$ROOT/workspace/acme-checkout"
REPO_NAME="$(basename "$BARE" .git)"
PORTAL_URL="${PORTAL_URL:-http://localhost:4200}"

say() { printf '%s\n' "$*"; }

say ""
say "mock-github: preparing the Stack AI demo remote"

# ---------------------------------------------------------------------------
# 1. the bare repo (stands in for github.com)
# ---------------------------------------------------------------------------
if [ ! -d "$BARE" ]; then
  git init --bare --initial-branch=main "$BARE" >/dev/null
  say "  created bare repo       $BARE"
else
  say "  bare repo already there $BARE"
fi

install -m 0755 "$ROOT/hooks/pre-receive" "$BARE/hooks/pre-receive"
install -m 0755 "$ROOT/hooks/post-receive" "$BARE/hooks/post-receive"
printf '%s\n' "$PORTAL_URL" > "$BARE/stack-portal-url"
say "  installed hooks         pre-receive, post-receive (0755)"
say "  portal for webhooks     $PORTAL_URL"

# ---------------------------------------------------------------------------
# 2. the developer's clone
# ---------------------------------------------------------------------------
if [ -d "$WORK/.git" ]; then
  say "  workspace already there $WORK"
  if git -C "$WORK" remote get-url origin >/dev/null 2>&1; then
    git -C "$WORK" remote set-url origin "$BARE"
  else
    git -C "$WORK" remote add origin "$BARE"
  fi
  git -C "$WORK" fetch --quiet origin >/dev/null 2>&1 || true
  say "  origin                  $BARE"
  say ""
  say "  nothing to seed, leaving your work alone"
  say ""
  exit 0
fi

mkdir -p "$WORK/src" "$WORK/tests"

cat > "$WORK/package.json" <<'EOF'
{
  "name": "acme-checkout",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Acme checkout service: order totals, used as the Stack AI demo repo",
  "scripts": {
    "test": "bash tests/run.sh"
  }
}
EOF

cat > "$WORK/src/order.js" <<'EOF'
/**
 * Acme checkout: order totals.
 *
 * Money rules this module is supposed to follow:
 *   1. every money value is rounded to whole cents
 *   2. the discount applies to the subtotal, before tax
 *   3. tax applies to the discounted subtotal
 *
 * STACK-101 is open because rule 1 and rule 2 are not implemented yet:
 * lineTotal() returns raw floating point arithmetic and orderTotal() applies
 * the tax before the discount. tests/run.sh asserts the documented behaviour.
 */

/** Price times quantity for one line item, in dollars. */
export function lineTotal({ price, quantity }) {
  return price * quantity;
}

/** Subtotal for a whole order, in dollars. */
export function subtotal(items) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

/**
 * Order total in dollars.
 * @param {Array<{price:number,quantity:number}>} items
 * @param {{taxRate?:number, discount?:number}} options taxRate is a fraction (0.0825 = 8.25%)
 */
export function orderTotal(items, { taxRate = 0, discount = 0 } = {}) {
  const base = subtotal(items);
  return base + base * taxRate - discount;
}
EOF

cat > "$WORK/tests/run.sh" <<'EOF'
#!/usr/bin/env bash
# Acme checkout tests: plain bash plus node asserts. Exits non-zero on failure.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

OUTPUT="$(
node --input-type=module - <<'NODE' 2>&1
import assert from "node:assert/strict";
import { lineTotal, orderTotal } from "./src/order.js";

const cases = [
  ["lineTotal rounds to whole cents", () => assert.equal(lineTotal({ price: 0.1, quantity: 3 }), 0.3)],
  ["lineTotal multiplies a normal line", () => assert.equal(lineTotal({ price: 19.99, quantity: 3 }), 59.97)],
  ["orderTotal rounds the taxed total", () => assert.equal(orderTotal([{ price: 19.99, quantity: 3 }], { taxRate: 0.0825 }), 64.92)],
  ["discount applies before tax", () => assert.equal(orderTotal([{ price: 100, quantity: 1 }], { discount: 10, taxRate: 0.1 }), 99)],
  ["an empty order is zero", () => assert.equal(orderTotal([]), 0)],
];

let failures = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}: ${String(error.message).split("\n")[0]}`);
  }
}
process.exit(failures === 0 ? 0 : 1);
NODE
)"
STATUS=$?

printf '%s\n' "$OUTPUT"
printf '\n'
if [ "$STATUS" -eq 0 ]; then
  printf 'tests/run.sh: all checks passed\n'
else
  printf 'tests/run.sh: the rounding bug in src/order.js is still there\n'
fi
exit "$STATUS"
EOF
chmod 0755 "$WORK/tests/run.sh"

cat > "$WORK/.gitignore" <<'EOF'
node_modules/
# installed by `stack harness install`, machine local, never committed
.stack/
EOF

cat > "$WORK/README.md" <<'EOF'
# acme-checkout

The checkout service Acme runs its order totals through. It is also the demo
repository for the Stack AI pilot: small enough to hold in your head, real
enough to have a bug worth fixing.

## Run the tests

```bash
bash tests/run.sh      # or: npm test
```

The suite currently **fails**. That is the point: `src/order.js` rounds nothing
and applies the discount after tax.

## Money rules

1. every money value is rounded to whole cents
2. the discount applies to the subtotal, before tax
3. tax applies to the discounted subtotal

## Working on it

```bash
stack project detect            # link this repo to the Acme project
stack harness install           # install the Miracle harness pack
stack issues --mine             # what is assigned to you
stack claim STACK-101           # claim the rounding bug, sets your session item
git switch -c stack/STACK-101-rounding
# ... fix src/order.js, run tests/run.sh, commit with the handle in the subject
stack verify                    # the same checks CI and the remote run
git push -u origin stack/STACK-101-rounding
```

`main` is protected. The remote's `pre-receive` hook rejects a direct push and
rejects any commit whose subject has no `STACK-<number>` handle, even when the
push used `--no-verify`. Merging is done with `bash mock-github/merge.sh <branch>`,
which stands in for the "Merge pull request" button.
EOF

# ---------------------------------------------------------------------------
# 3. identity: reuse whatever this environment already has configured
# ---------------------------------------------------------------------------
IDENT_NAME="$(git -C "$ROOT" config user.name 2>/dev/null || true)"
IDENT_EMAIL="$(git -C "$ROOT" config user.email 2>/dev/null || true)"
if [ -z "$IDENT_NAME" ] || [ -z "$IDENT_EMAIL" ]; then
  IDENT_NAME="${IDENT_NAME:-Stack Demo Developer}"
  IDENT_EMAIL="${IDENT_EMAIL:-demo@stack.local}"
  say "  no git identity configured; using $IDENT_NAME <$IDENT_EMAIL> inside the mock workspace"
fi

git -C "$WORK" init --quiet --initial-branch=main
git -C "$WORK" config user.name "$IDENT_NAME"
git -C "$WORK" config user.email "$IDENT_EMAIL"
git -C "$WORK" remote add origin "$BARE"
say "  created workspace       $WORK"

git -C "$WORK" add -A
git -C "$WORK" commit --quiet -m "STACK-100: seed checkout service"
git -C "$WORK" push --quiet -u origin main
say "  seeded main             STACK-100: seed checkout service"

say ""
say "mock-github ready"
say ""
say "  bare repo (GitHub)      $BARE"
say "  hooks (required check)  $BARE/hooks/pre-receive, post-receive"
say "  workspace (your clone)  $WORK"
say "  portal for webhooks     $PORTAL_URL"
say ""
say "  next"
say "    cd mock-github/workspace/acme-checkout"
say "    bash tests/run.sh          # fails: the seeded rounding bug is still there"
say "    node ../../../cli/stack/bin/stack.mjs project detect"
say ""
