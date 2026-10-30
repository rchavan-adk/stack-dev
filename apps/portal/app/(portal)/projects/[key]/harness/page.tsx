import Link from "next/link";
import { notFound } from "next/navigation";
import { HARNESS_COMPONENTS } from "@stack/core";
import { prisma } from "@stack/db";
import { Download, ShieldCheck } from "lucide-react";
import { publishedPack } from "@/lib/queries";

export default async function ProjectHarnessPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const project = await prisma.project.findUnique({ where: { key: key.toUpperCase() } });
  if (!project) notFound();

  const current = await publishedPack(project.id);
  const installs = await prisma.event.findMany({
    where: { projectId: project.id, kind: "HARNESS_INSTALLED" },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  if (!current) {
    return (
      <div className="alert alert-warning">
        <span>
          No harness pack is published for {project.key}. A project lead builds and publishes one
          under <Link href="/admin/harness" className="link">Harness packs</Link>, then developers run{" "}
          <span className="stack-mono">stack harness install</span>.
        </span>
      </div>
    );
  }

  const byKind = HARNESS_COMPONENTS.map((component) => ({
    ...component,
    files: current.version.components.filter((file) => file.kind === component.kind),
  }));

  return (
    <div className="space-y-6">
      <section className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="card-title text-lg">
                <span className="stack-mono">{current.pack.name}</span>
                <span className="badge badge-primary">{current.version.version}</span>
              </h2>
              <p className="mt-1 text-sm text-base-content/70">{current.pack.description}</p>
              <p className="mt-2 text-xs text-base-content/50">
                published{" "}
                {current.version.publishedAt?.toISOString().slice(0, 10) ?? "—"}
                {current.version.publishedBy ? ` by ${current.version.publishedBy.name}` : ""} ·
                checksum <span className="stack-mono">{current.version.checksum?.slice(0, 16)}</span>{" "}
                · {current.version.components.length} files
              </p>
            </div>
            <Link href="/get-started" className="btn btn-primary btn-sm">
              <Download size={16} /> Setup guide
            </Link>
          </div>

          {current.version.notes && (
            <div className="alert alert-soft text-sm">
              <span>{current.version.notes}</span>
            </div>
          )}

          <div className="mockup-code text-xs">
            <pre data-prefix="$">
              <code>stack login</code>
            </pre>
            <pre data-prefix="$">
              <code>stack project detect</code>
            </pre>
            <pre data-prefix="$">
              <code>stack harness install</code>
            </pre>
            <pre data-prefix="$">
              <code>stack doctor</code>
            </pre>
          </div>
          <p className="text-xs text-base-content/60">
            The pack is pulled, never handed around. The CLI verifies the checksum above before it
            installs the hooks, so every machine on this engagement runs identical rules.
          </p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {byKind.map((component) => (
          <article
            key={component.kind}
            className="card border border-base-300 bg-base-100 shadow-sm"
          >
            <div className="card-body gap-2 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{component.label}</h3>
                <span
                  className={`badge badge-sm ${component.blocking ? "badge-error badge-outline" : "badge-ghost"}`}
                >
                  {component.blocking ? "blocker" : "guider"}
                </span>
              </div>
              <p className="text-xs text-base-content/50">{component.role}</p>
              <ul className="mt-1 space-y-1">
                {component.files.map((file) => (
                  <li key={file.id} className="stack-mono text-xs text-base-content/70">
                    {file.path}
                    {file.mode === "755" && (
                      <span className="badge badge-xs badge-warning ml-2">exec</span>
                    )}
                  </li>
                ))}
                {component.files.length === 0 && (
                  <li className="text-xs text-base-content/40">not used in this pack</li>
                )}
              </ul>
            </div>
          </article>
        ))}
      </section>

      <section className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-primary" />
            <h2 className="card-title text-base">Installs reported by the CLI</h2>
          </div>
          {installs.length === 0 ? (
            <p className="text-sm text-base-content/60">
              No installs recorded yet. Developers appear here after{" "}
              <span className="stack-mono">stack harness install</span>.
            </p>
          ) : (
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                </tr>
              </thead>
              <tbody>
                {installs.map((event) => (
                  <tr key={event.id}>
                    <td className="text-xs text-base-content/60">
                      {event.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="text-sm">{event.actor}</td>
                    <td className="text-sm">{event.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
