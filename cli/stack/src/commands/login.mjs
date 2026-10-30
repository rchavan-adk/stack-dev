/** `stack login [--portal URL] [--token TOKEN]` */

import { Api } from "../api.mjs";
import { ApiError, CliError } from "../errors.mjs";
import { writeCredentials } from "../config.mjs";
import * as ui from "../ui.mjs";
import { maskToken, projectsTable } from "../render.mjs";

export const meta = {
  name: "login",
  summary: "Sign this machine in to the portal",
  usage: "stack login [--portal URL] [--token TOKEN]",
  detail:
    "Without --token the CLI prints where to create one and reads the token from\n" +
    "stdin without echoing it. The token is validated with GET /api/me before it is saved.",
};

export async function run(ctx) {
  const portalUrl = await ctx.portal();
  let token = String(ctx.flags.token ?? process.env.STACK_TOKEN ?? "").trim();

  if (!token) {
    ui.blank();
    ui.info(`Create a developer token at ${ui.code(`${portalUrl}/settings/tokens`)}`);
    ui.info(ui.muted("Settings \u2192 Tokens \u2192 New token. It looks like stk_dev_\u2026"));
    ui.blank();
    try {
      token = await ui.readSecret("  Paste the token (input is hidden): ");
    } catch {
      throw new CliError("login cancelled", { fix: "stack login" });
    }
  }
  if (!token) {
    throw new CliError("no token provided", { fix: "stack login --token stk_dev_\u2026" });
  }

  const client = new Api({ portalUrl, token });
  let me;
  try {
    me = await client.me();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      throw new CliError(`the portal rejected that token (${error.status} ${error.portalMessage})`, {
        fix: `stack login --portal ${portalUrl} --token stk_dev_\u2026`,
      });
    }
    throw error;
  }

  const user = me?.user ?? {};
  const projects = Array.isArray(me?.projects) ? me.projects : [];
  const credentials = {
    portalUrl,
    token,
    user,
    createdAt: new Date().toISOString(),
  };
  const file = await writeCredentials(credentials);

  ctx.emit(
    { portalUrl, user, projects, credentialsPath: file },
    () => {
      ui.heading(`Signed in to ${portalUrl}`);
      ui.kv([
        ["user", user.name ?? user.email ?? "(unknown)", ui.strong],
        ["email", user.email],
        ["role", user.role],
        ["token", maskToken(token)],
        ["saved", `${file.replace(process.env.HOME ?? "", "~")} (mode 0600)`],
      ]);
      if (token && !/^stk_/.test(token)) {
        ui.blank();
        ui.warn("that token does not look like a stk_\u2026 token, the portal may reject it later");
      }
      ui.section(`Projects you can see (${projects.length})`);
      if (projects.length === 0) {
        ui.info("  none yet \u2014 ask a lead to add you to a project");
      } else {
        projectsTable(projects);
      }
      ui.blank();
      if (projects.length === 0) {
        // No project to detect: the default harness is the way in.
        ui.info(`No projects yet \u2014 start with the default harness: ${ui.code("stack harness install")}`);
      } else {
        ui.info(`Next: ${ui.code("cd <your repo> && stack project detect")}`);
      }
    },
  );

  return 0;
}
