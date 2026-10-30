import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@stack/db";
import { EventKindBadge } from "@/components/status";
import { projectSpend } from "@/lib/queries";
import { formatUsd } from "@/lib/format";

export default async function ProjectEvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { key } = await params;
  const { kind } = await searchParams;

  const project = await prisma.project.findUnique({ where: { key: key.toUpperCase() } });
  if (!project) notFound();

  const [events, kinds, spend, calls] = await Promise.all([
    prisma.event.findMany({
      where: { projectId: project.id, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { issue: { select: { handle: true } } },
    }),
    prisma.event.groupBy({
      by: ["kind"],
      where: { projectId: project.id },
      _count: { _all: true },
    }),
    projectSpend(project.id),
    prisma.modelCall.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { issue: { select: { handle: true } }, user: { select: { name: true } } },
    }),
  ]);

  const base = `/projects/${project.key}/evidence`;

  return (
    <div className="space-y-5">
      <div className="stats w-full border border-base-300 bg-base-100 shadow-sm">
        <div className="stat">
          <div className="stat-title">Events recorded</div>
          <div className="stat-value text-primary">
            {kinds.reduce((sum, row) => sum + row._count._all, 0)}
          </div>
          <div className="stat-desc">the portal keeps metadata, never code</div>
        </div>
        <div className="stat">
          <div className="stat-title">Gateway spend</div>
          <div className="stat-value">${formatUsd(spend.usedUsd)}</div>
          <div className="stat-desc">
            {spend.calls} allowed · {spend.denied} denied
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Tokens</div>
          <div className="stat-value text-accent">
            {((spend.tokensIn + spend.tokensOut) / 1000).toFixed(0)}k
          </div>
          <div className="stat-desc">
            {(spend.tokensIn / 1000).toFixed(0)}k in · {(spend.tokensOut / 1000).toFixed(0)}k out
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={base} className={`btn btn-xs ${kind ? "btn-ghost" : "btn-primary"}`}>
          all
        </Link>
        {kinds.map((row) => (
          <Link
            key={row.kind}
            href={`${base}?kind=${row.kind}`}
            className={`btn btn-xs ${kind === row.kind ? "btn-primary" : "btn-ghost"}`}
          >
            {row.kind.toLowerCase().replace(/_/g, " ")} ({row._count._all})
          </Link>
        ))}
      </div>

      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="overflow-x-auto">
          <table className="table-pin-rows table table-sm">
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Item</th>
                <th>Summary</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="hover">
                  <td className="whitespace-nowrap text-xs text-base-content/60">
                    {event.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td>
                    <EventKindBadge kind={event.kind} />
                  </td>
                  <td className="stack-mono text-xs">
                    {event.issue ? (
                      <Link
                        href={`/projects/${project.key}/issues/${event.issue.handle}`}
                        className="link link-hover text-primary"
                      >
                        {event.issue.handle}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="max-w-lg truncate text-sm">{event.summary}</td>
                  <td className="text-xs text-base-content/60">{event.actor}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-base-content/60">
                    No events of this kind yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body">
          <h2 className="card-title text-base">Gateway log</h2>
          <p className="text-xs text-base-content/60">
            Every call carries an item handle, which is what makes cost per item possible.
          </p>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Model</th>
                  <th>Item</th>
                  <th>Who</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.id}>
                    <td className="whitespace-nowrap text-xs text-base-content/60">
                      {call.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="stack-mono text-xs">{call.model}</td>
                    <td className="stack-mono text-xs">{call.issue?.handle ?? "—"}</td>
                    <td className="text-xs">{call.user?.name ?? "—"}</td>
                    <td className="text-xs">
                      {call.tokensIn}/{call.tokensOut}
                    </td>
                    <td className="text-xs">${formatUsd(call.costUsd)}</td>
                    <td>
                      {call.allowed ? (
                        <span className="badge badge-xs badge-success">allowed</span>
                      ) : (
                        <span className="badge badge-xs badge-error" title={call.reason ?? ""}>
                          denied
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
