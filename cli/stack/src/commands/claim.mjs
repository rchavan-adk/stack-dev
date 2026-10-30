/** `stack claim <HANDLE>` — take an item and start a session. */

import { requirePositional } from "../args.mjs";
import * as config from "../config.mjs";
import * as ui from "../ui.mjs";
import { issueSummary } from "../render.mjs";

export const meta = {
  name: "claim",
  summary: "Claim an item and start a session on it",
  usage: "stack claim <HANDLE>",
  detail:
    "Calls POST /api/issues/:handle/claim and writes .stack/session.json with\n" +
    "{ handle, claimedAt }. The harness plugin reads STACK_ITEM, so the export\n" +
    "line printed at the end is what ties your agent session to the item.",
};

export async function run(ctx) {
  const requested = requirePositional(ctx, 0, "<HANDLE>", "stack claim <HANDLE>").toUpperCase();
  const { root, key } = await ctx.project();
  const api = await ctx.api();
  const response = await api.claim(requested);
  const issue = response?.issue ?? response ?? {};
  const handle = String(issue.handle ?? requested).toUpperCase();
  const claimedAt = new Date().toISOString();

  await config.writeSession(root, { handle, claimedAt });

  const acceptance = Array.isArray(issue.acceptance) ? issue.acceptance : [];

  ctx.emit(
    { project: key, handle, claimedAt, issue, sessionPath: config.sessionPath(root) },
    () => {
      ui.heading(`Claimed ${handle}`);
      issueSummary(issue);
      if (acceptance.length) {
        ui.section("Acceptance criteria");
        acceptance.forEach((criterion, index) => ui.bullet(`${index + 1}. ${criterion}`));
      }
      ui.blank();
      ui.info(`  Session item written to ${ui.code(config.sessionPath(root).replace(root, "."))}`);
      ui.blank();
      ui.info(`  ${ui.code(`export STACK_ITEM=${handle}`)}`);
      ui.info(`  ${ui.muted("the harness plugin refuses to start without it")}`);
      ui.blank();
      ui.info(`Next: ${ui.code(`git switch -c stack/${handle}-<slug>`)}`);
    },
  );
  return 0;
}
