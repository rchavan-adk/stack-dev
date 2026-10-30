/** `stack whoami` — who the portal thinks you are. */

import { CliError } from "../errors.mjs";
import * as config from "../config.mjs";
import * as ui from "../ui.mjs";
import { maskToken, projectsTable } from "../render.mjs";

export const meta = {
  name: "whoami",
  summary: "Show the signed-in developer and their projects",
  usage: "stack whoami",
  detail: "Calls GET /api/me. If the portal is unreachable it falls back to the cached credentials.",
};

export async function run(ctx) {
  const credentials = await ctx.requireCredentials();
  const portalUrl = await ctx.portal();

  let me = null;
  let offline = "";
  try {
    const api = await ctx.api();
    me = await api.me();
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    offline = error.message;
  }

  const user = me?.user ?? credentials.user ?? {};
  const projects = Array.isArray(me?.projects) ? me.projects : [];

  ctx.emit(
    { portalUrl, user, projects, cached: Boolean(offline), credentialsPath: config.credentialsPath() },
    () => {
      ui.heading(user.name ?? user.email ?? "(unknown developer)");
      ui.kv([
        ["email", user.email],
        ["role", user.role],
        ["user id", user.id],
        ["portal", portalUrl],
        ["token", maskToken(credentials.token)],
        ["since", credentials.createdAt],
      ]);
      if (offline) {
        ui.blank();
        ui.warn(`portal not reachable, showing cached credentials (${offline})`);
        return;
      }
      ui.section(`Projects (${projects.length})`);
      if (projects.length === 0) {
        ui.info("  none yet \u2014 ask a lead to add you to a project");
      } else {
        projectsTable(projects);
      }
    },
  );
  return 0;
}
