import { prisma } from "@stack/db";
import { verifyPayload } from "@stack/core";
import { buildPackTarball } from "@/lib/harness";

/**
 * Signed download, so a link can be handed to the CLI, an agent or a CI job
 * without passing an API token around. The signature carries the version id and expires.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const signed = url.searchParams.get("t");
  if (!signed) {
    return Response.json({ error: "Missing signed token (t)." }, { status: 400 });
  }

  const secret = process.env.STACK_SIGNING_SECRET ?? "miracle-dev-signing-secret";
  const payload = verifyPayload<{ projectKey: string; versionId: string }>(signed, secret);
  if (!payload) {
    return Response.json(
      { error: "Download link is invalid or expired. Run `stack harness install` again." },
      { status: 403 },
    );
  }

  const version = await prisma.harnessVersion.findUnique({
    where: { id: payload.versionId },
    include: { components: true, pack: { include: { project: true } } },
  });
  if (!version) {
    return Response.json({ error: "Harness version no longer exists." }, { status: 404 });
  }

  const tarball = await buildPackTarball(
    version.components.map((component) => ({
      path: component.path,
      content: component.content,
      mode: component.mode,
    })),
  );

  const filename = `${version.pack.name}-${version.version}.tgz`;
  return new Response(new Uint8Array(tarball), {
    headers: {
      "content-type": "application/gzip",
      "content-length": String(tarball.byteLength),
      "content-disposition": `attachment; filename="${filename}"`,
      "x-stack-pack": version.pack.name,
      "x-stack-pack-version": version.version,
      "x-stack-pack-checksum": version.checksum ?? "",
    },
  });
}
