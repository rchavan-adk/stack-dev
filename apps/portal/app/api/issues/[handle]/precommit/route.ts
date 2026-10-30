import { prisma } from "@stack/db";
import { authenticate, jsonError } from "@/lib/api-auth";

/**
 * Called by the pack's commit-msg hook. It answers one question: may this person
 * commit against this item right now? Fast, and safe to fail open on network errors
 * because the server-side verify re-checks the same rule.
 */
export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  try {
    const ctx = await authenticate(request);
    const { handle } = await params;

    const issue = await prisma.issue.findUnique({
      where: { handle: handle.toUpperCase() },
      include: { project: { select: { key: true } }, assignee: { select: { id: true, name: true } } },
    });

    if (!issue) {
      return Response.json({
        ok: false,
        reason: `no such item in the portal (${handle.toUpperCase()})`,
      });
    }
    if (issue.status === "DONE") {
      return Response.json({ ok: false, reason: "item is already Done" });
    }
    if (issue.assignee && issue.assignee.id !== ctx.user.id) {
      return Response.json({
        ok: false,
        reason: `assigned to ${issue.assignee.name}, not to you`,
      });
    }
    if (issue.status !== "IN_PROGRESS") {
      return Response.json({
        ok: false,
        reason: `status is ${issue.status}; claim it first with \`stack claim ${issue.handle}\``,
      });
    }

    return Response.json({
      ok: true,
      handle: issue.handle,
      project: issue.project.key,
      status: issue.status,
    });
  } catch (error) {
    return jsonError(error);
  }
}
