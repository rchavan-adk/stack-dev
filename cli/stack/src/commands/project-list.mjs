/** `stack project list` — every project this developer can see. */

import * as ui from "../ui.mjs";
import { projectsTable } from "../render.mjs";

export const meta = {
  name: "project list",
  summary: "List the projects you can see",
  usage: "stack project list [--json]",
  detail: "Calls GET /api/projects.",
};

export async function run(ctx) {
  const api = await ctx.api();
  const response = await api.projects();
  const projects = Array.isArray(response?.projects) ? response.projects : [];

  ctx.emit({ projects }, () => {
    ui.heading(`Projects (${projects.length})`);
    if (projects.length === 0) {
      ui.info("  none yet \u2014 ask a lead to add you to a project");
      return;
    }
    projectsTable(projects, { showClient: true });
    ui.blank();
    ui.info(`Link this repo with ${ui.code("stack link <KEY>")}`);
  });
  return 0;
}
