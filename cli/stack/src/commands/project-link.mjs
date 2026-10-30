/** `stack link <KEY>` — link this repository to a project by key. */

import { requirePositional } from "../args.mjs";
import * as config from "../config.mjs";
import * as git from "../git.mjs";
import * as ui from "../ui.mjs";
import { linkProject } from "../link.mjs";

export const meta = {
  name: "link",
  summary: "Link this repository to a project by key",
  usage: "stack link <KEY>",
  detail: "Validates the key with GET /api/projects/:key and writes .stack/project.json.",
};

export async function run(ctx) {
  const key = requirePositional(ctx, 0, "<KEY>", "stack link <KEY>").toUpperCase();
  const root = await ctx.repoRoot();
  const remote = await git.remoteUrl(root);
  const { record, detail } = await linkProject(ctx, key, { root });
  const harness = detail?.harness ?? {};

  ctx.emit(
    { linked: true, project: detail?.project ?? { key }, wrote: config.projectConfigPath(root) },
    () => {
      ui.heading(`Linked ${record.projectKey} \u00b7 ${record.projectName}`);
      ui.kv([
        ["repo", root.split("/").pop()],
        ["remote", remote || "(no origin remote)"],
        ["mcp", record.mcpUrl],
        ["handle pattern", record.handlePattern],
        [
          "harness",
          harness.version
            ? `${harness.packName ?? record.packName} v${harness.version}`
            : "no pack published yet",
        ],
        ["wrote", config.projectConfigPath(root).replace(root, ".")],
      ]);
      ui.blank();
      ui.info(`Next: ${ui.code("stack harness install")}`);
    },
  );
  return 0;
}
