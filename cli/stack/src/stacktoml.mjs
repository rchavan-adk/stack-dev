/** Tiny reader for the stack.toml we render (sections of `key = value`). */

import path from "node:path";
import { exists, readText } from "./util.mjs";

export const STACK_TOML = "stack.toml";

export async function readStackToml(repoRoot) {
  const file = path.join(repoRoot, STACK_TOML);
  if (!(await exists(file))) return null;
  const text = await readText(file);
  const sections = { top: {} };
  let current = "top";

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = section[1].trim();
      sections[current] = sections[current] ?? {};
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!pair) continue;
    const value = pair[2]
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
    sections[current][pair[1]] = value;
  }

  return {
    file,
    text,
    sections,
    packName: sections.pack?.name ?? "",
    packVersion: sections.pack?.version ?? "",
    checksum: sections.pack?.checksum ?? "",
    projectKey: sections.project?.key ?? "",
    projectName: sections.project?.name ?? "",
    portalUrl: sections.project?.portal_url ?? "",
    gatewayUrl: sections.models?.gateway ?? "",
    defaultModel: sections.models?.default ?? "",
    mcpUrl: sections.mcp?.url ?? "",
    handlePattern: sections.enforce?.commit_item_pattern ?? "",
  };
}
