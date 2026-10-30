import { createGzip } from "node:zlib";
import { pack as tarPack } from "tar-stream";
import { sha256 } from "@stack/core";

export interface PackFile {
  path: string;
  content: string;
  mode: string;
}

/**
 * Checksum formula, shared by the seed, the admin publish action and the CLI:
 * sha256 over sorted "path:sha256(content)" lines joined by newline.
 * Changing it invalidates every installed pack, so keep it in one place.
 */
export function packChecksum(files: PackFile[]): string {
  return sha256(
    files
      .map((file) => `${file.path}:${sha256(file.content)}`)
      .sort()
      .join("\n"),
  );
}

/** Builds the gzipped tar the CLI extracts into .stack/pack. */
export async function buildPackTarball(files: PackFile[]): Promise<Buffer> {
  const archive = tarPack();
  const gzip = createGzip();
  const chunks: Buffer[] = [];

  const collected = new Promise<Buffer>((resolve, reject) => {
    gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);
    archive.on("error", reject);
  });

  archive.pipe(gzip);

  for (const file of files) {
    archive.entry(
      {
        name: file.path,
        mode: parseInt(file.mode || "644", 8),
        size: Buffer.byteLength(file.content, "utf8"),
      },
      file.content,
    );
  }
  archive.finalize();

  return collected;
}
