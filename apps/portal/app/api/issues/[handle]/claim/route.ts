import { prisma } from "@stack/db";
import { authenticate, jsonError } from "@/lib/api-auth";

export async function POST(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  try {
    const ctx = await authenticate(request);
    const { handle } = await params;

    const issue = await prisma.issue.findUnique({
      where: { handle: handle.toUpperCase() },
      include: { assignee: { select: { id: true, name: true } } },
    });
    if (!issue) return Response.json({ error: `Unknown item ${handle}` }, { status: 404 });

    if (issue.assignee && issue.assignee.id !== ctx.user.id) {
      return Response.json(
        { error: `${issue.handle} is assigned to ${issue.assignee.name}.` },
        { status: 409 },
      );
    }
    if (!["APPROVED", "IN_PROGRESS"].includes(issue.status)) {
      return Response.json(
        {
          error: `${issue.handle} is ${issue.status}. Only an approved item can be claimed, and approval is a human decision.`,
        },
        { status: 409 },
      );
    }

    const updated = await prisma.issue.update({
      where: { id: issue.id },
      data: { assigneeId: ctx.user.id, status: "IN_PROGRESS" },
      include: { wave: { select: { number: true, name: true } } },
    });

    await prisma.event.create({
      data: {
        projectId: issue.projectId,
        issueId: issue.id,
        kind: "CLAIMED",
        actor: ctx.user.name,
        summary: `${issue.handle} claimed by ${ctx.user.name}`,
      },
    });

    return Response.json({
      issue: {
        handle: updated.handle,
        title: updated.title,
        status: updated.status,
        wave: updated.wave ? `${updated.wave.number}. ${updated.wave.name}` : null,
        branchSuggestion: `stack/${updated.handle}-${updated.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40)}`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
