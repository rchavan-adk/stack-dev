import Link from "next/link";
import { prisma } from "@stack/db";
import { GitBranch, Plus } from "lucide-react";
import { WaveStatusBadge } from "@/components/status";
import { canAdminister, requireSessionUser } from "@/lib/session";

export default async function ProjectsPage() {
  const user = await requireSessionUser();

  const projects = await prisma.project.findMany({
    where:
      user.role === "ADMIN" ? undefined : { memberships: { some: { userId: user.id } } },
    orderBy: { key: "asc" },
    include: {
      waves: { orderBy: { number: "asc" } },
      issues: { select: { status: true } },
      repos: true,
      packs: { include: { versions: { where: { status: "PUBLISHED" }, take: 1, orderBy: { publishedAt: "desc" } } } },
      memberships: { include: { user: { select: { name: true } } } },
    },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-base-content/60">
            One record per engagement: specs, waves, backlog, evidence and the harness the team runs.
          </p>
        </div>
        {canAdminister(user.role) && (
          <Link href="/projects/new" className="btn btn-primary btn-sm">
            <Plus size={16} /> Register project
          </Link>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {projects.map((project) => {
          const open = project.issues.filter((issue) => issue.status !== "DONE").length;
          const done = project.issues.length - open;
          const activeWave = project.waves.find((wave) => wave.status === "ACTIVE");
          const pack = project.packs[0]?.versions[0];
          const progress = project.issues.length
            ? Math.round((done / project.issues.length) * 100)
            : 0;

          return (
            <article key={project.id} className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="badge badge-secondary stack-mono">{project.key}</span>
                      <h2 className="card-title text-lg">
                        <Link href={`/projects/${project.key}`} className="link-hover">
                          {project.name}
                        </Link>
                      </h2>
                    </div>
                    <p className="mt-1 text-sm text-base-content/60">{project.client}</p>
                  </div>
                  <span className="badge badge-ghost badge-sm">{project.status.toLowerCase()}</span>
                </div>

                <p className="text-sm text-base-content/70">{project.summary}</p>

                <div>
                  <div className="mb-1 flex justify-between text-xs text-base-content/60">
                    <span>
                      {done} of {project.issues.length} items done
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <progress className="progress progress-primary w-full" value={progress} max={100} />
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-box bg-base-200 px-3 py-2">
                    <div className="text-base-content/50">Active wave</div>
                    {activeWave ? (
                      <div className="mt-1 flex items-center gap-2">
                        <WaveStatusBadge status={activeWave.status} />
                        <span className="truncate">
                          {activeWave.number}. {activeWave.name}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-1 text-base-content/60">none</div>
                    )}
                  </div>
                  <div className="rounded-box bg-base-200 px-3 py-2">
                    <div className="text-base-content/50">Harness pack</div>
                    <div className="mt-1 stack-mono">
                      {pack ? `${project.packs[0].name} ${pack.version}` : "not published"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
                  <GitBranch size={14} />
                  {project.repos.length > 0 ? (
                    project.repos.map((repo) => (
                      <span key={repo.id} className="stack-mono">
                        {repo.name}
                      </span>
                    ))
                  ) : (
                    <span>no repository linked</span>
                  )}
                </div>

                <div className="card-actions justify-between">
                  <div className="avatar-group -space-x-3">
                    {project.memberships.slice(0, 5).map((membership) => (
                      <div key={membership.id} className="avatar avatar-placeholder">
                        <div className="h-7 w-7 bg-neutral text-neutral-content">
                          <span className="text-[10px]">
                            {membership.user.name
                              .split(" ")
                              .map((part) => part[0])
                              .slice(0, 2)
                              .join("")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Link href={`/projects/${project.key}`} className="btn btn-outline btn-sm">
                    Open
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
