/**
 * `stack verify` — run the installed pack's ci/stack-verify.sh against this branch.
 *
 * The same script runs in CI and inside the bare remote's pre-receive hook, which
 * is why `--no-verify` does not get anyone out of it.
 */

import path from "node:path";
import { CliError } from "../errors.mjs";
import * as config from "../config.mjs";
import * as git from "../git.mjs";
import * as ui from "../ui.mjs";
import { exists } from "../util.mjs";

export const meta = {
  name: "verify",
  summary: "Run the pack's stack-verify checks on this branch",
  usage: "stack verify [--base REF]",
  detail:
    "Runs .stack/pack/ci/stack-verify.sh <base> <HEAD>. Without --base the base is\n" +
    "the merge-base with origin/main (or main/master/develop), then HEAD~1.",
};

export async function run(ctx) {
  const { root } = await ctx.project();
  const script = path.join(config.packDir(root), "ci", "stack-verify.sh");
  if (!(await exists(script))) {
    throw new CliError("the installed pack has no ci/stack-verify.sh", {
      fix: "stack harness install --force",
    });
  }

  const head = (await git.headSha(root)) || "HEAD";
  let base = ctx.flags.base ? String(ctx.flags.base) : await git.defaultBaseRef(root);
  const args = base ? [path.relative(root, script), base, head] : [path.relative(root, script)];

  ui.heading(`stack verify \u00b7 ${path.basename(root)}`);
  ui.kv([
    ["script", path.relative(root, script)],
    ["range", base ? `${base.slice(0, 8)}\u2026${head.slice(0, 8)}` : "working tree HEAD"],
  ]);
  ui.blank();

  const result = await git.run("bash", args, { cwd: root, inherit: true });
  ui.blank();
  if (result.ok) {
    ui.info(`  ${ui.style.green("stack-verify passed")}`);
    return 0;
  }
  ui.info(`  ${ui.style.red(`stack-verify failed (exit ${result.code})`)}`);
  ui.hint("fix the failures above, then commit again with the item handle in the subject");
  return 1;
}
