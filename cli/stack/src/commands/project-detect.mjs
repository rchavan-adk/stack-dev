/** `stack project detect` — find the project this repository belongs to. */

import path from "node:path";
import { UsageError } from "../errors.mjs";
import * as config from "../config.mjs";
import * as git from "../git.mjs";
import * as ui from "../ui.mjs";
import { linkProject } from "../link.mjs";

export const meta = {
  name: "project detect",
  summary: "Detect and link this repository to a project",
  usage: "stack project detect [--project KEY]",
  detail:
    "Reads the git remote, calls POST /api/projects/detect, then lets you pick a\n" +
    "project by number and writes .stack/project.json.",
};

export async function run(ctx) {
  const root = await ctx.repoRoot();
  const repoName = path.basename(root);
  const remote = await git.remoteUrl(root);
  const portalUrl = await ctx.portal();
  const api = await ctx.api();

  const detection = await api.detectProject({ repoName, remote });
  const registerUrl = detection?.registerUrl ?? "";

  if (!detection?.registered) {
    ctx.emit(
      { registered: false, repoName, remote, registerUrl },
      () => {
        ui.heading("This repository is not registered with Stack AI");
        ui.kv([
          ["repo", repoName, ui.strong],
          ["remote", remote || "(no origin remote)"],
        ]);
        ui.blank();
        ui.info(`  Register it here: ${ui.code(registerUrl || `${portalUrl}/projects/new`)}`);
        ui.blank();
        ui.info("  Next steps");
        ui.bullet("open the link above and create the project (a lead approves it)");
        ui.bullet("copy the project key the portal shows you");
        ui.bullet(`come back and run ${ui.code("stack project detect")} again`);
        ui.bullet(`or link straight away with ${ui.code("stack link <KEY>")}`);
      },
    );
    return 0;
  }

  const matched = detection.project ?? {};
  const matchedKey = String(matched.key ?? "").toUpperCase();
  const me = await api.me();
  const projects = Array.isArray(me?.projects) ? me.projects : [];

  let key = String(ctx.flags.project ?? "").trim().toUpperCase();
  let chosen = null;

  if (!key) {
    const ordered = orderProjects(projects, matchedKey);
    if (ordered.length === 0) {
      throw new UsageError("the portal returned no projects for you", {
        fix: `stack link ${matchedKey || "<KEY>"}`,
      });
    }
    if (!ctx.json) {
      ui.heading(`Matched ${matchedKey || "a project"} \u00b7 ${matched.name ?? repoName}`);
      ui.info(`  pick the project to link this repo to (${portalUrl})`);
      ui.section("Projects you can see");
      ui.table(
        [
          { header: "#", key: "n", width: 3, align: "right" },
          { header: "KEY", key: "key", width: 22 },
          { header: "NAME", key: "name", width: 30 },
          { header: "ROLE", key: "role", width: 12 },
          { header: "MINE", key: "mine", width: 5, align: "right" },
          { header: "NOTE", key: "note", width: 10 },
        ],
        ordered.map((project, index) => ({
          n: String(index + 1),
          key: project.key ?? "",
          name: project.name ?? "",
          role: project.role ?? "",
          mine: project.assignedToMe ?? "",
          note: String(project.key ?? "").toUpperCase() === matchedKey ? "detected" : "",
        })),
      );
    }
    const answer = await ui.ask(`  Select a project [1-${ordered.length}] (default 1): `, {
      defaultValue: "1",
    });
    const index = Number.parseInt(answer, 10);
    if (!Number.isInteger(index) || index < 1 || index > ordered.length) {
      throw new UsageError(`"${answer}" is not one of 1-${ordered.length}`, {
        fix: "stack project detect --project <KEY>",
      });
    }
    chosen = ordered[index - 1];
    key = String(chosen.key ?? "").toUpperCase();
  }
  if (!key) {
    throw new UsageError("no project selected", { fix: "stack project detect --project <KEY>" });
  }

  const { record, detail } = await linkProject(ctx, key, { root });
  const project = detail?.project ?? chosen ?? {};
  const counts = detail?.counts ?? {};
  const mine = await ctx.soft(api.issues(key, { mine: true }), null);
  const all = counts.open === undefined && counts.openIssues === undefined
    ? await ctx.soft(api.issues(key), null)
    : null;

  const assignedCount =
    mine?.issues?.length ??
    (projects.find((entry) => String(entry.key ?? "").toUpperCase() === key)?.assignedToMe ?? null);
  const openCount =
    counts.open ?? counts.openIssues ?? counts.total ?? all?.issues?.length ?? null;
  const harness = detail?.harness ?? {};

  ctx.emit(
    {
      registered: true,
      detected: { repoName, remote },
      project: project ?? { key },
      counts: { assigned: assignedCount, open: openCount, raw: counts },
      wrote: config.projectConfigPath(root),
    },
    () => {
      ui.heading(`Linked ${record.projectKey} \u00b7 ${record.projectName}`);
      ui.kv([
        ["repo", repoName],
        ["remote", remote || "(no origin remote)"],
        ["portal", portalUrl],
        ["mcp", record.mcpUrl],
        [
          "harness",
          harness.version
            ? `${harness.packName ?? record.packName} v${harness.version} (not installed yet)`
            : "no pack published for this project yet",
        ],
        ["wrote", config.projectConfigPath(root).replace(root, ".")],
      ]);
      ui.section("Workload");
      ui.kv([
        ["assigned to you", assignedCount ?? "unknown"],
        ["open issues", openCount ?? "unknown"],
      ]);
      ui.blank();
      ui.info(`Next: ${ui.code("stack harness install")}`);
    },
  );
  return 0;
}

function orderProjects(projects, matchedKey) {
  return [...projects].sort((a, b) => {
    const aMatch = String(a.key ?? "").toUpperCase() === matchedKey ? 1 : 0;
    const bMatch = String(b.key ?? "").toUpperCase() === matchedKey ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    const aMine = Number(a.assignedToMe ?? 0);
    const bMine = Number(b.assignedToMe ?? 0);
    if (aMine !== bMine) return bMine - aMine;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
}
