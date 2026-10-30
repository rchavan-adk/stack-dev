import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@stack/db";
import { AlertTriangle, CheckCircle2, Github, KeyRound, Plug, Radio, Save, Wand2 } from "lucide-react";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { AdminDenied } from "@/components/admin-gate";
import { CopyButton } from "@/components/copy-button";
import {
  buildAppManifest,
  githubAppNewUrl,
  githubManifestUrl,
  githubWebhookUrl,
} from "@/lib/github";
import { generateWebhookSecretAction, saveGithubAppId } from "./actions";

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="badge badge-primary badge-sm mt-0.5 shrink-0 stack-mono">{number}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {children}
      </div>
    </li>
  );
}

export default async function GithubSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) return <AdminDenied user={user} />;

  const { key } = await params;
  const query = await searchParams;

  const project = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
    include: { repos: { orderBy: { name: "asc" } } },
  });
  if (!project) notFound();

  const repo = project.repos.find((candidate) => candidate.provider === "github") ?? null;
  const baseUrl = project.webhookBaseUrl;
  const webhookUrl = baseUrl ? githubWebhookUrl(baseUrl) : null;
  const manifestUrl = baseUrl ? githubManifestUrl(baseUrl, project.key) : null;
  const manifest =
    baseUrl && repo?.webhookSecret
      ? buildAppManifest({
          projectKey: project.key,
          webhookBaseUrl: baseUrl,
          webhookSecret: repo.webhookSecret,
        })
      : null;
  const manifestJson = manifest ? JSON.stringify(manifest, null, 2) : "";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Github size={22} /> GitHub App setup
          </h1>
          <p className="max-w-3xl text-sm text-base-content/60">
            Register a GitHub App for <span className="stack-mono">{project.key}</span>, install it on
            the repository, and let pushes and pull requests move work on this portal.
          </p>
        </div>
        <Link href={`/projects/${project.key}`} className="btn btn-ghost btn-sm">
          Back to project
        </Link>
      </header>

      {query.saved === "app" && (
        <div className="alert alert-success text-sm">
          <span>App ID saved. The portal now labels deliveries from this app.</span>
        </div>
      )}
      {query.saved === "secret" && (
        <div className="alert alert-success text-sm">
          <span>Webhook secret generated. Copy it into the app settings (or keep the manifest flow).</span>
        </div>
      )}
      {query.error && (
        <div className="alert alert-error text-sm">
          <span>{query.error}</span>
        </div>
      )}

      {!repo ? (
        <div className="alert alert-warning items-start text-left">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <div className="space-y-2">
            <p className="text-sm">
              No repository is linked to {project.key} yet, so there is nothing to register an app
              for. Register the engagement with a GitHub remote, or link the repository in project
              settings.
            </p>
            <Link href={`/admin/settings?project=${project.key}`} className="btn btn-primary btn-xs">
              Open project settings
            </Link>
          </div>
        </div>
      ) : repo.provider !== "github" ? (
        <div className="alert alert-info items-start text-left">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <div className="space-y-2">
            <p className="text-sm">
              <span className="stack-mono">{repo.name}</span> is a{" "}
              <span className="stack-mono">{repo.provider}</span> repository, not a GitHub one. This
              wizard applies to repositories with provider{" "}
              <span className="stack-mono">github</span>.
            </p>
            <Link href={`/admin/settings?project=${project.key}`} className="btn btn-primary btn-xs">
              Open project settings
            </Link>
          </div>
        </div>
      ) : (
        <>
          {repo.githubAppId && (
            <div className="alert alert-success items-start text-left">
              <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
              <span className="text-sm">
                Connected as GitHub App <span className="stack-mono">#{repo.githubAppId}</span> on{" "}
                <span className="stack-mono">{repo.name}</span>.
              </span>
            </div>
          )}

          {!baseUrl ? (
            <div className="alert alert-warning items-start text-left">
              <Radio className="mt-0.5 shrink-0" size={18} />
              <div className="space-y-2">
                <h2 className="font-semibold">Start your tunnel first</h2>
                <p className="text-sm">
                  GitHub cannot reach <span className="stack-mono">localhost:4200</span>. Expose the
                  portal with a tunnel, then set the public base URL on the project before creating
                  the app — the manifest, the webhook URL and the setup link are all built from it.
                </p>
                <div className="mockup-code text-xs">
                  <pre data-prefix="$">
                    <code>ngrok http 4200</code>
                  </pre>
                </div>
                <Link
                  href={`/admin/settings?project=${project.key}`}
                  className="btn btn-primary btn-xs"
                >
                  Set the webhook base URL
                </Link>
              </div>
            </div>
          ) : (
            <section className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body gap-4">
                <h2 className="card-title flex items-center gap-2 text-base">
                  <Github size={18} /> Create the GitHub App
                </h2>
                <p className="text-sm text-base-content/60">
                  This link opens GitHub with the manifest below prefilled. GitHub creates the app,
                  then sends you back to the portal to confirm.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={githubAppNewUrl(baseUrl, project.key)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary btn-sm gap-1"
                  >
                    <Github size={15} /> Create the GitHub App on GitHub
                  </a>
                  <span className="text-xs text-base-content/50">
                    Manifest served from{" "}
                    <span className="stack-mono">{manifestUrl}</span>
                  </span>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Or create it by hand</h3>
                  <p className="text-xs text-base-content/50">
                    Paste this manifest into{" "}
                    <span className="stack-mono">github.com/settings/apps/new</span>.
                  </p>
                  <div className="flex items-start gap-2">
                    <div className="mockup-code min-w-0 flex-1 overflow-x-auto text-xs">
                      <pre>
                        <code>{manifestJson}</code>
                      </pre>
                    </div>
                    <CopyButton text={manifestJson} className="btn-sm shrink-0" />
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="card border border-base-300 bg-base-100 shadow-sm">
            <div className="card-body gap-4">
              <h2 className="card-title flex items-center gap-2 text-base">
                <Plug size={18} /> Steps
              </h2>
              <ol className="space-y-5">
                <Step number={1} title="Create the app">
                  <p className="text-sm text-base-content/60">
                    Use the prefilled link above, or create the app by hand with these values.
                  </p>
                  <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
                    <dt className="text-base-content/60">Webhook URL</dt>
                    <dd className="stack-mono break-all text-xs">
                      {webhookUrl ?? "set the webhook base URL first"}
                    </dd>
                    <dt className="text-base-content/60">Content type</dt>
                    <dd className="stack-mono text-xs">json</dd>
                    <dt className="text-base-content/60">Secret</dt>
                    <dd className="stack-mono break-all text-xs">
                      {repo.webhookSecret ?? "no secret on this repository"}
                    </dd>
                    <dt className="text-base-content/60">Events</dt>
                    <dd className="stack-mono text-xs">push, pull_request</dd>
                    <dt className="text-base-content/60">Permissions</dt>
                    <dd className="stack-mono text-xs">
                      contents: read, pull_requests: read, metadata: read
                    </dd>
                  </dl>
                </Step>

                <Step number={2} title="Install the app on the repository">
                  <p className="text-sm text-base-content/60">
                    Install it on <span className="stack-mono">{repo.name}</span>. Read-only
                    contents and pull requests are enough; the portal never receives code.
                  </p>
                </Step>

                <Step number={3} title="Watch for the first ping">
                  <p className="text-sm text-base-content/60">
                    GitHub sends a <span className="stack-mono">ping</span> the moment the app is
                    installed. The portal answers <span className="stack-mono">200</span> and records
                    nothing else; the first real delivery appears in the project evidence ledger.
                  </p>
                </Step>
              </ol>
            </div>
          </section>

          <section className="card border border-base-300 bg-base-100 shadow-sm">
            <div className="card-body gap-4">
              <h2 className="card-title flex items-center gap-2 text-base">
                <KeyRound size={18} /> App ID
              </h2>
              <p className="text-sm text-base-content/60">
                GitHub shows the App ID on the app settings page. Paste it back so deliveries are
                attributed to this app.
              </p>
              <form
                action={saveGithubAppId.bind(null, repo.id, project.key)}
                className="flex flex-wrap items-end gap-3"
              >
                <fieldset className="fieldset min-w-56">
                  <legend className="fieldset-legend">GitHub App ID</legend>
                  <input
                    name="githubAppId"
                    defaultValue={repo.githubAppId ?? ""}
                    placeholder="1234567"
                    className="input input-sm w-full stack-mono"
                    inputMode="numeric"
                    required
                  />
                </fieldset>
                <button type="submit" className="btn btn-primary btn-sm gap-1">
                  <Save size={15} /> Save App ID
                </button>
                {repo.githubAppId && (
                  <span className="badge badge-success badge-sm">
                    Connected as GitHub App #{repo.githubAppId}
                  </span>
                )}
              </form>
            </div>
          </section>

          <section className="card border border-base-300 bg-base-100 shadow-sm">
            <div className="card-body gap-4">
              <h2 className="card-title flex items-center gap-2 text-base">
                <KeyRound size={18} /> Webhook secret
              </h2>
              <p className="text-sm text-base-content/60">
                Every delivery is signed with this secret and checked per repository. Keep it out of
                the repository itself.
              </p>
              {!repo.webhookSecret ? (
                <form
                  action={generateWebhookSecretAction.bind(null, repo.id, project.key)}
                  className="flex flex-wrap items-center gap-3"
                >
                  <button type="submit" className="btn btn-primary btn-sm gap-1">
                    <Wand2 size={15} /> Generate webhook secret
                  </button>
                  <span className="text-xs text-base-content/50">
                    Mints a fresh 32-byte secret, stores it on{" "}
                    <span className="stack-mono">{repo.name}</span>, and signs it into the app
                    manifest. One per repository — rotation happens in project settings.
                  </span>
                </form>
              ) : null}
              <div className="flex items-start gap-2">
                <div className="mockup-code min-w-0 flex-1 overflow-x-auto text-xs">
                  <pre>
                    <code>{repo.webhookSecret ?? "This repository has no webhook secret."}</code>
                  </pre>
                </div>
                {repo.webhookSecret && (
                  <CopyButton text={repo.webhookSecret} className="btn-sm shrink-0" />
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
