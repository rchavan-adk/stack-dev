import { ISSUE_STATUSES, type IssueStatus } from "@stack/core";
import { authenticate, jsonError } from "@/lib/api-auth";
import { transitionIssue } from "@/lib/issues";

export async function POST(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  try {
    const ctx = await authenticate(request);
    const { handle } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: string; note?: string };

    const to = String(body.status ?? "").toUpperCase() as IssueStatus;
    if (!ISSUE_STATUSES.includes(to)) {
      return Response.json(
        { error: `status must be one of ${ISSUE_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }

    const result = await transitionIssue({
      handle,
      to,
      actor: `${ctx.user.name} (token ${ctx.role.toLowerCase()})`,
      note: body.note,
      humanDriven: false,
    });

    if (!result.ok) {
      return Response.json({ error: result.reason }, { status: result.status });
    }

    return Response.json({
      issue: {
        handle: result.issue?.handle,
        status: result.issue?.status,
        title: result.issue?.title,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
