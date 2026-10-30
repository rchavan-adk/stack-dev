import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Rocket, Save, SplitSquareVertical } from "lucide-react";
import { prisma } from "@stack/db";
import { HARNESS_COMPONENTS } from "@stack/core";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { AdminDenied } from "@/components/admin-gate";
import { formatDateTime } from "@/lib/format";
import { cloneVersion, publishVersion, saveComponent } from "../actions";

function VersionStatusBadge({ status }: { status: string }) {
  const cls =
    status === "PUBLISHED" ? "badge-success" : status === "DRAFT" ? "badge-ghost" : "badge-warning";
  return <span className={`badge badge-sm ${cls} whitespace-nowrap`}>{status.toLowerCase()}</span>;
}

export default async function HarnessVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{
    file?: string;
    saved?: string;
    created?: string;
    error?: string;
  }>;
}) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) return <AdminDenied user={user} />;

  const { versionId } = await params;
  const query = await searchParams;

  const version = await prisma.harnessVersion.findUnique({
    where: { id: versionId },
    include: {
      pack: { include: { project: { select: { key: true, name: true } } } },
      components: { orderBy: { path: "asc" } },
      publishedBy: { select: { name: true } },
    },
  });
  if (!version) notFound();

  const isDraft = version.status === "DRAFT";
  const requestedFile = typeof query.file === "string" ? query.file : undefined;
  const selected =
    version.components.find((component) => component.path === requestedFile) ??
    version.components[0];

  const groups = HARNESS_COMPONENTS.map((entry) => ({
    ...entry,
    files: version.components.filter((component) => component.kind === entry.kind),
  })).filter((group) => group.files.length > 0);

  const knownKinds = new Set<string>(HARNESS_COMPONENTS.map((entry) => entry.kind));
  const otherFiles = version.components.filter(
    (component) => !knownKinds.has(component.kind),
  );

  const tabFiles = selected
    ? version.components.filter((component) => component.kind === selected.kind)
    : [];
  const fileHref = (path: string) =>
    `/admin/harness/${version.id}?file=${encodeURIComponent(path)}`;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/admin/harness"
          className="inline-flex items-center gap-1 text-sm text-base-content/60 hover:text-primary"
        >
          <ArrowLeft size={14} /> All harness packs
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            <span className="stack-mono">{version.pack.name}</span>{" "}
            <span className="stack-mono text-primary">{version.version}</span>
          </h1>
          <VersionStatusBadge status={version.status} />
          <span className="badge badge-ghost badge-sm whitespace-nowrap">
            {version.pack.project?.key ?? "ORG"}
          </span>
          {version.checksum && (
            <span className="badge badge-ghost badge-sm stack-mono whitespace-nowrap">
              {version.checksum.slice(0, 12)}…
            </span>
          )}
        </div>
        <p className="max-w-3xl text-sm text-base-content/60">
          {version.pack.project?.name ?? "Org-level default pack"} ·{" "}
          {version.publishedAt
            ? `published ${formatDateTime(version.publishedAt)} by ${version.publishedBy?.name ?? "—"} · immutable`
            : isDraft
              ? "draft · every component below is editable until you publish"
              : version.status.toLowerCase()}
          {version.notes ? ` · ${version.notes}` : ""}
        </p>
      </header>

      {query.created && (
        <div className="alert alert-success text-sm">
          <span>
            Draft <span className="stack-mono">{query.created}</span> created — it copies every
            component from its source. Edit below, publish when it is ready.
          </span>
        </div>
      )}
      {query.saved && (
        <div className="alert alert-success text-sm">
          <span>Saved. The draft checksum is computed at publish time.</span>
        </div>
      )}
      {query.error && (
        <div className="alert alert-error text-sm">
          <span>{query.error}</span>
        </div>
      )}

      {!isDraft && (
        <div className="alert alert-warning items-start text-left">
          <div>
            <h2 className="font-semibold">
              {version.status === "PUBLISHED" ? "Published versions are immutable" : "Deprecated versions are immutable"}
            </h2>
            <p className="text-sm">
              Installed machines verify against this version&apos;s checksum, so its files can
              never change. Clone it to a new draft to keep working.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {isDraft ? (
          <form action={publishVersion.bind(null, version.id)}>
            <button type="submit" className="btn btn-primary btn-sm gap-1">
              <Rocket size={15} /> Publish {version.version}
            </button>
          </form>
        ) : (
          <form action={cloneVersion.bind(null, version.id)}>
            <button type="submit" className="btn btn-secondary btn-sm gap-1">
              <SplitSquareVertical size={15} /> Clone to new draft
            </button>
          </form>
        )}
        <span className="text-xs text-base-content/50">
          {isDraft
            ? "publishing stamps the checksum, freezes the version and records a project event"
            : "cloning copies every component into a fresh editable draft"}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.kind} className="card border border-base-300 bg-base-100">
              <div className="card-body gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{group.label}</h3>
                  <div className="flex items-center gap-1">
                    {group.blocking && (
                      <span className="badge badge-error badge-outline badge-xs">blocker</span>
                    )}
                    <span className="badge badge-ghost badge-xs">{group.role}</span>
                  </div>
                </div>
                <ul className="menu w-full gap-0.5 p-0">
                  {group.files.map((file) => (
                    <li key={file.id}>
                      <Link
                        href={fileHref(file.path)}
                        className={selected && file.path === selected.path ? "menu-active" : ""}
                      >
                        <span className="stack-mono min-w-0 flex-1 truncate text-xs">
                          {file.path}
                        </span>
                        <span
                          className={`badge badge-xs ${file.mode === "755" ? "badge-warning" : "badge-ghost"}`}
                        >
                          {file.mode}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
          {otherFiles.length > 0 && (
            <div className="card border border-base-300 bg-base-100">
              <div className="card-body gap-2 p-4">
                <h3 className="text-sm font-semibold">Other components</h3>
                <ul className="menu w-full gap-0.5 p-0">
                  {otherFiles.map((file) => (
                    <li key={file.id}>
                      <Link
                        href={fileHref(file.path)}
                        className={selected && file.path === selected.path ? "menu-active" : ""}
                      >
                        <span className="stack-mono min-w-0 flex-1 truncate text-xs">
                          {file.path}
                        </span>
                        <span className="badge badge-ghost badge-xs">{file.kind}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {version.components.length === 0 && (
            <div className="alert alert-warning text-sm">
              <span>This version has no components.</span>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {selected ? (
            <>
              <div role="tablist" className="tabs tabs-box w-fit max-w-full overflow-x-auto">
                {tabFiles.map((file) => (
                  <Link
                    key={file.id}
                    role="tab"
                    href={fileHref(file.path)}
                    title={file.path}
                    className={`tab whitespace-nowrap ${file.path === selected.path ? "tab-active" : ""}`}
                  >
                    {file.path.split("/").pop()}
                  </Link>
                ))}
              </div>

              <div className="card border border-base-300 bg-base-100">
                <div className="card-body gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="stack-mono text-sm font-medium">{selected.path}</span>
                    <span
                      className={`badge badge-xs ${selected.mode === "755" ? "badge-warning" : "badge-ghost"}`}
                    >
                      mode {selected.mode}
                    </span>
                    <span className="badge badge-ghost badge-xs">{selected.kind}</span>
                  </div>

                  {isDraft ? (
                    <form action={saveComponent.bind(null, version.id)} className="space-y-3">
                      <input type="hidden" name="path" value={selected.path} />
                      <textarea
                        name="content"
                        rows={20}
                        defaultValue={selected.content}
                        spellCheck={false}
                        className="textarea w-full stack-mono text-xs leading-relaxed"
                      />
                      <div className="flex items-center gap-2">
                        <button type="submit" className="btn btn-primary btn-sm gap-1">
                          <Save size={15} /> Save {selected.path.split("/").pop()}
                        </button>
                        <span className="text-xs text-base-content/50">
                          only this file is written; the version stays a draft
                        </span>
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-3">
                      <textarea
                        rows={20}
                        readOnly
                        value={selected.content}
                        spellCheck={false}
                        className="textarea w-full stack-mono text-xs leading-relaxed"
                      />
                      <p className="text-xs text-base-content/50">
                        Read-only: this version is {version.status.toLowerCase()} and machines
                        verify against its checksum.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="alert alert-info text-sm">
              <span>Select a component on the left to view or edit it.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
