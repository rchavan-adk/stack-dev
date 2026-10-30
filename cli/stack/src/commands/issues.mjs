/** `stack issues [--mine] [--status S]` — the project's work items. */

import * as ui from "../ui.mjs";
import { issuesTable } from "../render.mjs";

export const meta = {
  name: "issues",
  summary: "List work items for this repo's project",
  usage: "stack issues [--mine] [--status S] [--project KEY]",
  detail: "Calls GET /api/projects/:key/issues with optional mine=1 and status filters.",
};

export async function run(ctx) {
  const { key } = await ctx.project();
  const projectKey = String(ctx.flags.project ?? key).toUpperCase();
  const mine = Boolean(ctx.flags.mine);
  const status = ctx.flags.status ? String(ctx.flags.status).toUpperCase() : "";

  const api = await ctx.api();
  const response = await api.issues(projectKey, { mine, status });
  const issues = Array.isArray(response?.issues) ? response.issues : [];
  const filters = [mine ? "mine=1" : "", status ? `status=${status}` : ""].filter(Boolean).join(" & ");

  ctx.emit({ project: projectKey, mine, status, issues }, () => {
    ui.heading(`${projectKey} \u00b7 ${issues.length} issue${issues.length === 1 ? "" : "s"}${filters ? ` (${filters})` : ""}`);
    if (issues.length === 0) {
      ui.info("  nothing matches");
      ui.blank();
      ui.info(`Try ${ui.code("stack issues")} for everything, or ${ui.code("stack issues --mine")} for your queue.`);
      return;
    }
    issuesTable(issues);
    ui.blank();
    ui.info(`Claim one with ${ui.code(`stack claim ${issues[0]?.handle ?? "<HANDLE>"}`)}`);
  });
  return 0;
}
