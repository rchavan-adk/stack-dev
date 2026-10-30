/**
 * `stack mcp install [--agent opencode|droid|claude] [--mode remote|local]`
 *
 * Writes the Stack MCP server into the agent config the developer already uses,
 * preserving every other key in that file.
 */

import path from "node:path";
import { CliError, UsageError } from "../errors.mjs";
import * as config from "../config.mjs";
import * as ui from "../ui.mjs";
import { exists, readJson, writeJson } from "../util.mjs";
import { maskToken } from "../render.mjs";

export const meta = {
  name: "mcp install",
  summary: "Wire the Stack MCP server into your agent",
  usage: "stack mcp install [--agent opencode|droid|claude] [--mode remote|local]",
  detail:
    "opencode.json for opencode, .factory/mcp.json for droid, .mcp.json for claude.\n" +
    "Existing keys in those files are preserved.",
};

const AGENTS = {
  opencode: { file: "opencode.json", wrapper: "mcp", schema: "https://opencode.ai/config.json" },
  droid: { file: ".factory/mcp.json", wrapper: "mcpServers" },
  claude: { file: ".mcp.json", wrapper: "mcpServers" },
};

const AGENT_NAMES = Object.keys(AGENTS);

export async function run(ctx) {
  const root = await ctx.repoRoot();
  const credentials = await ctx.requireCredentials();
  const token = credentials.token;
  const link = await config.readProjectConfig(root);

  const agent = await resolveAgent(ctx, root);
  const mode = String(ctx.flags.mode ?? "remote").toLowerCase();
  if (!["remote", "local"].includes(mode)) {
    throw new UsageError(`--mode must be remote or local, got "${mode}"`, { fix: meta.usage });
  }

  const mcpUrl = config.normalizeUrl(
    link?.mcpUrl || (await config.resolveMcpUrl(link, ctx.flags)),
  );
  const workspace = await config.workspaceRoot(root);
  const stdio = config.mcpStdioPath(workspace);

  const entry =
    mode === "local"
      ? {
          type: "local",
          command: ["npx", "tsx", stdio],
          environment: { STACK_TOKEN: token },
          enabled: true,
        }
      : {
          type: "remote",
          url: mcpUrl,
          enabled: true,
          headers: { Authorization: `Bearer ${token}` },
        };

  const spec = AGENTS[agent];
  const target = path.join(root, spec.file);
  const existing = (await exists(target)) ? await readJson(target, { fallback: {} }) : {};
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
    throw new CliError(`${spec.file} is not a JSON object, refusing to touch it`, {
      fix: `rm ${spec.file}   # then: stack mcp install --agent ${agent}`,
    });
  }

  const next = { ...existing };
  if (spec.schema && !next.$schema) next.$schema = spec.schema;
  const currentWrapper = next[spec.wrapper];
  next[spec.wrapper] = {
    ...(currentWrapper && typeof currentWrapper === "object" ? currentWrapper : {}),
    stack: entry,
  };

  await writeJson(target, next, { mode: 0o644 });

  const snippet = { [spec.wrapper]: { stack: entry } };
  const stdioExists = mode === "local" ? await exists(stdio) : true;

  ctx.emit(
    { agent, mode, file: target, mcpUrl: mode === "remote" ? mcpUrl : null, stdio, entry, snippet },
    () => {
      ui.heading(`MCP server "stack" written to ${spec.file}`);
      ui.kv([
        ["agent", agent],
        ["mode", mode],
        ["url", mode === "remote" ? mcpUrl : undefined],
        ["command", mode === "local" ? `npx tsx ${stdio}` : undefined],
        ["token", `${maskToken(token)} ${ui.muted("(embedded in the file)")}`],
        ["file", target.replace(root, ".")],
      ]);
      if (mode === "local" && !stdioExists) {
        ui.blank();
        ui.warn(`${stdio} does not exist yet, build the MCP server before using local mode`);
        ui.hint("npm run dev:mcp");
      }
      ui.section("Snippet");
      for (const row of JSON.stringify(snippet, null, 2).split("\n")) ui.line(`  ${row}`);
      ui.blank();
      ui.info(`  ${ui.muted("the token is stored in this file; keep it out of commits if the file is not shared")}`);
    },
  );
  return 0;
}

async function resolveAgent(ctx, root) {
  const requested = ctx.flags.agent ? String(ctx.flags.agent).toLowerCase() : "";
  if (requested) {
    if (!AGENT_NAMES.includes(requested)) {
      throw new UsageError(`unknown agent "${requested}"`, { fix: meta.usage });
    }
    return requested;
  }
  if (await exists(path.join(root, ".factory"))) return "droid";
  if (await exists(path.join(root, ".mcp.json"))) return "claude";
  if (await exists(path.join(root, "opencode.json"))) return "opencode";
  return "opencode";
}
