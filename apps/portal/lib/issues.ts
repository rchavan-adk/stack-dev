import { prisma } from "@stack/db";
import { HUMAN_ONLY_TRANSITIONS, ISSUE_TRANSITIONS, type IssueStatus } from "@stack/core";

export interface TransitionRequest {
  handle: string;
  to: IssueStatus;
  actor: string;
  note?: string;
  /** Only a signed-in person in the portal may drive the human-only transitions. */
  humanDriven?: boolean;
  eventKind?: string;
}

export interface TransitionResult {
  ok: boolean;
  status: number;
  reason?: string;
  issue?: Awaited<ReturnType<typeof prisma.issue.findUnique>>;
}

export async function transitionIssue(req: TransitionRequest): Promise<TransitionResult> {
  const issue = await prisma.issue.findUnique({ where: { handle: req.handle.toUpperCase() } });
  if (!issue) {
    return { ok: false, status: 404, reason: `Unknown item ${req.handle}` };
  }

  const from = issue.status as IssueStatus;
  if (from === req.to) {
    return { ok: true, status: 200, issue };
  }

  const allowed = ISSUE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(req.to)) {
    return {
      ok: false,
      status: 409,
      reason: `${issue.handle} is ${from}; it can only move to ${allowed.join(", ") || "nothing"}.`,
    };
  }

  const humanOnly = HUMAN_ONLY_TRANSITIONS.some(
    (rule) => rule.from === from && rule.to === req.to,
  );
  if (humanOnly && !req.humanDriven) {
    return {
      ok: false,
      status: 409,
      reason: `${from} to ${req.to} is a human decision. A person must do this in the portal; agents propose, people decide.`,
    };
  }

  const updated = await prisma.issue.update({
    where: { id: issue.id },
    data: { status: req.to },
  });

  await prisma.event.create({
    data: {
      projectId: issue.projectId,
      issueId: issue.id,
      kind: req.eventKind ?? (req.to === "DONE" ? "VALIDATED" : "STATUS_REPORTED"),
      actor: req.actor,
      summary: `${issue.handle}: ${from} to ${req.to}${req.note ? ` — ${req.note}` : ""}`,
      payload: JSON.stringify({ from, to: req.to, note: req.note ?? null }),
    },
  });

  return { ok: true, status: 200, issue: updated };
}

/** Next free handle for a project, following its own handle pattern. */
export async function nextHandle(projectId: string, pattern: string): Promise<string> {
  const prefix = pattern.replace(/-\[.*$/, "");
  const issues = await prisma.issue.findMany({
    where: { projectId },
    select: { handle: true },
  });
  const highest = issues.reduce((max, issue) => {
    const match = /(\d+)$/.exec(issue.handle);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 100);
  return `${prefix}-${highest + 1}`;
}
