import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@stack/db";
import { ExternalLink, GitBranch, Github, ShieldCheck } from "lucide-react";
import { ProjectTabs } from "@/components/project-tabs";
import { requireSessionUser } from "@/lib/session";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ key: string }>;
}) {
  await requireSessionUser();
  const { key } = await params;

  const project = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
    include: { repos: true },
  });
  if (!project) notFound();

  const repo = project.repos[0];
  const repoHref = repo?.remotePath?.startsWith("http")
    ? repo.remotePath.replace(/\.git$/, "")
    : null;
  const githubRepo = project.repos.find((candidate) => candidate.provider === "github") ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Link href="/projects" className="link link-hover text-sm text-base-content/60">
                Projects
              </Link>
              <span className="text-base-content/30">/</span>
              <span className="badge badge-secondary stack-mono">{project.key}</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold">{project.name}</h1>
            <p className="text-sm text-base-content/60">
              {project.client} · {project.summary}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 text-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-primary" />
              <span className="stack-mono">{project.handlePattern}</span>
            </div>
            {repo && (
              <div className="flex items-center gap-2">
                <GitBranch size={14} className="text-base-content/50" />
                {repoHref ? (
                  <a
                    href={repoHref}
                    target="_blank"
                    rel="noreferrer"
                    className="link link-hover stack-mono inline-flex items-center gap-1"
                  >
                    {repo.name} <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="stack-mono">{repo.name}</span>
                )}
              </div>
            )}
            {githubRepo && (
              <Link
                href={`/projects/${project.key}/github-setup`}
                className="link link-hover inline-flex items-center gap-1"
              >
                <Github size={14} />
                {githubRepo.githubAppId
                  ? `GitHub App #${githubRepo.githubAppId}`
                  : "Finish GitHub App setup"}
              </Link>
            )}
          </div>
        </div>

        <ProjectTabs projectKey={project.key} showGithub={Boolean(githubRepo)} />
      </header>

      {children}
    </div>
  );
}
