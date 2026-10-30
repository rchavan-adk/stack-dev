import { prisma } from "@stack/db";
import { authenticate, jsonError, visibleProjectIds } from "@/lib/api-auth";

export async function GET(request: Request) {
  try {
    const ctx = await authenticate(request);
    const ids = await visibleProjectIds(ctx);

    const projects = await prisma.project.findMany({
      where: ids ? { id: { in: ids } } : undefined,
      orderBy: { key: "asc" },
      include: {
        waves: { select: { id: true, status: true } },
        issues: { select: { status: true } },
        repos: { select: { name: true, provider: true, defaultBranch: true } },
      },
    });

    return Response.json({
      projects: projects.map((project) => ({
        key: project.key,
        name: project.name,
        client: project.client,
        status: project.status,
        waves: project.waves.length,
        activeWaves: project.waves.filter((wave) => wave.status === "ACTIVE").length,
        openIssues: project.issues.filter((issue) => issue.status !== "DONE").length,
        repos: project.repos,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
