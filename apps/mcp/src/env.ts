import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * tsx does not load .env, so entry points call this before anything queries the
 * database. Values already present in the real environment win over the file.
 */
export function loadEnv(
  filePath: string = join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
): void {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

export function portalUrl(): string {
  return (process.env.STACK_PORTAL_URL ?? "http://localhost:4200").replace(/\/+$/, "");
}

export function signingSecret(): string {
  return process.env.STACK_SIGNING_SECRET ?? "";
}

export function mcpPort(): number {
  const parsed = Number(process.env.STACK_MCP_PORT ?? "4300");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4300;
}
