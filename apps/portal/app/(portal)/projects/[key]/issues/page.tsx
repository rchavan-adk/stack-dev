import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@stack/db";
import { ISSUE_STATUSES, ISSUE_STATUS_LABELS, type IssueStatus } from "@stack/core";
import { IssueStatusBadge, IssueTypeBadge } from "@/components/status";
import { parseAcceptance } from "@/lib/queries";

export default async function ProjectIssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { key } = await params;
  const { status, q } = await searchParams;

  const project = await prisma.project.findUnique({ where: { key: key.toUpperCase() } });
  if (!project) notFound();

  const issues = await prisma.issue.findMany({
    where: {
      projectId: project.id,
      ...(status && ISSUE_STATUSES.includes(status as IssueStatus) ? { status } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { handle: { contains: q.toUpperCase() } }] } : {}),
    },
    orderBy: [{ handle: "asc" }],
    include: {
      wave: { select: { number: true, name: true } },
      assignee: { select: { name: true } },
      spec: { select: { status: true } },
    },
  });

  const base = `/projects/${project.key}/issues`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="tabs tabs-box tabs-sm">
          <Link role="tab" href={base} className={`tab ${!status ? "tab-active" : ""}`}>
            All
          </Link>
          {ISSUE_STATUSES.map((value) => (
            <Link
              key={value}
              role="tab"
              href={`${base}?status=${value}`}
              className={`tab ${status === value ? "tab-active" : ""}`}
            >
              {ISSUE_STATUS_LABELS[value]}
            </Link>
          ))}
        </div>

        <form action={base} className="join">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search handle or title"
            className="input input-bordered input-sm join-item w-56"
          />
          <button type="submit" className="btn btn-sm join-item btn-primary">
            Search
          </button>
        </form>
      </div>

      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Item</th>
                <th>Title</th>
                <th>Wave</th>
                <th>Owner</th>
                <th>Acceptance</th>
                <th>Spec</th>
                <th>PR</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id} className="hover">
                  <td className="stack-mono text-xs">
                    <Link
                      href={`${base}/${issue.handle}`}
                      className="link link-hover text-primary"
                    >
                      {issue.handle}
                    </Link>
                  </td>
                  <td className="max-w-md">
                    <div className="flex items-center gap-2">
                      <IssueTypeBadge type={issue.type} />
                      <span className="truncate">{issue.title}</span>
                    </div>
                  </td>
                  <td className="text-xs text-base-content/60">
                    {issue.wave ? `W${issue.wave.number}` : "—"}
                  </td>
                  <td className="text-sm">{issue.assignee?.name ?? "—"}</td>
                  <td className="text-xs text-base-content/60">
                    {parseAcceptance(issue.acceptance).length} criteria
                  </td>
                  <td>
                    {issue.spec ? (
                      <span className="badge badge-xs badge-success badge-outline">
                        {issue.spec.status.toLowerCase()}
                      </span>
                    ) : (
                      <span className="text-xs text-base-content/40">none</span>
                    )}
                  </td>
                  <td className="stack-mono text-xs">
                    {issue.prNumber ? `#${issue.prNumber}` : "—"}
                  </td>
                  <td>
                    <IssueStatusBadge status={issue.status} />
                  </td>
                </tr>
              ))}
              {issues.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-base-content/60">
                    No items match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
