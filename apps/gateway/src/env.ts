/**
 * Env loading for the gateway. Same rules as the MCP server: values already
 * present in the process win, then app-local .env, then the repo-root
 * secrets/.env where the Anthropic key lives (gitignored, never committed).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = resolve(HERE, "..");
export const REPO_ROOT = resolve(APP_ROOT, "..", "..");

function applyEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadEnv(): void {
  applyEnvFile(join(APP_ROOT, ".env"));
  applyEnvFile(join(REPO_ROOT, "secrets", ".env"));
}

export function anthropicMessagesUrl(): string {
  return process.env.ANTHROPIC_MESSAGES_URL ?? "https://api.anthropic.com/v1/messages";
}

export function gatewayPort(): number {
  return Number(process.env.STACK_GATEWAY_PORT ?? 4400);
}

export function anthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Expected it in secrets/.env at the repo root " +
        "(gitignored) or apps/gateway/.env. Without it the gateway still starts and " +
        "serves /health, but every model call answers 503 instead of being forwarded.",
    );
  }
  return key;
}

/** Item attribution is the whole point of the gateway; allow disabling only for local tests. */
export function requireItem(): boolean {
  return (process.env.STACK_GATEWAY_REQUIRE_ITEM ?? "true").toLowerCase() !== "false";
}
