import Link from "next/link";
import { notFound } from "next/navigation";
import { ISSUE_STATUS_LABELS, type IssueStatus } from "@stack/core";
import { CircleDollarSign, Package, Users } from "lucide-react";
import { EventKindBadge, IssueStatusBadge, RoleBadge, WaveStatusBadge } from "@/components/status";
import { projectByKey, projectSpend, publishedPack, recentEvents, statusCounts } from "@/lib/queries";
import { formatUsd } from "@/lib/format";
import { prisma } from "@stack/db";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const project = await projectByKey(key);
  if (!project) notFound();

  const [counts, spend, pack, events, awaiting] = await Promise.all([
    statusCounts(project.id),
    projectSpend(project.id),
    publishedPack(project.id),
    recentEvents(project.id, 12),
    prisma.issue.findMany({
      where: { projectId: project.id, status: "AWAITING_VALIDATION" },
      select: { handle: true, title: true },
    }),
  ]);

  const open = (Object.keys(counts) as IssueStatus[])
    .filter((status) => status !== "DONE")
    .reduce((sum, status) => sum + counts[status], 0);
  const remaining = Number((project.budgetUsd - spend.usedUsd).toFixed(2));

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-4">
        <div className="stats border border-base-300 bg-base-100 shadow-sm lg:col-span-2">
          <div className="stat">
            <div className="stat-title">Open items</div>
            <div className="stat-value text-primary">{open}</div>
            <div className="stat-desc">{counts.DONE} done</div>
          </div>
          <div className="stat">
            <div className="stat-title">Awaiting validation</div>
            <div className="stat-value text-warning">{counts.AWAITING_VALIDATION}</div>
            <div className="stat-desc">a person must close these</div>
          </div>
        </div>

        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-2 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Model spend</h3>
              <CircleDollarSign size={16} className="text-accent" />
            </div>
            <div className="text-2xl font-semibold">${formatUsd(spend.usedUsd)}</div>
            <progress
              className={`progress w-full ${remaining < project.budgetUsd * 0.2 ? "progress-warning" : "progress-accent"}`}
              value={spend.usedUsd}
              max={project.budgetUsd}
            />
            <p className="text-xs text-base-content/60">
              ${remaining.toFixed(2)} left of ${project.budgetUsd.toFixed(0)} · {spend.calls} calls ·{" "}
              {spend.denied} denied
            </p>
          </div>
        </div>

        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-2 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Harness pack</h3>
              <Package size={16} className="text-primary" />
            </div>
            {pack ? (
              <>
                <div className="stack-mono text-lg">
                  {pack.pack.name} {pack.version.version}
                </div>
                <p className="text-xs text-base-content/60">
                  {pack.version.components.length} files · checksum{" "}
                  <span className="stack-mono">{pack.version.checksum?.slice(0, 12)}</span>
                </p>
                <Link href={`/projects/${project.key}/harness`} className="btn btn-outline btn-xs mt-1">
                  Install instructions
                </Link>
              </>
            ) : (
              <p className="text-sm text-base-content/60">No pack published yet.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="card border border-base-300 bg-base-100 shadow-sm lg:col-span-2">
          <div className="card-body">
            <h2 className="card-title text-base">Waves</h2>
            <div className="space-y-3">
              {project.waves.map((wave) => {
                const total = project.issues.length;
                return (
                  <div key={wave.id} className="rounded-box border border-base-300 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="badge badge-sm badge-outline stack-mono">
                          W{wave.number}
                        </span>
                        <span className="font-medium">{wave.name}</span>
                        <WaveStatusBadge status={wave.status} />
                      </div>
                      <span className="text-xs text-base-content/50">
                        {wave.startsOn?.toISOString().slice(0, 10) ?? "—"} to{" "}
                        {wave.endsOn?.toISOString().slice(0, 10) ?? "—"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-base-content/70">{wave.goal}</p>
                    {total > 0 && (
                      <Link
                        href={`/projects/${project.key}/waves`}
                        className="link link-hover mt-2 inline-block text-xs text-primary"
                      >
                        See wave backlog
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card border border-base-300 bg-base-100 shadow-sm">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title text-base">Team</h2>
                <Users size={16} className="text-base-content/40" />
              </div>
              <ul className="space-y-2">
                {project.memberships.map((membership) => (
                  <li key={membership.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{membership.user.name}</p>
                      <p className="truncate text-xs text-base-content/50">{membership.user.email}</p>
                    </div>
                    <RoleBadge role={membership.role} />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {awaiting.length > 0 && (
            <div className="card border border-warning/40 bg-warning/5 shadow-sm">
              <div className="card-body">
                <h2 className="card-title text-base">Needs validation</h2>
                <ul className="space-y-2 text-sm">
                  {awaiting.map((issue) => (
                    <li key={issue.handle}>
                      <Link
                        href={`/projects/${project.key}/issues/${issue.handle}`}
                        className="link link-hover"
                      >
                        <span className="stack-mono text-xs text-primary">{issue.handle}</span>{" "}
                        {issue.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body">
            <h2 className="card-title text-base">Pipeline</h2>
            <ul className="space-y-2">
              {(Object.keys(counts) as IssueStatus[]).map((status) => (
                <li key={status} className="flex items-center gap-3">
                  <span className="w-44 text-sm">
                    <IssueStatusBadge status={status} />
                  </span>
                  <progress
                    className="progress progress-primary flex-1"
                    value={counts[status]}
                    max={Math.max(1, project.issues.length)}
                  />
                  <span className="w-8 text-right text-sm">{counts[status]}</span>
                  <span className="sr-only">{ISSUE_STATUS_LABELS[status]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body">
            <h2 className="card-title text-base">Recent evidence</h2>
            <ul className="space-y-3">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-primary" />
                    <span className="mt-1 w-px flex-1 bg-base-300" />
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <EventKindBadge kind={event.kind} />
                      {event.issue && (
                        <Link
                          href={`/projects/${project.key}/issues/${event.issue.handle}`}
                          className="link link-hover stack-mono text-xs text-primary"
                        >
                          {event.issue.handle}
                        </Link>
                      )}
                      <time className="text-xs text-base-content/40">
                        {event.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </time>
                    </div>
                    <p className="truncate text-sm">{event.summary}</p>
                    <p className="text-xs text-base-content/50">{event.actor}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link
              href={`/projects/${project.key}/evidence`}
              className="link link-hover text-xs text-primary"
            >
              Full ledger
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
