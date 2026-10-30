import { prisma } from "@stack/db";
import { authenticate, jsonError } from "@/lib/api-auth";
import { publishedPack, statusCounts } from "@/lib/queries";

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    await authenticate(request);
    const { key } = await params;

    const project = await prisma.project.findUnique({
      where: { key: key.toUpperCase() },
      include: {
        repos: true,
        waves: { orderBy: { number: "asc" }, include: { issues: { select: { status: true } } } },
      },
    });
    if (!project) return Response.json({ error: `Unknown project ${key}` }, { status: 404 });

    const [counts, pack] = await Promise.all([
      statusCounts(project.id),
      publishedPack(project.id),
    ]);

    return Response.json({
      project: {
        key: project.key,
        name: project.name,
        client: project.client,
        summary: project.summary,
        status: project.status,
        handlePattern: project.handlePattern,
      },
      waves: project.waves.map((wave) => ({
        number: wave.number,
        name: wave.name,
        goal: wave.goal,
        status: wave.status,
        startsOn: wave.startsOn,
        endsOn: wave.endsOn,
        issues: wave.issues.length,
        done: wave.issues.filter((issue) => issue.status === "DONE").length,
      })),
      counts,
      repos: project.repos.map((repo) => ({
        name: repo.name,
        provider: repo.provider,
        remotePath: repo.remotePath,
        defaultBranch: repo.defaultBranch,
      })),
      harness: pack
        ? {
            packName: pack.pack.name,
            version: pack.version.version,
            checksum: pack.version.checksum,
            components: pack.version.components.length,
          }
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
