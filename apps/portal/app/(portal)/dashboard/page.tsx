import Link from "next/link";
import { prisma } from "@stack/db";
import { ISSUE_STATUS_LABELS, type IssueStatus } from "@stack/core";
import { AlertTriangle, ArrowUpRight, CircleDollarSign, GitPullRequest, Package } from "lucide-react";
import { EventKindBadge, IssueStatusBadge, IssueTypeBadge, WaveStatusBadge } from "@/components/status";
import { requireSessionUser } from "@/lib/session";
import { projectSpend, statusCounts } from "@/lib/queries";
import { formatUsd } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireSessionUser();

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { project: { include: { waves: { orderBy: { number: "asc" } } } } },
  });
  const projects =
    user.role === "ADMIN"
      ? await prisma.project.findMany({ include: { waves: { orderBy: { number: "asc" } } } })
      : memberships.map((membership) => membership.project);

  const primary = projects[0];
  const [counts, spend] = primary
    ? await Promise.all([statusCounts(primary.id), projectSpend(primary.id)])
    : [null, null];

  const assigned = await prisma.issue.findMany({
    where: { assigneeId: user.id, status: { not: "DONE" } },
    orderBy: [{ status: "asc" }, { handle: "asc" }],
    include: { project: { select: { key: true } }, wave: { select: { number: true, name: true } } },
    take: 8,
  });

  const awaiting = await prisma.issue.findMany({
    where: {
      status: "AWAITING_VALIDATION",
      projectId: { in: projects.map((project) => project.id) },
    },
    include: { project: { select: { key: true } }, assignee: { select: { name: true } } },
    take: 6,
  });

  const events = await prisma.event.findMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { issue: { select: { handle: true } }, project: { select: { key: true } } },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Good to see you, {user.name.split(" ")[0]}</h1>
          <p className="text-sm text-base-content/60">
            {user.title ?? user.role} · {projects.length} project
            {projects.length === 1 ? "" : "s"} · status comes from git evidence, never from a claim
          </p>
        </div>
        <Link href="/get-started" className="btn btn-primary btn-sm">
          Set up my machine <ArrowUpRight size={16} />
        </Link>
      </header>

      {primary && counts && spend && (
        <section className="stats stats-vertical w-full border border-base-300 bg-base-100 shadow-sm sm:stats-horizontal">
          <div className="stat">
            <div className="stat-title">Open items</div>
            <div className="stat-value text-primary">
              {Object.entries(counts)
                .filter(([status]) => status !== "DONE")
                .reduce((sum, [, value]) => sum + value, 0)}
            </div>
            <div className="stat-desc">{primary.key} · {primary.name}</div>
          </div>
          <div className="stat">
            <div className="stat-figure text-secondary">
              <GitPullRequest size={22} />
            </div>
            <div className="stat-title">In review</div>
            <div className="stat-value">{counts.IN_REVIEW}</div>
            <div className="stat-desc">moved by pull request events</div>
          </div>
          <div className="stat">
            <div className="stat-figure text-warning">
              <AlertTriangle size={22} />
            </div>
            <div className="stat-title">Awaiting validation</div>
            <div className="stat-value text-warning">{counts.AWAITING_VALIDATION}</div>
            <div className="stat-desc">merged, needs a person</div>
          </div>
          <div className="stat">
            <div className="stat-figure text-accent">
              <CircleDollarSign size={22} />
            </div>
            <div className="stat-title">Model spend</div>
            <div className="stat-value text-accent">${formatUsd(spend.usedUsd)}</div>
            <div className="stat-desc">
              of ${primary.budgetUsd.toFixed(0)} · {spend.denied} call
              {spend.denied === 1 ? "" : "s"} denied
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card border border-base-300 bg-base-100 shadow-sm lg:col-span-2">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <h2 className="card-title text-base">My work</h2>
              <span className="text-xs text-base-content/50">pulled by the developer MCP too</span>
            </div>

            {assigned.length === 0 ? (
              <div className="alert alert-soft text-sm">
                <span>Nothing assigned to you. A lead approves and assigns items in the portal.</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-zebra table table-sm">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Title</th>
                      <th>Wave</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assigned.map((issue) => (
                      <tr key={issue.handle}>
                        <td className="stack-mono text-xs">
                          <Link
                            href={`/projects/${issue.project.key}/issues/${issue.handle}`}
                            className="link link-hover text-primary"
                          >
                            {issue.handle}
                          </Link>
                        </td>
                        <td className="max-w-sm">
                          <div className="flex items-center gap-2">
                            <IssueTypeBadge type={issue.type} />
                            <span className="truncate">{issue.title}</span>
                          </div>
                        </td>
                        <td className="text-xs text-base-content/60">
                          {issue.wave ? `${issue.wave.number}. ${issue.wave.name}` : "—"}
                        </td>
                        <td>
                          <IssueStatusBadge status={issue.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body">
            <h2 className="card-title text-base">Waiting on a person</h2>
            <p className="text-xs text-base-content/60">
              Merged work stops here. Only validation closes an item.
            </p>
            <ul className="mt-2 space-y-2">
              {awaiting.length === 0 && (
                <li className="text-sm text-base-content/60">Nothing awaiting validation.</li>
              )}
              {awaiting.map((issue) => (
                <li
                  key={issue.handle}
                  className="rounded-box border border-base-300 bg-base-200 px-3 py-2"
                >
                  <Link
                    href={`/projects/${issue.project.key}/issues/${issue.handle}`}
                    className="link link-hover stack-mono text-xs text-primary"
                  >
                    {issue.handle}
                  </Link>
                  <p className="truncate text-sm">{issue.title}</p>
                  <p className="text-xs text-base-content/50">by {issue.assignee?.name ?? "unassigned"}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body">
            <h2 className="card-title text-base">Projects</h2>
            <div className="space-y-3">
              {projects.map((project) => {
                const active = project.waves.find((wave) => wave.status === "ACTIVE");
                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.key}`}
                    className="flex items-center justify-between rounded-box border border-base-300 px-4 py-3 transition hover:border-primary hover:bg-base-200"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="badge badge-sm badge-secondary stack-mono">{project.key}</span>
                        <span className="font-medium">{project.name}</span>
                      </div>
                      <p className="text-xs text-base-content/60">{project.client}</p>
                    </div>
                    <div className="text-right text-xs">
                      {active ? (
                        <>
                          <WaveStatusBadge status={active.status} />
                          <p className="mt-1 text-base-content/60">
                            Wave {active.number} · {active.name}
                          </p>
                        </>
                      ) : (
                        <span className="text-base-content/50">no active wave</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <h2 className="card-title text-base">Evidence ledger</h2>
              <Package size={16} className="text-base-content/40" />
            </div>
            <ul className="timeline timeline-vertical timeline-compact timeline-snap-icon">
              {events.map((event, index) => (
                <li key={event.id}>
                  {index > 0 && <hr />}
                  <div className="timeline-middle">
                    <span className="block h-2 w-2 rounded-full bg-primary" />
                  </div>
                  <div className="timeline-end mb-3 w-full">
                    <div className="flex flex-wrap items-center gap-2">
                      <EventKindBadge kind={event.kind} />
                      {event.issue && (
                        <span className="stack-mono text-xs text-base-content/60">
                          {event.issue.handle}
                        </span>
                      )}
                      <time className="text-xs text-base-content/40">
                        {event.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </time>
                    </div>
                    <p className="text-sm">{event.summary}</p>
                    <p className="text-xs text-base-content/50">{event.actor}</p>
                  </div>
                  {index < events.length - 1 && <hr />}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {counts && (
        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body">
            <h2 className="card-title text-base">Pipeline</h2>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(counts) as IssueStatus[]).map((status) => (
                <div
                  key={status}
                  className="flex-1 rounded-box border border-base-300 bg-base-200 px-4 py-3 text-center"
                >
                  <div className="text-2xl font-semibold">{counts[status]}</div>
                  <div className="text-xs text-base-content/60">{ISSUE_STATUS_LABELS[status]}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
