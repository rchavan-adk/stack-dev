import Link from "next/link";
import { Download, FileEdit, PackagePlus, Rocket, SplitSquareVertical } from "lucide-react";
import { prisma } from "@stack/db";
import { signPayload } from "@stack/core";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { AdminDenied } from "@/components/admin-gate";
import { formatDate } from "@/lib/format";
import { nextDraftVersion } from "@/lib/version";
import { cloneVersion, createDraft, publishVersion } from "./actions";

function VersionStatusBadge({ status }: { status: string }) {
  const cls =
    status === "PUBLISHED" ? "badge-success" : status === "DRAFT" ? "badge-ghost" : "badge-warning";
  return <span className={`badge badge-sm ${cls} whitespace-nowrap`}>{status.toLowerCase()}</span>;
}

export default async function HarnessAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ published?: string; error?: string }>;
}) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) return <AdminDenied user={user} />;

  const query = await searchParams;

  const projects = await prisma.project.findMany({
    orderBy: { key: "asc" },
    include: {
      packs: {
        include: {
          versions: {
            orderBy: { createdAt: "desc" },
            include: {
              _count: { select: { components: true } },
              publishedBy: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // Signed at render time; the download route verifies it, links expire after 10 minutes.
  const signingSecret = process.env.STACK_SIGNING_SECRET ?? "miracle-dev-signing-secret";
  const downloadHref = (projectKey: string, versionId: string) =>
    `/api/harness/download?t=${encodeURIComponent(
      signPayload({ projectKey, versionId }, signingSecret, 600),
    )}`;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Harness packs</h1>
        <p className="max-w-3xl text-sm text-base-content/60">
          The guiders and blockers every developer machine runs. Drafts are editable, publishing
          stamps a checksum and freezes the version, and every install is verified against it.
          Download links are signed and expire in ten minutes.
        </p>
      </header>

      {query.published && (
        <div className="alert alert-success text-sm">
          <span>
            Published <span className="stack-mono">{query.published}</span>. The checksum is
            stamped on the version and every <code className="stack-mono">stack harness install</code>{" "}
            now verifies against it.
          </span>
        </div>
      )}
      {query.error && (
        <div className="alert alert-error text-sm">
          <span>{query.error}</span>
        </div>
      )}

      <div className="space-y-8">
        {projects.map((project) => (
          <section key={project.id} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold">
                <span className="stack-mono text-primary">{project.key}</span>
              </h2>
              <span className="text-sm text-base-content/60">{project.name}</span>
            </div>

            {project.packs.length === 0 && (
              <div className="alert alert-info text-sm">
                <span>
                  No harness pack for {project.key} yet. Packs are seeded with the project; this
                  page manages versions of existing packs.
                </span>
              </div>
            )}

            {project.packs.map((pack) => {
              const takenVersions = pack.versions.map((version) => version.version);
              const suggested = pack.versions[0]
                ? nextDraftVersion(pack.versions[0].version, takenVersions)
                : "0.1.0";

              return (
                <div key={pack.id} className="card border border-base-300 bg-base-100">
                  <div className="card-body gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="card-title text-base">
                          <span className="stack-mono">{pack.name}</span>
                        </h3>
                        <p className="max-w-2xl text-sm text-base-content/60">{pack.description}</p>
                      </div>

                      {pack.versions.length > 0 && (
                        <form action={createDraft.bind(null, pack.id)} className="join">
                          <select
                            name="sourceVersionId"
                            className="select select-sm join-item"
                            defaultValue={pack.versions[0].id}
                            aria-label="Source version"
                          >
                            {pack.versions.map((version) => (
                              <option key={version.id} value={version.id}>
                                from {version.version} ({version.status.toLowerCase()})
                              </option>
                            ))}
                          </select>
                          <input
                            name="version"
                            className="input input-sm join-item w-24 stack-mono"
                            defaultValue={suggested}
                            aria-label="New draft version"
                          />
                          <button type="submit" className="btn btn-secondary btn-sm join-item gap-1">
                            <PackagePlus size={14} /> New draft
                          </button>
                        </form>
                      )}
                    </div>

                    {pack.versions.length === 0 && (
                      <div className="alert alert-warning text-sm">
                        <span>This pack has no versions yet.</span>
                      </div>
                    )}

                    {pack.versions.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="table table-sm">
                          <thead>
                            <tr>
                              <th>Version</th>
                              <th>Status</th>
                              <th>Components</th>
                              <th>Checksum</th>
                              <th>Published</th>
                              <th className="text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pack.versions.map((version) => {
                              const isDraft = version.status === "DRAFT";
                              return (
                                <tr key={version.id}>
                                  <td className="stack-mono font-medium">{version.version}</td>
                                  <td>
                                    <VersionStatusBadge status={version.status} />
                                  </td>
                                  <td>{version._count.components}</td>
                                  <td className="stack-mono text-xs">
                                    {version.checksum
                                      ? `${version.checksum.slice(0, 12)}…`
                                      : "—"}
                                  </td>
                                  <td className="whitespace-nowrap text-xs text-base-content/70">
                                    {version.publishedAt
                                      ? `${version.publishedBy?.name ?? "—"} · ${formatDate(version.publishedAt)}`
                                      : "—"}
                                  </td>
                                  <td>
                                    <div className="flex items-center justify-end gap-1">
                                      <Link
                                        href={`/admin/harness/${version.id}`}
                                        className="btn btn-ghost btn-xs gap-1"
                                      >
                                        <FileEdit size={13} />
                                        {isDraft ? "Edit" : "View"}
                                      </Link>
                                      {isDraft && (
                                        <form action={publishVersion.bind(null, version.id)}>
                                          <button
                                            type="submit"
                                            className="btn btn-primary btn-xs gap-1"
                                          >
                                            <Rocket size={13} /> Publish
                                          </button>
                                        </form>
                                      )}
                                      <form action={cloneVersion.bind(null, version.id)}>
                                        <button
                                          type="submit"
                                          className="btn btn-ghost btn-xs gap-1"
                                          title={`Clones every component into a new draft (${nextDraftVersion(
                                            version.version,
                                            takenVersions,
                                          )})`}
                                        >
                                          <SplitSquareVertical size={13} /> Clone to new draft
                                        </button>
                                      </form>
                                      <a
                                        href={downloadHref(project.key, version.id)}
                                        className="btn btn-ghost btn-xs gap-1"
                                        title="Signed link, expires in 10 minutes"
                                      >
                                        <Download size={13} /> Tarball
                                      </a>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <p className="text-xs text-base-content/50">
                      Draft rows show the working copy. Publishing computes{" "}
                      <code className="stack-mono">
                        sha256(sorted &quot;path:sha256(content)&quot;)
                      </code>{" "}
                      over every component, stamps it on the version and writes a project event.
                    </p>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
