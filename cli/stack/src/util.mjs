/** Small filesystem and hashing helpers. No dependencies. */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CliError } from "./errors.mjs";

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readText(file) {
  return fs.readFile(file, "utf8");
}

export async function readJson(file, { fallback = null } = {}) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new CliError(`cannot read ${file}: ${error.message}`);
  }
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CliError(`${file} is not valid JSON: ${error.message}`, {
      fix: `rm ${file}  # then re-run the command that created it`,
    });
  }
}

export async function writeJson(file, value, { mode = 0o644 } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await fs.chmod(file, mode);
  return file;
}

/**
 * Write JSON as a single line. Used for ~/.stack/credentials.json, which the
 * installed commit-msg hook parses with a line-based sed: it expects
 * `"token":"…"` to be on the same line it reads.
 */
export async function writeJsonLine(file, value, { mode = 0o644 } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value)}\n`, { mode });
  await fs.chmod(file, mode);
  return file;
}

export async function writeText(file, text, { mode = 0o644 } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, { mode });
  await fs.chmod(file, mode);
  return file;
}

export async function remove(target) {
  await fs.rm(target, { recursive: true, force: true });
}

export async function mkdirp(target) {
  await fs.mkdir(target, { recursive: true });
  return target;
}

/** Executable bit set for the owner, group or other. */
export async function isExecutable(file) {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export async function fileMode(file) {
  try {
    const stat = await fs.stat(file);
    return `0${(stat.mode & 0o777).toString(8)}`;
  } catch {
    return null;
  }
}

/** Every file under `dir` as [posixRelativePath, content] pairs, path-sorted. */
async function walkFiles(dir) {
  const files = [];
  async function walk(current, prefix) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, relative);
      } else if (entry.isFile()) {
        files.push([relative, await fs.readFile(absolute)]);
      }
    }
  }
  await walk(dir, "");
  return files;
}

/**
 * Deterministic digest of a directory tree: sha256 over
 * "relative/path\0sha256(file)" lines, sorted by path.
 *
 * The portal's `checksum` is a property of the tarball it serves; this digest is
 * what we can recompute locally, so `stack doctor` uses it to detect a pack that
 * was edited after install.
 */
export async function digestDir(dir) {
  const files = (await walkFiles(dir)).map(([relative, content]) => `${relative}\0${sha256(content)}`);
  files.sort();
  return { digest: sha256(files.join("\n")), files: files.length };
}

/**
 * The portal's pack checksum, recomputed from an extracted pack directory:
 * sha256 over sorted "relative/path:sha256(content)" lines joined by newline.
 * Mirrors packChecksum() in the portal (apps/portal/lib/harness.ts) so the CLI
 * can verify a downloaded tarball against the checksum the portal published.
 */
export async function packChecksum(dir) {
  const lines = (await walkFiles(dir)).map(([relative, content]) => `${relative}:${sha256(content)}`);
  lines.sort();
  return sha256(lines.join("\n"));
}
