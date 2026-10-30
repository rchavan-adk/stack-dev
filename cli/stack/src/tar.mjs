/**
 * Tarball extraction for the harness pack.
 *
 * The portal serves a gzipped tar whose entries are pack-relative paths
 * (`components/...`, `ci/...`, `agents/AGENTS.md`, `pack.json`,
 * `stack.toml.template`) with the mode already set in the header, so hooks come
 * out 0755. We preserve those modes.
 */

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";
import { CliError } from "./errors.mjs";

/**
 * Extract a gzipped tar buffer into destDir.
 * Returns [{ path, mode }] for every file written, in archive order.
 */
export async function extractTarGz(buffer, destDir) {
  const root = path.resolve(destDir);
  await fs.mkdir(root, { recursive: true });
  const written = [];
  const extract = tar.extract();

  extract.on("entry", (header, stream, next) => {
    const finish = (error) => {
      if (error) {
        extract.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      next();
    };
    (async () => {
      const name = String(header.name ?? "").replace(/^\.\//, "");
      if (!name || name === ".") return;
      if (name.split("/").includes("..")) {
        throw new CliError(`refusing to extract an archive entry outside the pack: ${header.name}`);
      }
      const target = path.resolve(root, name);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        throw new CliError(`refusing to extract an archive entry outside the pack: ${header.name}`);
      }
      if (header.type === "directory") {
        await fs.mkdir(target, { recursive: true });
        return;
      }
      if (header.type !== "file" && header.type !== "contiguous-file") {
        return;
      }
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.concat(chunks));
      const mode = (header.mode ?? 0o644) & 0o777;
      await fs.chmod(target, mode || 0o644);
      written.push({ path: name, mode });
    })().then(
      () => finish(null),
      (error) => finish(error),
    );
  });

  try {
    await pipeline(Readable.from(buffer), createGunzip(), extract);
  } catch (error) {
    throw new CliError(`could not read the harness tarball: ${error.message}`, {
      fix: "stack harness install --force",
      cause: error,
    });
  }
  return written;
}

/** True when the buffer looks like a gzip stream (magic 1f 8b). */
export function isGzip(buffer) {
  return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}
