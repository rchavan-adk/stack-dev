/** `stack logout` — remove ~/.stack/credentials.json. */

import * as config from "../config.mjs";
import * as ui from "../ui.mjs";

export const meta = {
  name: "logout",
  summary: "Remove the local credentials file",
  usage: "stack logout",
  detail: "Repo links in .stack/project.json are left alone; only ~/.stack/credentials.json is removed.",
};

export async function run(ctx) {
  const credentials = await ctx.credentials();
  const file = config.credentialsPath();
  if (!credentials) {
    ctx.emit({ removed: false, credentialsPath: file }, () => {
      ui.heading("Not signed in");
      ui.info(`  nothing to remove at ${file}`);
    });
    return 0;
  }

  await config.clearCredentials();
  ctx.emit({ removed: true, credentialsPath: file, user: credentials.user ?? null }, () => {
    ui.heading("Signed out");
    ui.kv([
      ["removed", file.replace(process.env.HOME ?? "", "~")],
      ["user", credentials.user?.email ?? credentials.user?.name ?? "(unknown)"],
    ]);
    ui.blank();
    ui.info(`  Repo links were left in place. Sign in again with ${ui.code("stack login")}`);
  });
  return 0;
}
