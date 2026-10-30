import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@stack/db";
import { ISSUE_TRANSITIONS, type IssueStatus } from "@stack/core";
import { CheckCircle2, GitPullRequest, Undo2, UserRoundCog } from "lucide-react";
import { EventKindBadge, IssueStatusBadge, IssueTypeBadge } from "@/components/status";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { parseAcceptance } from "@/lib/queries";
import { formatUsd } from "@/lib/format";
import { approveIssue, assignIssue, sendBackIssue, validateIssue } from "../../../actions";

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ key: string; handle: string }>;
}) {
  const user = await requireSessionUser();
  const { key, handle } = await params;

  const issue = await prisma.issue.findUnique({
    where: { handle: handle.toUpperCase() },
    include: {
      project: { select: { key: true, name: true, handlePattern: true } },
      wave: { select: { number: true, name: true, goal: true, status: true } },
      assignee: { select: { id: true, name: true, email: true } },
      spec: { include: { approvedBy: { select: { name: true } } } },
      events: { orderBy: { createdAt: "desc" } },
      modelCalls: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!issue || issue.project.key !== key.toUpperCase()) notFound();

  const acceptance = parseAcceptance(issue.acceptance);
  // Anyone who can hold work on this engagement. Clients observe, they do not own items.
  const members = await prisma.membership.findMany({
    where: { projectId: issue.projectId, role: { not: "CLIENT" } },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const spend = issue.modelCalls
    .filter((call) => call.allowed)
    .reduce((sum, call) => sum + call.costUsd, 0);
  const allowedNext = ISSUE_TRANSITIONS[issue.status as IssueStatus] ?? [];
  const admin = canAdminister(user.role);

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-6">
        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="stack-mono text-sm text-primary">{issue.handle}</span>
                  <IssueTypeBadge type={issue.type} />
                  <IssueStatusBadge status={issue.status} />
                </div>
                <h1 className="mt-1 text-xl font-semibold">{issue.title}</h1>
                <p className="text-sm text-base-content/60">
                  {issue.wave ? `Wave ${issue.wave.number} · ${issue.wave.name}` : "No wave"} ·{" "}
                  {issue.estimate ?? "?"} points ·{" "}
                  {issue.assignee ? `owned by ${issue.assignee.name}` : "unassigned"}
                </p>
              </div>
              {issue.prNumber && (
                <span className="badge badge-outline gap-1">
                  <GitPullRequest size={12} /> PR #{issue.prNumber}
                </span>
              )}
            </div>

            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-base-content/80">
              {issue.body}
            </div>
          </div>
        </section>

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body">
            <h2 className="card-title text-base">Acceptance criteria</h2>
            <p className="text-xs text-base-content/60">
              The definition of correct. Validation checks these, one by one.
            </p>
            <ul className="mt-2 space-y-2">
              {acceptance.map((criterion, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-primary mt-0.5"
                    defaultChecked={issue.status === "DONE"}
                    disabled
                  />
                  <span>{criterion}</span>
                </li>
              ))}
              {acceptance.length === 0 && (
                <li className="text-sm text-base-content/60">
                  No acceptance criteria recorded. The issue template requires at least two.
                </li>
              )}
            </ul>
          </div>
        </section>

        {issue.spec && (
          <section className="card border border-base-300 bg-base-100 shadow-sm">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title text-base">Spec: {issue.spec.title}</h2>
                <span className="badge badge-success badge-outline badge-sm">
                  {issue.spec.status.toLowerCase()}
                  {issue.spec.approvedBy ? ` by ${issue.spec.approvedBy.name}` : ""}
                </span>
              </div>
              <div className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-box bg-base-200 p-4 text-sm">
                {issue.spec.body}
              </div>
            </div>
          </section>
        )}

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body">
            <h2 className="card-title text-base">Evidence</h2>
            <p className="text-xs text-base-content/60">
              Every status change points at a row here. Nothing moves on a claim alone.
            </p>
            <ul className="mt-3 space-y-3">
              {issue.events.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <EventKindBadge kind={event.kind} />
                      <time className="text-xs text-base-content/40">
                        {event.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </time>
                    </div>
                    <p className="text-sm">{event.summary}</p>
                    <p className="text-xs text-base-content/50">{event.actor}</p>
                  </div>
                </li>
              ))}
              {issue.events.length === 0 && (
                <li className="text-sm text-base-content/60">No evidence recorded yet.</li>
              )}
            </ul>
          </div>
        </section>
      </div>

      <aside className="space-y-6">
        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-3">
            <h2 className="card-title text-base">Human decisions</h2>

            {!admin && (
              <div className="alert alert-soft text-xs">
                <span>
                  Approval and validation are lead or admin actions. Agents and developers propose.
                </span>
              </div>
            )}

            {admin && issue.status === "BACKLOG" && (
              <form action={approveIssue} className="space-y-2">
                <input type="hidden" name="handle" value={issue.handle} />
                <input type="hidden" name="projectKey" value={issue.project.key} />
                <fieldset className="fieldset">
                  <legend className="fieldset-legend text-xs">Assign to</legend>
                  <select name="assigneeId" className="select select-bordered select-sm w-full">
                    <option value="">leave unassigned</option>
                    {members.map((membership) => (
                      <option key={membership.user.id} value={membership.user.id}>
                        {membership.user.name}
                      </option>
                    ))}
                  </select>
                </fieldset>
                <button type="submit" className="btn btn-primary btn-sm w-full">
                  Approve for a wave
                </button>
                <p className="text-xs text-base-content/50">
                  Backlog to Approved is human-only; the MCP refuses it.
                </p>
              </form>
            )}

            {admin && issue.status === "AWAITING_VALIDATION" && (
              <>
                <form action={validateIssue} className="space-y-2">
                  <input type="hidden" name="handle" value={issue.handle} />
                  <input type="hidden" name="projectKey" value={issue.project.key} />
                  <fieldset className="fieldset">
                    <legend className="fieldset-legend text-xs">Validation note</legend>
                    <textarea
                      name="note"
                      rows={2}
                      placeholder="Checked each acceptance criterion against the merged change."
                      className="textarea textarea-bordered textarea-sm w-full"
                    />
                  </fieldset>
                  <button type="submit" className="btn btn-success btn-sm w-full">
                    <CheckCircle2 size={16} /> Validate and close
                  </button>
                </form>
                <form action={sendBackIssue}>
                  <input type="hidden" name="handle" value={issue.handle} />
                  <input type="hidden" name="projectKey" value={issue.project.key} />
                  <input type="hidden" name="note" value="validation found gaps" />
                  <button type="submit" className="btn btn-ghost btn-sm w-full">
                    <Undo2 size={16} /> Send back to in progress
                  </button>
                </form>
              </>
            )}

            {admin && !["BACKLOG", "AWAITING_VALIDATION"].includes(issue.status) && (
              <p className="text-sm text-base-content/60">
                Nothing to decide right now. This item moves on git evidence until it reaches
                awaiting validation.
              </p>
            )}

            {admin && issue.status !== "BACKLOG" && issue.status !== "DONE" && (
              <form action={assignIssue} className="space-y-2">
                <input type="hidden" name="handle" value={issue.handle} />
                <input type="hidden" name="projectKey" value={issue.project.key} />
                <fieldset className="fieldset">
                  <legend className="fieldset-legend text-xs">Owner</legend>
                  <select
                    name="assigneeId"
                    defaultValue={issue.assigneeId ?? ""}
                    className="select select-bordered select-sm w-full"
                  >
                    <option value="">unassigned</option>
                    {members.map((membership) => (
                      <option key={membership.user.id} value={membership.user.id}>
                        {membership.user.name} ({membership.role.toLowerCase()})
                      </option>
                    ))}
                  </select>
                </fieldset>
                <button type="submit" className="btn btn-outline btn-sm w-full">
                  <UserRoundCog size={16} /> Update owner
                </button>
                <p className="text-xs text-base-content/50">
                  Reassignment is recorded as evidence, like every other change.
                </p>
              </form>
            )}

            <div className="divider my-1 text-xs">machine transitions</div>
            <p className="text-xs text-base-content/60">
              From <span className="stack-mono">{issue.status}</span> a token may move this to{" "}
              {allowedNext.length ? (
                <span className="stack-mono">{allowedNext.join(", ")}</span>
              ) : (
                "nothing"
              )}
              .
            </p>
          </div>
        </section>

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-2">
            <h2 className="card-title text-base">Cost of this item</h2>
            <div className="text-2xl font-semibold">${formatUsd(spend)}</div>
            <p className="text-xs text-base-content/60">
              {issue.modelCalls.length} gateway call{issue.modelCalls.length === 1 ? "" : "s"} tagged{" "}
              <span className="stack-mono">{issue.handle}</span>
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {issue.modelCalls.slice(0, 6).map((call) => (
                <li key={call.id} className="flex items-center justify-between gap-2">
                  <span className="stack-mono truncate">{call.model}</span>
                  <span className={call.allowed ? "" : "text-error"}>
                    {call.allowed ? `$${formatUsd(call.costUsd)}` : "denied"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-2">
            <h2 className="card-title text-base">Work it from the IDE</h2>
            <div className="mockup-code text-xs">
              <pre data-prefix="$">
                <code>stack claim {issue.handle}</code>
              </pre>
              <pre data-prefix="$">
                <code>git switch -c stack/{issue.handle.toLowerCase()}-slug</code>
              </pre>
              <pre data-prefix="$">
                <code>git commit -m &quot;{issue.handle}: ...&quot;</code>
              </pre>
            </div>
            <Link href={`/projects/${issue.project.key}/harness`} className="link link-hover text-xs text-primary">
              Harness install instructions
            </Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
