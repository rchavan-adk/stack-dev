/**
 * Where the CLI keeps its state, and how it resolves the portal.
 *
 *   global    ~/.stack/credentials.json   { portalUrl, token, user, createdAt }   0600
 *   repo      <repo>/.stack/project.json  { projectKey, ... }
 *             <repo>/.stack/session.json  { handle, claimedAt }
 *             <repo>/.stack/pack/         the extracted harness pack
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists, readJson, remove, writeJson, writeJsonLine } from "./util.mjs";

export const DEFAULT_PORTAL_URL = "http://localhost:4200";
export const DEFAULT_HANDLE_PATTERN = "STACK-[0-9]+";
export const DEFAULT_GATEWAY_PATH = "/api/gateway";
export const DEFAULT_MODEL_FALLBACK = "gpt-4o-mini";

/**
 * What stack.toml says about the project when the repo runs the org-level
 * default harness and no lead has added the developer to a project yet.
 */
export const DEFAULT_HARNESS_PROJECT_KEY = "none";
export const DEFAULT_HARNESS_PROJECT_NAME = "No project linked yet";

export function stackHome() {
  return process.env.STACK_HOME ? path.resolve(process.env.STACK_HOME) : path.join(os.homedir(), ".stack");
}

export function credentialsPath() {
  return path.join(stackHome(), "credentials.json");
}

export async function readCredentials() {
  return readJson(credentialsPath(), { fallback: null });
}

export async function writeCredentials(credentials) {
  // One line on purpose: the harness pack's commit-msg hook pulls `token` out of
  // this file with a line-based sed (`s/.*"token".*"([^"]+)".*/\1/`), which only
  // works when the whole object sits on a single line.
  return writeJsonLine(credentialsPath(), credentials, { mode: 0o600 });
}

export async function clearCredentials() {
  await remove(credentialsPath());
}

export function stackDir(repoRoot) {
  return path.join(repoRoot, ".stack");
}

export function projectConfigPath(repoRoot) {
  return path.join(stackDir(repoRoot), "project.json");
}

export function packDir(repoRoot) {
  return path.join(stackDir(repoRoot), "pack");
}

export function sessionPath(repoRoot) {
  return path.join(stackDir(repoRoot), "session.json");
}

export async function readProjectConfig(repoRoot) {
  return readJson(projectConfigPath(repoRoot), { fallback: null });
}

export async function writeProjectConfig(repoRoot, config) {
  return writeJson(projectConfigPath(repoRoot), config, { mode: 0o644 });
}

export async function readSession(repoRoot) {
  return readJson(sessionPath(repoRoot), { fallback: null });
}

export async function writeSession(repoRoot, session) {
  return writeJson(sessionPath(repoRoot), session, { mode: 0o644 });
}

/**
 * Portal precedence: --portal flag, STACK_PORTAL_URL, saved credentials, default.
 * A saved credential URL only wins when the developer did not ask for another one.
 */
export async function resolvePortalUrl(flags = {}) {
  if (flags.portal) return normalizeUrl(flags.portal);
  if (process.env.STACK_PORTAL_URL) return normalizeUrl(process.env.STACK_PORTAL_URL);
  const credentials = await readCredentials();
  if (credentials?.portalUrl) return normalizeUrl(credentials.portalUrl);
  return DEFAULT_PORTAL_URL;
}

export async function resolveMcpUrl(portalUrl, projectConfig = null, flags = {}) {
  if (flags["mcp-url"]) return normalizeUrl(flags["mcp-url"]);
  if (process.env.STACK_MCP_URL) return normalizeUrl(process.env.STACK_MCP_URL);
  if (projectConfig?.mcpUrl) return normalizeUrl(projectConfig.mcpUrl);
  // The MCP server rides the same origin as the portal, at /mcp behind a
  // deployment's path routing. Deriving it from the portal URL — rather than
  // defaulting to a developer's localhost — is what keeps a link made against
  // a deployed portal usable on any machine.
  return `${normalizeUrl(portalUrl)}/mcp`;
}

export function defaultGatewayUrl(portalUrl) {
  if (process.env.STACK_GATEWAY_URL) return normalizeUrl(process.env.STACK_GATEWAY_URL);
  return `${normalizeUrl(portalUrl)}${DEFAULT_GATEWAY_PATH}`;
}

export function normalizeUrl(value) {
  const text = String(value ?? "").trim().replace(/\/+$/, "");
  return text;
}

export function handlePatternFor(project) {
  const pattern = project?.handlePattern ?? project?.handle_pattern;
  return typeof pattern === "string" && pattern.trim() ? pattern.trim() : DEFAULT_HANDLE_PATTERN;
}

/**
 * The checkout that holds apps/mcp, for `stack mcp install --mode local`.
 * Prefers STACK_WORKSPACE, then walks up from `startDir`, then falls back to the
 * checkout this CLI was installed from (cli/stack/src -> workspace root).
 */
export async function workspaceRoot(startDir = process.cwd()) {
  if (process.env.STACK_WORKSPACE) return path.resolve(process.env.STACK_WORKSPACE);
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 10; depth += 1) {
    if (await exists(path.join(current, "apps", "mcp"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** Where the MCP stdio entrypoint lives, even before it is written. */
export function mcpStdioPath(workspace) {
  return path.join(workspace, "apps", "mcp", "src", "stdio.ts");
}
