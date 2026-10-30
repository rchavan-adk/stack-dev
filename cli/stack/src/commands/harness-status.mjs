/** `stack harness status` — installed pack vs the one the portal publishes. */

import path from "node:path";
import * as config from "../config.mjs";
import * as git from "../git.mjs";
import * as ui from "../ui.mjs";
import { digestDir, exists, fileMode, isExecutable } from "../util.mjs";
import { readStackToml } from "../stacktoml.mjs";

export const meta = {
  name: "harness status",
  summary: "Compare the installed pack with the published one",
  usage: "stack harness status [--json]",
  detail:
    "Reports the pack version and checksum, the hooks, and the local pack digest.\n" +
    "Without a project link it reports on the org-level default pack instead.",
};

export async function run(ctx) {
  const root = await ctx.repoRoot();
  const link = await config.readProjectConfig(root);
  const isDefault = !link?.projectKey;

  let api = null;
  try {
    api = await ctx.api();
  } catch {
    api = null;
  }
  const published = api
    ? await ctx.soft(isDefault ? api.harnessDefault() : api.harnessCurrent(link.projectKey), null)
    : null;
  const pack = published?.pack ?? {};

  const toml = await readStackToml(root);
  const packDir = config.packDir(root);
  const packDirExists = await exists(packDir);
  const digest = packDirExists ? await digestDir(packDir) : null;

  const hooksDir = await git.hooksDir(root);
  const hooks = [];
  for (const hook of ["commit-msg", "pre-push"]) {
    const file = path.join(hooksDir, hook);
    hooks.push({
      name: hook,
      path: file,
      present: await exists(file),
      executable: await isExecutable(file),
      mode: await fileMode(file),
    });
  }

  // What is installed is what the repo actually carries: stack.toml travels with
  // the code, so it wins over the install record (which `stack project link`
  // rewrites with the published pack before anything is installed).
  const installedName = toml?.packName || link?.packName || "";
  const installedVersion = toml?.packVersion || link?.packVersion || "";
  const installedSource = toml?.packName ? "stack.toml" : link?.packName ? "install record" : "";
  const publishedName = pack.name ?? "";
  const publishedVersion = pack.version ?? "";
  const nameDiffers = Boolean(publishedName) && installedName !== publishedName;
  const versionDiffers = Boolean(publishedVersion) && installedVersion !== publishedVersion;
  // A pending switch is a different pack identity, not just a different version:
  // default -> project keeps the same version but changes the pack name.
  const pendingSwitch = nameDiffers || versionDiffers;
  const upToDate = Boolean(publishedVersion) && !pendingSwitch;
  const digestMatches = Boolean(digest && link?.digest) && digest.digest === link.digest;

  ctx.emit(
    {
      active: isDefault ? "default" : "project",
      project: link?.projectKey ?? null,
      installed: {
        name: installedName || null,
        version: installedVersion,
        source: installedSource || null,
        checksum: link?.checksum ?? null,
        at: link?.installedAt ?? null,
      },
      published: publishedVersion
        ? { name: publishedName, version: publishedVersion, checksum: pack.checksum ?? null, components: pack.components ?? null }
        : null,
      upToDate,
      pendingSwitch,
      stackToml: toml ? { present: true, name: toml.packName, version: toml.packVersion, checksum: toml.checksum } : { present: false },
      pack: packDirExists ? { present: true, files: digest.files, digest: digest.digest, matches: digestMatches } : { present: false },
      hooks,
    },
    () => {
      ui.heading(`Harness status \u00b7 ${isDefault ? "default harness (no project linked)" : link.projectKey}`);

      ui.section("pack");
      if (link?.installedAt || installedName) {
        ui.kv([
          [
            "installed",
            `${installedName || "unknown"} v${installedVersion || "?"} \u00b7 checksum ${short(link?.checksum)}`,
          ],
          ["installed at", link?.installedAt],
          ["installed from", installedSource || undefined],
        ]);
      } else {
        ui.fail("no harness installed in this repo");
        ui.hint("stack harness install");
      }
      if (publishedVersion) {
        ui.kv([["published", `${publishedName} v${publishedVersion} \u00b7 checksum ${short(pack.checksum)}`]]);
        if (upToDate) {
          ui.ok("installed pack matches the published pack");
        } else {
          const installedLabel = `${installedName || "nothing"} ${installedVersion || ""}`.trim();
          ui.fail(
            `pending switch: installed ${installedLabel} but the portal publishes ${publishedName} ${publishedVersion}`,
          );
          ui.hint("stack harness install");
        }
      } else {
        ui.warn("could not ask the portal for the published pack");
        ui.hint("npm run dev:portal");
      }

      ui.section("files");
      if (toml) {
        const versionNote = toml.packVersion ? `${toml.packName || "pack"} v${toml.packVersion}` : "no [pack] version";
        const stale =
          (publishedVersion && toml.packVersion && toml.packVersion !== publishedVersion) ||
          (publishedName && toml.packName && toml.packName !== publishedName);
        if (stale) {
          ui.fail(`stack.toml says ${versionNote}, portal publishes ${publishedName} v${publishedVersion}`);
          ui.hint("stack harness install");
        } else {
          ui.ok(`stack.toml present \u00b7 ${versionNote}`);
        }
      } else {
        ui.fail("stack.toml missing, this repo is not harness governed");
        ui.hint("stack harness install");
      }
      if (packDirExists) {
        if (digestMatches) ui.ok(`.stack/pack present \u00b7 ${digest.files} files \u00b7 digest ${short(digest.digest)}`);
        else {
          ui.fail(`.stack/pack digest ${short(digest.digest)} does not match the install record`);
          ui.hint("stack harness install --force");
        }
      } else {
        ui.fail(".stack/pack is missing");
        ui.hint("stack harness install");
      }

      ui.section("hooks");
      for (const hook of hooks) {
        if (hook.present && hook.executable) ui.ok(`.git/hooks/${hook.name} ${ui.muted(hook.mode ?? "")}`);
        else if (hook.present) {
          ui.fail(`.git/hooks/${hook.name} is not executable`);
          ui.hint(`chmod 755 ${hook.path}`);
        } else {
          ui.fail(`.git/hooks/${hook.name} is missing`);
          ui.hint("stack harness install");
        }
      }

      if (isDefault) {
        ui.section("link");
        ui.info(`  ${ui.muted("no project linked \u2014 running the org-level default harness")}`);
        ui.hint("stack project link <KEY>   # then: stack harness install");
      }
    },
  );
  return 0;
}

function short(hash) {
  const value = String(hash ?? "");
  return value ? `${value.slice(0, 12)}\u2026` : "unknown";
}
