import { prisma } from "@stack/db";
import { authenticate, jsonError } from "@/lib/api-auth";
import { parseAcceptance } from "@/lib/queries";

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const ctx = await authenticate(request);
    const { key } = await params;
    const url = new URL(request.url);
    const mine = url.searchParams.get("mine");
    const status = url.searchParams.get("status");

    const project = await prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (!project) return Response.json({ error: `Unknown project ${key}` }, { status: 404 });

    const issues = await prisma.issue.findMany({
      where: {
        projectId: project.id,
        ...(mine === "1" || mine === "true" ? { assigneeId: ctx.user.id } : {}),
        ...(status ? { status: status.toUpperCase() } : {}),
      },
      orderBy: [{ status: "asc" }, { handle: "asc" }],
      include: {
        wave: { select: { number: true, name: true } },
        assignee: { select: { name: true, email: true } },
      },
    });

    return Response.json({
      project: { key: project.key, name: project.name },
      issues: issues.map((issue) => ({
        handle: issue.handle,
        title: issue.title,
        status: issue.status,
        type: issue.type,
        estimate: issue.estimate,
        wave: issue.wave ? `${issue.wave.number}. ${issue.wave.name}` : null,
        assignee: issue.assignee?.name ?? null,
        branch: issue.branch,
        prNumber: issue.prNumber,
        acceptance: parseAcceptance(issue.acceptance),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
