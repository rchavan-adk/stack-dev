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
        memberships: { where: { userId: ctx.user.id }, select: { role: true } },
        issues: { select: { status: true, assigneeId: true } },
      },
    });

    return Response.json({
      user: ctx.user,
      token: { role: ctx.role, scopedProjectId: ctx.projectId },
      projects: projects.map((project) => ({
        key: project.key,
        name: project.name,
        client: project.client,
        role: project.memberships[0]?.role ?? ctx.role,
        openIssues: project.issues.filter((issue) => issue.status !== "DONE").length,
        assignedToMe: project.issues.filter(
          (issue) => issue.assigneeId === ctx.user.id && issue.status !== "DONE",
        ).length,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
