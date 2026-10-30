import { prisma } from "@stack/db";
import { signPayload } from "@stack/core";
import { authenticate, jsonError } from "@/lib/api-auth";
import { publishedPack } from "@/lib/queries";

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    await authenticate(request);
    const { key } = await params;

    const project = await prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (!project) return Response.json({ error: `Unknown project ${key}` }, { status: 404 });

    const current = await publishedPack(project.id);
    if (!current) {
      return Response.json(
        {
          error: `No published harness pack for ${project.key}. A project lead publishes one in the portal under Harness packs.`,
        },
        { status: 404 },
      );
    }

    const secret = process.env.STACK_SIGNING_SECRET ?? "miracle-dev-signing-secret";
    const signed = signPayload(
      { projectKey: project.key, versionId: current.version.id },
      secret,
      900,
    );

    return Response.json({
      pack: {
        name: current.pack.name,
        description: current.pack.description,
        version: current.version.version,
        checksum: current.version.checksum,
        components: current.version.components.length,
        publishedAt: current.version.publishedAt,
        publishedBy: current.version.publishedBy?.name ?? null,
        notes: current.version.notes,
      },
      project: {
        key: project.key,
        name: project.name,
        handlePattern: project.handlePattern,
      },
      downloadUrl: `/api/harness/download?t=${encodeURIComponent(signed)}`,
      installCommand: "stack harness install",
    });
  } catch (error) {
    return jsonError(error);
  }
}
