import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@stack/db";
import { IssueStatusBadge, IssueTypeBadge, WaveStatusBadge } from "@/components/status";

export default async function ProjectWavesPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  const project = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
    include: {
      waves: {
        orderBy: { number: "asc" },
        include: {
          issues: {
            orderBy: { handle: "asc" },
            include: { assignee: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!project) notFound();

  return (
    <div className="space-y-5">
      <div className="alert alert-soft text-sm">
        <span>
          Waves are planned in the planner harness and submitted through the planner MCP. The portal
          records them and checks them against the Miracle wave template, so slicing stays flexible.
        </span>
      </div>

      {project.waves.map((wave) => {
        const done = wave.issues.filter((issue) => issue.status === "DONE").length;
        const progress = wave.issues.length ? Math.round((done / wave.issues.length) * 100) : 0;

        return (
          <section key={wave.id} className="card border border-base-300 bg-base-100 shadow-sm">
            <div className="card-body gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="badge badge-outline stack-mono">Wave {wave.number}</span>
                    <h2 className="card-title text-lg">{wave.name}</h2>
                    <WaveStatusBadge status={wave.status} />
                  </div>
                  <p className="mt-2 max-w-3xl text-sm text-base-content/70">{wave.goal}</p>
                </div>
                <div className="text-right text-xs text-base-content/60">
                  <div>
                    {wave.startsOn?.toISOString().slice(0, 10) ?? "unscheduled"} to{" "}
                    {wave.endsOn?.toISOString().slice(0, 10) ?? "—"}
                  </div>
                  <div className="mt-1">
                    {done} of {wave.issues.length} done
                  </div>
                </div>
              </div>

              <progress className="progress progress-primary w-full" value={progress} max={100} />

              {wave.issues.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Title</th>
                        <th>Owner</th>
                        <th>Points</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wave.issues.map((issue) => (
                        <tr key={issue.id} className="hover">
                          <td className="stack-mono text-xs">
                            <Link
                              href={`/projects/${project.key}/issues/${issue.handle}`}
                              className="link link-hover text-primary"
                            >
                              {issue.handle}
                            </Link>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <IssueTypeBadge type={issue.type} />
                              <span>{issue.title}</span>
                            </div>
                          </td>
                          <td className="text-sm text-base-content/70">
                            {issue.assignee?.name ?? "—"}
                          </td>
                          <td className="text-sm">{issue.estimate ?? "—"}</td>
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
        );
      })}
    </div>
  );
}
