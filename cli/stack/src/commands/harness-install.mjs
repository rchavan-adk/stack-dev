/**
 * `stack harness install [--force] [--default] [--project KEY]`
 *
 * Resolve which pack to install: the linked project's published pack, the pack of
 * an explicit --project, or the org-level default pack when this repository is not
 * linked to a project yet (or --default was passed). Then
 * GET .../harness/current -> download the gzipped tar -> verify its checksum ->
 * extract to .stack/pack preserving modes -> install the blockers into
 * .git/hooks -> render stack.toml and AGENTS.md -> POST /api/harness/installed.
 *
 * An existing AGENTS.md or stack.toml is never overwritten without --force. The
 * one exception is a pack switch: when the portal publishes a different pack than
 * the one installed (default -> project, or a new project version) the files are
 * replaced cleanly so the repo moves to the new pack. Otherwise the CLI prints a
 * diff of what it would have written instead.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import * as config from "../config.mjs";
import * as git from "../git.mjs";
import * as ui from "../ui.mjs";
import { ApiError, CliError, UsageError } from "../errors.mjs";
import {
  digestDir,
  exists,
  fileMode,
  isExecutable,
  mkdirp,
  packChecksum,
  readText,
  remove,
  sha256,
  writeText,
} from "../util.mjs";
import { extractTarGz, isGzip } from "../tar.mjs";
import { readStackToml } from "../stacktoml.mjs";
import { linkProject } from "../link.mjs";

export const meta = {
  name: "harness install",
  summary: "Install the harness pack for this repo (project or default)",
  usage: "stack harness install [--force] [--default] [--project KEY]",
  detail:
    "Downloads the pack the portal publishes, extracts it to .stack/pack, installs\n" +
    "the commit-msg and pre-push blockers, and renders stack.toml and AGENTS.md.\n" +
    "Without a project link (or with --default) it installs the org-level default pack.",
};

const HOOKS = ["commit-msg", "pre-push"];

export async function run(ctx) {
  const root = await ctx.repoRoot();
  const api = await ctx.api();
  const portalUrl = await ctx.portal();
  const force = Boolean(ctx.flags.force);
  const previous = await config.readProjectConfig(root);

  const target = await resolveTarget(ctx, { root, previous });

  // 1. what the portal publishes
  const current = target.default
    ? await fetchDefaultPack(api)
    : await fetchProjectPack(api, target.key);
  const pack = current?.pack ?? {};
  if (!current?.downloadUrl) {
    throw new CliError(
      target.default
        ? "the portal published no default harness download"
        : `the portal published no harness download for ${target.key}`,
      { fix: "stack harness status" },
    );
  }

  // 2. download, verify the checksum, extract
  const bytes = await api.harnessDownload(current.downloadUrl);
  if (!isGzip(bytes)) {
    throw new CliError("the portal did not return a gzipped tarball", {
      detail: `content-type was not gzip; ${bytes.length} bytes received`,
      fix: "stack harness status",
    });
  }
  const tarballSha256 = sha256(bytes);
  const packDir = config.packDir(root);
  await remove(packDir);
  await mkdirp(packDir);
  const entries = await extractTarGz(bytes, packDir);
  const { digest } = await digestDir(packDir);
  const checksum = await verifyChecksum(packDir, pack.checksum);

  // 3. values for the templates
  const projectDetail = target.default
    ? {}
    : ((await ctx.soft(api.project(target.key), null))?.project ?? {});
  const handlePattern = target.default
    ? config.DEFAULT_HANDLE_PATTERN
    : config.handlePatternFor(projectDetail) ||
      previous?.handlePattern ||
      config.DEFAULT_HANDLE_PATTERN;
  const gatewayUrl = config.normalizeUrl(
    target.default
      ? config.defaultGatewayUrl(portalUrl)
      : projectDetail.gatewayUrl || previous?.gatewayUrl || config.defaultGatewayUrl(portalUrl),
  );
  const mcpUrl = config.normalizeUrl(
    target.default
      ? await config.resolveMcpUrl(portalUrl, null, ctx.flags)
      : previous?.mcpUrl || (await config.resolveMcpUrl(portalUrl, null, ctx.flags)),
  );
  const defaultModel = await resolveDefaultModel(ctx);

  const values = {
    PROJECT_KEY: target.default ? config.DEFAULT_HARNESS_PROJECT_KEY : target.key,
    PROJECT_NAME: target.default
      ? config.DEFAULT_HARNESS_PROJECT_NAME
      : projectDetail.name ?? previous?.projectName ?? target.key,
    PORTAL_URL: portalUrl,
    PACK_NAME: pack.name ?? previous?.packName ?? "miracle-standards",
    PACK_VERSION: pack.version ?? "",
    PACK_CHECKSUM: pack.checksum ?? "",
    GATEWAY_URL: gatewayUrl,
    DEFAULT_MODEL: defaultModel,
    MCP_URL: mcpUrl,
    HANDLE_PATTERN: handlePattern,
  };

  // With no project there is nothing to list, so AGENTS.md points at the first
  // handle of the demo engagement (STACK-100) instead of a placeholder.
  const exampleHandle = target.default
    ? "STACK-100"
    : (await ctx.soft(api.issues(target.key, { mine: true }), null))?.issues?.[0]?.handle ??
      "STACK-101";

  // 4. a pack switch replaces stack.toml and AGENTS.md without needing --force.
  // "Installed" means what is actually on disk: `stack project link` records the
  // published pack but installs nothing, so the install record alone cannot tell
  // us whether the repo is already governed by a different pack.
  const tomlBefore = await readStackToml(root);
  const installedBefore = tomlBefore
    ? { name: tomlBefore.packName, version: tomlBefore.packVersion }
    : previous?.installedAt
      ? { name: previous.packName ?? "", version: previous.packVersion ?? "" }
      : null;
  const switched = Boolean(installedBefore) &&
    (installedBefore.name !== (pack.name ?? "") || installedBefore.version !== (pack.version ?? ""));
  const overwrite = force || switched;

  // 5. blockers first: hooks are what make the rest of the demo real
  const hookReport = await installHooks({ root, packDir });

  // 6. rendered files
  const rendered = [
    await renderFile({
      root,
      target: "stack.toml",
      templatePath: path.join(packDir, "stack.toml.template"),
      values,
      force: overwrite,
      reason: force ? "force" : switched ? "switch" : "",
    }),
    await renderFile({
      root,
      target: "AGENTS.md",
      templatePath: path.join(packDir, "agents", "AGENTS.md"),
      values: { ...values, EXAMPLE_HANDLE: exampleHandle },
      force: overwrite,
      reason: force ? "force" : switched ? "switch" : "",
    }),
  ];

  // 7. remember the install, then tell the portal
  const installedAt = new Date().toISOString();
  const facts = {
    projectKey: target.default ? null : values.PROJECT_KEY,
    projectName: target.default ? null : values.PROJECT_NAME,
    packName: values.PACK_NAME,
    packVersion: values.PACK_VERSION,
    checksum: values.PACK_CHECKSUM,
    installedAt,
    mcpUrl,
    gatewayUrl,
    handlePattern,
    portalUrl,
    repo: path.basename(root),
    digest,
    tarballSha256,
    checksumVerified: checksum.checked ? checksum.matches : null,
  };
  const record = target.default
    ? { project: null, default: true, ...facts }
    : {
        ...(previous && previous.projectKey === values.PROJECT_KEY ? previous : {}),
        ...facts,
      };
  await config.writeProjectConfig(root, record);

  let reported = { ok: false, message: "", skipped: false };
  if (target.default) {
    reported = { ok: true, skipped: true, message: "default pack, no project to report" };
  } else {
    try {
      const response = await api.harnessInstalled({
        project: values.PROJECT_KEY,
        version: values.PACK_VERSION,
        repo: path.basename(root),
      });
      reported = { ok: response?.ok !== false, skipped: false, message: "" };
    } catch (error) {
      reported = { ok: false, skipped: false, message: error.message };
    }
  }

  ctx.emit(
    {
      project: target.default ? null : values.PROJECT_KEY,
      default: target.default,
      pack: { name: values.PACK_NAME, version: values.PACK_VERSION, checksum: values.PACK_CHECKSUM },
      files: entries.length,
      digest,
      tarballSha256,
      checksum: { expected: pack.checksum ?? null, actual: checksum.actual, verified: checksum.checked ? checksum.matches : null },
      switched,
      hooks: hookReport.hooks,
      rendered: rendered.map(({ target: name, status }) => ({ target: name, status })),
      reported,
      wrote: config.projectConfigPath(root),
    },
    () => {
      ui.heading("Harness installed");
      ui.kv([
        ["project", target.default ? "(none) default harness" : values.PROJECT_KEY, ui.strong],
        ["pack", `${values.PACK_NAME} v${values.PACK_VERSION}`],
        ["checksum", `${values.PACK_CHECKSUM || "none"} ${ui.muted(`(tarball sha256 ${tarballSha256.slice(0, 12)}\u2026)`)}`],
        ["pack dir", `.stack/pack (${entries.length} files, digest ${digest.slice(0, 12)}\u2026)`],
        ["default model", values.DEFAULT_MODEL],
      ]);

      ui.section("Checksum");
      if (!checksum.checked) {
        ui.warn("the portal published no checksum for this pack, nothing to verify");
      } else if (checksum.matches) {
        ui.ok(`the downloaded pack matches the published checksum ${ui.muted(short(checksum.expected))}`);
      } else {
        ui.warn(`the downloaded pack does not match the published checksum`);
        ui.kv([
          ["expected", short(checksum.expected)],
          ["got", short(checksum.actual)],
        ]);
        ui.hint("stack harness install --force");
      }

      if (switched) {
        ui.notice(
          `pack switch: ${installedBefore.name || "nothing"} ${installedBefore.version || ""} -> ${values.PACK_NAME} ${values.PACK_VERSION}`.trim(),
        );
      }

      ui.section("Hooks");
      for (const hook of hookReport.hooks) {
        if (hook.installed) {
          ui.ok(`.git/hooks/${hook.name} ${ui.muted(hook.mode ?? "")}`);
        } else {
          ui.fail(`.git/hooks/${hook.name} was not installed`);
          ui.hint("stack harness install --force");
        }
      }
      ui.kv([["via", hookReport.method ?? "unknown"]]);

      ui.section("Files");
      for (const file of rendered) {
        const display = file.target.padEnd(14);
        if (file.status === "written") ui.ok(`${display} ${ui.muted("written")}`);
        else if (file.status === "overwritten") {
          ui.ok(`${display} ${ui.muted(file.reason === "switch" ? "replaced (pack switch)" : "overwritten (--force)")}`);
        } else if (file.status === "unchanged") ui.info(`  ${display} ${ui.muted("unchanged")}`);
        else if (file.status === "missing") ui.warn(`${display} the pack has no template for it`);
        else if (file.status === "skipped") {
          ui.notice(`${file.target} already exists, left untouched`);
          ui.renderDiff(file.diff.current, file.diff.next, {
            labelA: `${file.target} (yours)`,
            labelB: `${file.target} (pack ${values.PACK_VERSION})`,
          });
          ui.hint("stack harness install --force");
        }
        if (file.missing?.length) {
          ui.warn(`${file.target}: unfilled placeholders ${file.missing.map((name) => `{{${name}}}`).join(", ")}`);
        }
      }
      ui.info(`  ${".stack/pack".padEnd(14)} ${ui.muted(`${entries.length} files extracted`)}`);
      ui.info(`  ${".stack/project.json".padEnd(14)} ${ui.muted("written")}`);

      ui.section("Portal");
      if (reported.skipped) {
        ui.info(`  ${ui.muted("default harness \u2014 nothing to report to a project")}`);
      } else if (reported.ok) {
        ui.ok("POST /api/harness/installed accepted");
      } else {
        ui.warn(`could not report the install: ${reported.message}`);
        ui.hint("stack harness install   # retry when the portal is back");
      }

      if (target.default) {
        ui.blank();
        ui.info(`  no project linked \u2014 installed the default Miracle harness`);
        ui.info(
          `  when a lead adds you to a project run ${ui.code("stack project link <KEY> && stack harness install")}`,
        );
        ui.blank();
      } else {
        ui.blank();
        ui.info(`Next: ${ui.code("stack issues --mine")} then ${ui.code("stack claim <HANDLE>")}`);
      }
    },
  );
  return 0;
}

/**
 * Which pack this repo should get:
 *   --default        the org-level default pack, always
 *   --project KEY    that project's published pack (and link the repo to it)
 *   linked repo      the linked project's published pack
 *   otherwise        the org-level default pack
 */
async function resolveTarget(ctx, { root, previous }) {
  const explicit = String(ctx.flags.project ?? "").trim().toUpperCase();
  if (ctx.flags.default && explicit) {
    throw new UsageError("--default and --project cannot be used together", {
      fix: "stack harness install --default",
    });
  }
  if (ctx.flags.default) return { default: true, key: null };
  if (explicit) {
    const { record } = await linkProject(ctx, explicit, { root });
    return { default: false, key: record.projectKey };
  }
  if (previous?.projectKey) return { default: false, key: previous.projectKey };
  return { default: true, key: null };
}

async function fetchProjectPack(api, key) {
  return api.harnessCurrent(key);
}

async function fetchDefaultPack(api) {
  try {
    return await api.harnessDefault();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new CliError("the portal has no published default harness pack", {
        detail: "an admin publishes one in the portal under Admin \u2192 Harness packs",
        fix: "stack project link <KEY>   # or ask a lead to publish a project pack",
      });
    }
    throw error;
  }
}

/**
 * Recompute the portal's checksum over the extracted pack. A pack that does not
 * match is reported but not fatal: the install record keeps the mismatch visible
 * for `stack harness status`.
 */
async function verifyChecksum(packDir, expected) {
  const actual = await packChecksum(packDir);
  const wanted = String(expected ?? "");
  if (!wanted) return { checked: false, matches: false, expected: "", actual };
  return { checked: true, matches: wanted === actual, expected: wanted, actual };
}

/** Prefer the gateway's first allowlisted model so stack.toml points somewhere real. */
async function resolveDefaultModel(ctx) {
  if (process.env.STACK_DEFAULT_MODEL) return process.env.STACK_DEFAULT_MODEL;
  const api = await ctx.api();
  const health = await ctx.soft(api.gatewayHealth(), null);
  const allowlist = Array.isArray(health?.allowlist) ? health.allowlist.filter(Boolean) : [];
  return allowlist[0] ?? config.DEFAULT_MODEL_FALLBACK;
}

function render(template, values) {
  const missing = new Set();
  const text = String(template).replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    if (value === undefined || value === null || value === "") {
      missing.add(key);
      return match;
    }
    return String(value);
  });
  return { text, missing: [...missing] };
}

async function renderFile({ root, target, templatePath, values, force, reason = "" }) {
  const destination = path.join(root, target);
  if (!(await exists(templatePath))) {
    return { target, status: "missing", destination };
  }
  const { text, missing } = render(await readText(templatePath), values);
  const existing = (await exists(destination)) ? await readText(destination) : null;
  if (existing !== null) {
    if (existing === text) return { target, status: "unchanged", destination, missing };
    if (!force) {
      return {
        target,
        status: "skipped",
        destination,
        missing,
        diff: { current: existing, next: text },
      };
    }
  }
  await writeText(destination, text, { mode: 0o644 });
  return { target, status: existing === null ? "written" : "overwritten", destination, missing, reason };
}

/** Run the pack's installer; fall back to copying the hooks ourselves. */
async function installHooks({ root, packDir }) {
  const script = path.join(packDir, "components", "scripts", "install-hooks.sh");
  const report = { method: null, fallback: false, output: "", hooks: [] };

  if (await exists(script)) {
    const result = await git.run(
      "bash",
      [".stack/pack/components/scripts/install-hooks.sh", ".stack/pack"],
      { cwd: root },
    );
    report.method = result.ok ? "components/scripts/install-hooks.sh" : "install-hooks.sh (failed)";
    report.output = result.stdout || result.stderr;
    if (!result.ok) report.fallback = true;
  } else {
    report.method = "copied by stack (pack has no install-hooks.sh)";
    report.fallback = true;
  }

  const hooksDir = await git.hooksDir(root);
  for (const hook of HOOKS) {
    const destination = path.join(hooksDir, hook);
    let installed = await isExecutable(destination);
    if (!installed) {
      const source = path.join(packDir, "components", "scripts", hook);
      if (await exists(source)) {
        await fs.mkdir(hooksDir, { recursive: true });
        await fs.copyFile(source, destination);
        await fs.chmod(destination, 0o755);
        installed = true;
        report.method = report.method?.includes("install-hooks.sh")
          ? `${report.method} + copy fallback`
          : report.method;
      }
    }
    report.hooks.push({ name: hook, path: destination, installed, mode: await fileMode(destination) });
  }
  return report;
}

function short(hash) {
  const value = String(hash ?? "");
  return value ? `${value.slice(0, 12)}\u2026` : "unknown";
}
