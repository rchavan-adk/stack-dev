import { prisma } from "@stack/db";
import { authenticate, jsonError } from "@/lib/api-auth";
import { parseAcceptance } from "@/lib/queries";

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  try {
    await authenticate(request);
    const { handle } = await params;

    const issue = await prisma.issue.findUnique({
      where: { handle: handle.toUpperCase() },
      include: {
        project: { select: { key: true, name: true, handlePattern: true, gatewayUrl: true } },
        wave: { select: { number: true, name: true, goal: true, status: true } },
        assignee: { select: { name: true, email: true } },
        spec: true,
        events: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!issue) return Response.json({ error: `Unknown item ${handle}` }, { status: 404 });

    return Response.json({
      issue: {
        handle: issue.handle,
        title: issue.title,
        body: issue.body,
        type: issue.type,
        status: issue.status,
        estimate: issue.estimate,
        branch: issue.branch,
        prNumber: issue.prNumber,
        acceptance: parseAcceptance(issue.acceptance),
        assignee: issue.assignee?.name ?? null,
        project: issue.project,
        wave: issue.wave,
      },
      spec: issue.spec
        ? { title: issue.spec.title, body: issue.spec.body, status: issue.spec.status }
        : null,
      events: issue.events.map((event) => ({
        kind: event.kind,
        actor: event.actor,
        summary: event.summary,
        createdAt: event.createdAt,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
