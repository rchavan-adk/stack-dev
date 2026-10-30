/**
 * `stack doctor` — a numbered checklist over this machine and this repo.
 *
 * Every failure prints the exact command that fixes it, and the process exits
 * non-zero when a required check fails. A portal that is not running produces
 * clear failures, never a stack trace.
 */

import path from "node:path";
import * as config from "../config.mjs";
import * as git from "../git.mjs";
import * as ui from "../ui.mjs";
import { digestDir, exists, fileMode, isExecutable } from "../util.mjs";
import { readStackToml } from "../stacktoml.mjs";

export const meta = {
  name: "doctor",
  summary: "Check credentials, link, pack, hooks, MCP and gateway",
  usage: "stack doctor [--json]",
  detail: "Exits 1 when a required check fails; every failure prints the command that fixes it.",
};

const HOOKS = ["commit-msg", "pre-push"];

export async function run(ctx) {
  const checks = [];
  const state = {};

  state.credentials = await ctx.credentials();
  try {
    state.api = await ctx.api();
  } catch {
    state.api = null;
  }
  state.root = await ctx.repoRoot({ required: false });
  state.link = state.root ? await config.readProjectConfig(state.root) : null;
  state.toml = state.root ? await readStackToml(state.root) : null;
  // A repo that runs the default harness has no project to ask about, so compare
  // against the org-level pack the portal publishes instead.
  state.published = !state.api
    ? null
    : state.link?.projectKey
      ? await ctx.soft(state.api.harnessCurrent(state.link.projectKey), null)
      : await ctx.soft(state.api.harnessDefault(), null);

  checks.push(await checkCredentials(ctx, state));
  checks.push(await checkLink(state));
  checks.push(await checkStackToml(state));
  checks.push(await checkPack(state));
  checks.push(await checkHooks(state));
  checks.push(await checkMcp(ctx, state));
  checks.push(await checkGateway(ctx, state));
  checks.push(await checkClaimedItem(ctx, state));

  const failed = checks.filter((check) => !check.ok && check.required !== false);
  const root = state.root ?? process.cwd();

  ctx.emit(
    {
      repo: root,
      ok: failed.length === 0,
      checks: checks.map(({ n, label, ok, detail, fix, required, warn: isWarn }) => ({
        n,
        label,
        ok,
        required: required !== false,
        warn: Boolean(isWarn),
        detail,
        fix,
      })),
      failed: failed.length,
    },
    () => {
      ui.heading(`stack doctor \u00b7 ${path.basename(root)}`);
      for (const check of checks) {
        const label = `${check.n}. ${check.label}`.padEnd(46);
        if (check.ok && check.warn) ui.warn(`${label} ${check.detail ?? ""}`);
        else if (check.ok) ui.ok(`${label} ${check.detail ?? ""}`);
        else ui.fail(`${label} ${check.detail ?? ""}`);
        if (!check.ok || check.warn) ui.hint(check.fix);
      }
      ui.blank();
      if (failed.length === 0) {
        ui.info(`  ${ui.style.green("all checks passed")}`);
      } else {
        ui.info(`  ${ui.style.red(`${failed.length} of ${checks.length} checks failed`)}`);
      }
    },
  );

  return failed.length === 0 ? 0 : 1;
}

async function checkCredentials(ctx, state) {
  const base = { n: 1, label: "credentials present and valid", required: true };
  if (!state.credentials?.token) {
    return { ...base, ok: false, detail: "no token saved", fix: "stack login" };
  }
  const portalUrl = await ctx.portal();
  if (!state.api) {
    return { ...base, ok: false, detail: "no usable credentials", fix: "stack login" };
  }
  try {
    const me = await state.api.me();
    const user = me?.user ?? {};
    state.user = user;
    return {
      ...base,
      ok: true,
      detail: `${user.name ?? user.email ?? "?"} \u00b7 ${user.role ?? "?"} \u00b7 ${portalUrl}`,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      detail: error.message,
      fix: error.fix || `stack login --portal ${portalUrl}`,
    };
  }
}

async function checkLink(state) {
  const base = { n: 2, label: "repository linked to a project", required: true };
  if (!state.root) {
    return { ...base, ok: false, detail: "not inside a git repository", fix: "git init && stack project detect" };
  }
  if (!state.link?.projectKey) {
    // Installing the default harness is a valid, green starting point: the repo
    // is harness governed, it is just not attached to an engagement yet.
    const governed =
      Boolean(state.link && state.toml) && (await exists(config.packDir(state.root)));
    if (governed) {
      return { ...base, ok: true, detail: "default harness \u2014 no project linked yet" };
    }
    return { ...base, ok: false, detail: ".stack/project.json not found", fix: "stack project detect" };
  }
  return {
    ...base,
    ok: true,
    detail: `${state.link.projectKey} \u00b7 ${state.link.projectName ?? ""}`.trim(),
  };
}

async function checkStackToml(state) {
  const base = { n: 3, label: "stack.toml matches the published pack", required: true };
  if (!state.toml) {
    return { ...base, ok: false, detail: "stack.toml missing", fix: "stack harness install" };
  }
  const publishedVersion = state.published?.pack?.version ?? "";
  if (!publishedVersion) {
    return {
      ...base,
      ok: true,
      warn: true,
      detail: `stack.toml v${state.toml.packVersion || "?"} \u00b7 portal unreachable, not compared`,
      fix: "npm run dev:portal",
    };
  }
  const publishedName = state.published?.pack?.name ?? "";
  if (publishedName && state.toml.packName && publishedName !== state.toml.packName) {
    return {
      ...base,
      ok: false,
      detail: `stack.toml pack ${state.toml.packName}, portal publishes ${publishedName}`,
      fix: "stack harness install",
    };
  }
  if (state.toml.packVersion !== publishedVersion) {
    return {
      ...base,
      ok: false,
      detail: `stack.toml v${state.toml.packVersion || "?"}, portal publishes v${publishedVersion}`,
      fix: "stack harness install --force",
    };
  }
  return { ...base, ok: true, detail: `stack.toml v${state.toml.packVersion} \u00b7 portal v${publishedVersion}` };
}

async function checkPack(state) {
  const base = { n: 4, label: ".stack/pack checksum matches", required: true };
  if (!state.root) return { ...base, ok: false, detail: "no repository", fix: "stack project detect" };
  const packDir = config.packDir(state.root);
  if (!(await exists(packDir))) {
    return { ...base, ok: false, detail: ".stack/pack missing", fix: "stack harness install" };
  }
  const digest = await digestDir(packDir);
  state.digest = digest;
  if (state.link?.digest && digest.digest !== state.link.digest) {
    return {
      ...base,
      ok: false,
      detail: `pack was modified after install (${short(digest.digest)} vs ${short(state.link.digest)})`,
      fix: "stack harness install --force",
    };
  }
  const publishedChecksum = state.published?.pack?.checksum ?? "";
  const installedChecksum = state.link?.checksum ?? state.toml?.checksum ?? "";
  if (publishedChecksum && installedChecksum && publishedChecksum !== installedChecksum) {
    return {
      ...base,
      ok: false,
      detail: `installed ${short(installedChecksum)}, portal publishes ${short(publishedChecksum)}`,
      fix: "stack harness install --force",
    };
  }
  return { ...base, ok: true, detail: `${digest.files} files \u00b7 ${short(digest.digest)}` };
}

async function checkHooks(state) {
  const base = { n: 5, label: "git hooks installed and executable", required: true };
  if (!state.root) return { ...base, ok: false, detail: "no repository", fix: "stack harness install" };
  const hooksDir = await git.hooksDir(state.root);
  const problems = [];
  const present = [];
  for (const hook of HOOKS) {
    const file = path.join(hooksDir, hook);
    if (!(await exists(file))) problems.push(`${hook} missing`);
    else if (!(await isExecutable(file))) problems.push(`${hook} not executable (${await fileMode(file)})`);
    else present.push(`${hook} ${await fileMode(file)}`);
  }
  if (problems.length) {
    return { ...base, ok: false, detail: problems.join(", "), fix: "stack harness install --force" };
  }
  return { ...base, ok: true, detail: present.join(" \u00b7 ") };
}

async function checkMcp(ctx, state) {
  const base = { n: 6, label: "Stack MCP server reachable", required: true };
  const candidates = [];
  const portalUrl = await ctx.portal();
  const configured = state.link?.mcpUrl ?? (await ctx.soft(config.resolveMcpUrl(portalUrl, null, ctx.flags), null));
  if (configured) {
    // Both route shapes answer: /mcp/health behind a deployment's path
    // routing, /health when the URL points at the server directly.
    candidates.push(`${config.normalizeUrl(configured)}/health`);
  }
  candidates.push("http://localhost:4300/health");

  for (const url of [...new Set(candidates)]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        const name = body?.name ?? body?.server ?? "stack-mcp";
        return { ...base, ok: true, detail: `${name} at ${url}` };
      }
      return { ...base, ok: false, detail: `${url} answered ${response.status}`, fix: "npm run dev:mcp" };
    } catch {
      /* try the next candidate */
    }
  }
  return {
    ...base,
    ok: false,
    detail: `${candidates[0]} unreachable`,
    fix: "npm run dev:mcp",
  };
}

async function checkGateway(ctx, state) {
  const base = { n: 7, label: "model gateway reachable", required: true };
  if (!state.api) {
    return { ...base, ok: false, detail: "cannot call the portal without credentials", fix: "stack login" };
  }
  try {
    const health = await state.api.gatewayHealth();
    const allowlist = Array.isArray(health?.allowlist) ? health.allowlist : [];
    state.allowlist = allowlist;
    return {
      ...base,
      ok: true,
      detail: `${health?.gateway ?? "gateway"} \u00b7 ${allowlist.length} model(s) allowlisted`,
    };
  } catch (error) {
    return { ...base, ok: false, detail: error.message, fix: error.fix || "npm run dev:portal" };
  }
}

async function checkClaimedItem(ctx, state) {
  const base = { n: 8, label: "an item is claimed in this session", required: true };
  if (!state.root) return { ...base, ok: false, detail: "no repository", fix: "stack claim STACK-101" };
  const session = await config.readSession(state.root);
  if (!session?.handle) {
    // With the default harness there is no project, so there is nothing a
    // developer could have claimed: report it instead of failing the run.
    if (state.link && !state.link.projectKey) {
      return {
        ...base,
        ok: true,
        warn: true,
        detail: "no project linked yet, nothing to claim",
        fix: "stack project link <KEY>   # then: stack issues --mine",
      };
    }
    return {
      ...base,
      ok: false,
      detail: ".stack/session.json has no handle",
      fix: "stack issues --mine   # then: stack claim <HANDLE>",
    };
  }
  if (!state.api) {
    return { ...base, ok: true, warn: true, detail: `${session.handle} (unverified)`, fix: "stack login" };
  }
  const detail = await ctx.soft(state.api.issue(session.handle), null);
  const issue = detail?.issue;
  if (!issue) {
    return {
      ...base,
      ok: true,
      warn: true,
      detail: `${session.handle} claimed ${session.claimedAt ?? ""} (portal could not confirm it)`,
      fix: "stack issues --mine",
    };
  }
  return {
    ...base,
    ok: true,
    detail: `${session.handle} \u00b7 ${issue.status ?? "?"} \u00b7 ${issue.title ?? ""}`.trim(),
  };
}

function short(hash) {
  const value = String(hash ?? "");
  return value ? `${value.slice(0, 12)}\u2026` : "unknown";
}
