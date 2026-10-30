import { AlertTriangle, GitBranch, Globe, Plug, Save, UserPlus, Users, X } from "lucide-react";
import { prisma } from "@stack/db";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { MEMBERSHIP_ROLE_LABELS, MEMBERSHIP_ROLES } from "@/lib/members";
import { AdminDenied } from "@/components/admin-gate";
import { CopyButton } from "@/components/copy-button";
import { RoleBadge } from "@/components/status";
import { linkRepo, saveDelivery, saveRepo } from "./actions";
import { addMemberAction, removeMemberAction } from "./members-actions";

function workflowYaml(projectKey: string, repoName: string): string {
  return `# Stack AI portal events · project ${projectKey} · repo ${repoName}
# Save as .github/workflows/stack-events.yml in the client repository.
name: stack-events
on:
  push:
  pull_request:
    types: [opened, closed, reopened, synchronize]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 50 }
      - name: Post event to Stack AI portal
        env:
          STACK_PORTAL_URL: \${{ secrets.STACK_PORTAL_URL }}
          STACK_WEBHOOK_SECRET: \${{ secrets.STACK_WEBHOOK_SECRET }}
        run: |
          payload=$(jq -n --arg repo "\${{ github.repository }}" --arg branch "\${{ github.ref_name }}" \\
            --arg action "\${{ github.event_name == 'pull_request' && (github.event.pull_request.merged && 'merge' || 'push') || 'push' }}" \\
            --argjson pr "\${{ github.event.pull_request.number || 'null' }}" \\
            --argjson commits "$(git log -1 --format='[{"sha":"%H","message":%s,"author":"%an"}]' --date=iso | jq -c . 2>/dev/null || echo '[]')" \\
            '{repo:$repo, branch:$branch, action:$action, prNumber:$pr, commits:$commits}')
          sig=$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "$STACK_WEBHOOK_SECRET" | awk '{print $2}')
          curl -sS -X POST "$STACK_PORTAL_URL/api/git/events" \\
            -H 'content-type: application/json' \\
            -H "x-stack-signature: sha256=$sig" \\
            -d "$payload"
`;
}

function EnvBadge({ configured, name }: { configured: boolean; name: string }) {
  return (
    <span className="flex items-center gap-2">
      <code className="stack-mono text-xs">{name}</code>
      {configured ? (
        <span className="badge badge-success badge-sm whitespace-nowrap">configured</span>
      ) : (
        <span className="badge badge-warning badge-sm whitespace-nowrap">not configured</span>
      )}
    </span>
  );
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; saved?: string; error?: string }>;
}) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) return <AdminDenied user={user} />;

  const query = await searchParams;
  const projects = await prisma.project.findMany({
    orderBy: { key: "asc" },
    include: { repos: { orderBy: { name: "asc" } } },
  });

  if (projects.length === 0) {
    return (
      <div className="alert alert-warning text-sm">
        <span>No projects exist yet — seed the database first.</span>
      </div>
    );
  }

  const requestedKey = typeof query.project === "string" ? query.project.toUpperCase() : "ACME";
  const project = projects.find((candidate) => candidate.key === requestedKey) ?? projects[0];

  const [memberships, directory] = await Promise.all([
    prisma.membership.findMany({
      where: { projectId: project.id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, role: true },
    }),
  ]);
  const memberIds = new Set(memberships.map((membership) => membership.userId));
  const candidates = directory.filter((person) => !memberIds.has(person.id));

  const githubTokenConfigured = Boolean(process.env.STACK_GITHUB_TOKEN);
  const webhookSecretConfigured = Boolean(process.env.STACK_WEBHOOK_SECRET);

  const envSnippet = [
    "# apps/portal/.env.local — the portal side. Values are never shown in the UI.",
    "STACK_GITHUB_TOKEN=<a GitHub token with repo access>",
    "STACK_WEBHOOK_SECRET=<random secret — the same value as the repository secret below>",
  ].join("\n");

  const workflow = workflowYaml(project.key, project.repos[0]?.name ?? "owner/repo");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Project settings</h1>
          <p className="max-w-3xl text-sm text-base-content/60">
            Delivery knobs, the linked repository and the GitHub wiring, per project.
          </p>
        </div>
        <form method="get" action="/admin/settings" className="join">
          <select
            name="project"
            defaultValue={project.key}
            className="select select-sm join-item"
            aria-label="Project"
          >
            {projects.map((candidate) => (
              <option key={candidate.id} value={candidate.key}>
                {candidate.key} — {candidate.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary btn-sm join-item">
            Switch project
          </button>
        </form>
      </header>

      {query.saved === "delivery" && (
        <div className="alert alert-success text-sm">
          <span>Delivery settings saved for {project.key}.</span>
        </div>
      )}
      {query.saved === "repo" && (
        <div className="alert alert-success text-sm">
          <span>Repository link saved.</span>
        </div>
      )}
      {query.saved === "member" && (
        <div className="alert alert-success text-sm">
          <span>Membership added to {project.key}.</span>
        </div>
      )}
      {query.saved === "member-removed" && (
        <div className="alert alert-success text-sm">
          <span>Membership removed from {project.key}.</span>
        </div>
      )}
      {query.error && (
        <div className="alert alert-error text-sm">
          <span>{query.error}</span>
        </div>
      )}

      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-4">
          <h2 className="card-title flex items-center gap-2 text-base">
            <Globe size={18} /> Delivery
          </h2>
          <p className="text-sm text-base-content/60">
            The handle pattern is enforced twice: by the commit hook on every developer machine and
            again server-side when events arrive. The gateway URL is where model calls must go;
            the budget caps what the portal lets through.
          </p>
          <form action={saveDelivery.bind(null, project.id)} className="grid gap-4 lg:grid-cols-2">
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Handle pattern (regex)</legend>
              <input
                name="handlePattern"
                defaultValue={project.handlePattern}
                className="input input-sm w-full stack-mono"
                required
              />
            </fieldset>
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Gateway URL</legend>
              <input
                name="gatewayUrl"
                defaultValue={project.gatewayUrl}
                className="input input-sm w-full stack-mono"
                required
              />
            </fieldset>
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Budget (USD)</legend>
              <input
                name="budgetUsd"
                type="number"
                min={0}
                step="0.01"
                defaultValue={project.budgetUsd}
                className="input input-sm w-full"
                required
              />
            </fieldset>
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Project status</legend>
              <select name="status" defaultValue={project.status} className="select select-sm w-full">
                <option value="ACTIVE">active</option>
                <option value="PAUSED">paused</option>
                <option value="CLOSED">closed</option>
              </select>
            </fieldset>
            <div className="lg:col-span-2">
              <button type="submit" className="btn btn-primary btn-sm gap-1">
                <Save size={15} /> Save delivery settings
              </button>
            </div>
          </form>
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <GitBranch size={18} /> Repository
        </h2>

        {project.repos.map((repo) => (
          <div key={repo.id} className="card border border-base-300 bg-base-100">
            <div className="card-body gap-4">
              <form action={saveRepo.bind(null, repo.id)} className="grid gap-4 lg:grid-cols-2">
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Provider</legend>
                  <select name="provider" defaultValue={repo.provider} className="select select-sm w-full">
                    <option value="mock-github">mock-github</option>
                    <option value="github">github</option>
                  </select>
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Repository name</legend>
                  <input
                    name="name"
                    defaultValue={repo.name}
                    className="input input-sm w-full stack-mono"
                    required
                  />
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Remote path</legend>
                  <input
                    name="remotePath"
                    defaultValue={repo.remotePath}
                    className="input input-sm w-full stack-mono"
                    required
                  />
                  <p className="text-xs text-base-content/50">
                    For GitHub use the clone URL, e.g.{" "}
                    <code className="stack-mono">https://github.com/owner/repo.git</code>
                  </p>
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Default branch</legend>
                  <input
                    name="defaultBranch"
                    defaultValue={repo.defaultBranch}
                    className="input input-sm w-full stack-mono"
                    required
                  />
                </fieldset>
                <div className="lg:col-span-2">
                  <button type="submit" className="btn btn-primary btn-sm gap-1">
                    <Save size={15} /> Save repository link
                  </button>
                </div>
              </form>
            </div>
          </div>
        ))}

        {project.repos.length === 0 && (
          <div className="card border border-base-300 bg-base-100">
            <div className="card-body gap-4">
              <div className="alert alert-warning text-sm">
                <span>
                  No repository is linked to {project.key} yet. Events cannot be matched to this
                  project until one is.
                </span>
              </div>
              <form action={linkRepo.bind(null, project.id)} className="grid gap-4 lg:grid-cols-2">
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Provider</legend>
                  <select name="provider" defaultValue="github" className="select select-sm w-full">
                    <option value="mock-github">mock-github</option>
                    <option value="github">github</option>
                  </select>
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Repository name</legend>
                  <input
                    name="name"
                    className="input input-sm w-full stack-mono"
                    placeholder="acme/checkout"
                    required
                  />
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Remote path</legend>
                  <input
                    name="remotePath"
                    className="input input-sm w-full stack-mono"
                    placeholder="https://github.com/owner/repo.git"
                    required
                  />
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Default branch</legend>
                  <input
                    name="defaultBranch"
                    className="input input-sm w-full stack-mono"
                    placeholder="main"
                  />
                </fieldset>
                <div className="lg:col-span-2">
                  <button type="submit" className="btn btn-primary btn-sm gap-1">
                    <GitBranch size={15} /> Link repository
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users size={18} /> Members
        </h2>

        <div className="card border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <p className="text-sm text-base-content/60">
              Membership is what lets a developer see a project at all. A developer with no
              memberships sees an empty portal; adding one here is the whole onboarding step.
            </p>

            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th className="text-right">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {memberships.map((membership) => (
                    <tr key={membership.id}>
                      <td className="text-sm font-medium">{membership.user.name}</td>
                      <td className="stack-mono text-xs text-base-content/60">
                        {membership.user.email}
                      </td>
                      <td>
                        <RoleBadge role={membership.role} />
                      </td>
                      <td className="text-right">
                        <form
                          action={removeMemberAction.bind(
                            null,
                            project.id,
                            project.key,
                            membership.id,
                          )}
                        >
                          <button
                            type="submit"
                            className="btn btn-ghost btn-xs gap-1 text-error"
                            aria-label={`Remove ${membership.user.name} from ${project.key}`}
                          >
                            <X size={14} /> Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {memberships.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-sm text-base-content/50">
                        No one is on {project.key} yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="divider my-0 text-xs">Add a member</div>

            {candidates.length === 0 ? (
              <p className="text-sm text-base-content/60">
                Everyone in the directory is already a member of {project.key}.
              </p>
            ) : (
              <form
                action={addMemberAction.bind(null, project.id, project.key)}
                className="grid gap-4 lg:grid-cols-[2fr_1fr_auto] lg:items-end"
              >
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Person</legend>
                  <select name="userId" className="select select-sm w-full" required defaultValue="">
                    <option value="" disabled>
                      Choose a person
                    </option>
                    {candidates.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name} — {person.email} ({person.role.toLowerCase()})
                      </option>
                    ))}
                  </select>
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Role on this project</legend>
                  <select name="role" className="select select-sm w-full" defaultValue="DEVELOPER">
                    {MEMBERSHIP_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {MEMBERSHIP_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </fieldset>
                <button type="submit" className="btn btn-primary btn-sm gap-1">
                  <UserPlus size={15} /> Add to project
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-4">
          <h2 className="card-title flex items-center gap-2 text-base">
            <Plug size={18} /> GitHub integration
          </h2>

          <div className="flex flex-wrap items-center gap-4">
            <EnvBadge configured={githubTokenConfigured} name="STACK_GITHUB_TOKEN" />
            <EnvBadge configured={webhookSecretConfigured} name="STACK_WEBHOOK_SECRET" />
          </div>
          <p className="text-xs text-base-content/50">
            The portal only ever reports whether these are set — never their values.
          </p>

          {!githubTokenConfigured || !webhookSecretConfigured ? (
            <div className="alert alert-warning items-start text-left">
              <AlertTriangle className="mt-0.5 shrink-0" size={18} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm">
                  Add the missing variable(s) to{" "}
                  <code className="stack-mono">apps/portal/.env.local</code> and restart the portal:
                </p>
                <div className="flex items-start gap-2">
                  <div className="mockup-code min-w-0 flex-1 text-xs">
                    <pre>
                      <code>{envSnippet}</code>
                    </pre>
                  </div>
                  <CopyButton text={envSnippet} className="btn-sm shrink-0" />
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-base-content/60">
              Both variables are set in <code className="stack-mono">apps/portal/.env.local</code>.
            </p>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Client repository workflow</h3>
            <p className="text-sm text-base-content/60">
              Paste this into the client repo as{" "}
              <code className="stack-mono">.github/workflows/stack-events.yml</code>. It posts push
              and pull request events to the portal, signed with the webhook secret; the portal&apos;s{" "}
              <code className="stack-mono">/api/git/events</code> endpoint verifies the signature and
              moves work on evidence — exactly this payload, nothing else.
            </p>
            <div className="flex items-start gap-2">
              <div className="mockup-code min-w-0 flex-1 overflow-x-auto text-xs">
                <pre>
                  <code>{workflow}</code>
                </pre>
              </div>
              <CopyButton text={workflow} className="btn-sm shrink-0" />
            </div>
          </div>

          <div className="alert alert-soft text-xs">
            <span>
              The portal must be reachable from GitHub. It runs on{" "}
              <code className="stack-mono">localhost:4200</code> here, so expose it through a tunnel
              (cloudflared, ngrok or an SSH reverse tunnel) and set the public URL as the{" "}
              <code className="stack-mono">STACK_PORTAL_URL</code> repository secret, next to{" "}
              <code className="stack-mono">STACK_WEBHOOK_SECRET</code>, in the client repository.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
