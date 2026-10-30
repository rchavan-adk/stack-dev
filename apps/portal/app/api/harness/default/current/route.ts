import { prisma } from "@stack/db";
import { signPayload } from "@stack/core";
import { authenticate, jsonError } from "@/lib/api-auth";

/**
 * The org-level default harness: what a developer installs before a lead
 * publishes a project pack. Same response shape as
 * /api/projects/[key]/harness/current, with project: null.
 */
export async function GET(request: Request) {
  try {
    await authenticate(request);

    const pack = await prisma.harnessPack.findFirst({
      where: { projectId: null },
      include: {
        versions: {
          where: { status: "PUBLISHED" },
          orderBy: { publishedAt: "desc" },
          take: 1,
          include: { components: true, publishedBy: true },
        },
      },
    });
    const version = pack?.versions[0];
    if (!pack || !version) {
      return Response.json({ error: "No default harness pack is published." }, { status: 404 });
    }

    const secret = process.env.STACK_SIGNING_SECRET ?? "miracle-dev-signing-secret";
    const signed = signPayload({ projectKey: "DEFAULT", versionId: version.id }, secret, 900);

    return Response.json({
      pack: {
        name: pack.name,
        description: pack.description,
        version: version.version,
        checksum: version.checksum,
        components: version.components.length,
        publishedAt: version.publishedAt,
        publishedBy: version.publishedBy?.name ?? null,
        notes: version.notes,
      },
      project: null,
      downloadUrl: `/api/harness/download?t=${encodeURIComponent(signed)}`,
      installCommand: "stack harness install",
    });
  } catch (error) {
    return jsonError(error);
  }
}
