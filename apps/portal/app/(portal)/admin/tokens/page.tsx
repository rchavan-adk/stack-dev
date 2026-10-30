import { Ban, KeyRound } from "lucide-react";
import { mcpEndpointUrl, portalBaseUrl } from "@/lib/urls";
import { prisma } from "@stack/db";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { AdminDenied } from "@/components/admin-gate";
import { RoleBadge } from "@/components/status";
import { CreateTokenForm } from "@/components/create-token-form";
import { TokenUsage } from "@/components/token-usage";
import { formatDate } from "@/lib/format";
import { createAdminToken, revokeToken } from "./actions";

const MINTABLE_ROLES = [
  { value: "DEVELOPER", label: "developer — pull work, report status" },
  { value: "LEAD", label: "lead — planner tools, approvals" },
  { value: "ADMIN", label: "admin — everything" },
];

export default async function AdminTokensPage() {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) return <AdminDenied user={user} />;

  const [tokens, users, projects] = await Promise.all([
    prisma.apiToken.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, role: true } },
        project: { select: { key: true } },
      },
    }),
    prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }], select: { id: true, name: true, role: true } }),
    prisma.project.findMany({ orderBy: { key: "asc" }, select: { id: true, key: true, name: true } }),
  ]);

  const active = tokens.filter((token) => !token.revokedAt).length;
  const portalUrl = portalBaseUrl();
  const mcpUrl = mcpEndpointUrl();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">MCP tokens</h1>
        <p className="max-w-3xl text-sm text-base-content/60">
          Bearer tokens are how the CLI, CI and agents authenticate — never the persona login.
          The portal stores only a SHA-256 hash; a token is shown once at creation and can be
          revoked, never recovered.
        </p>
      </header>

      <div className="stats stats-vertical sm:stats-horizontal w-full bg-base-100 font-mono shadow">
        <div className="stat">
          <div className="stat-title">Tokens</div>
          <div className="stat-value text-2xl">{tokens.length}</div>
          <div className="stat-desc">across all users</div>
        </div>
        <div className="stat">
          <div className="stat-title">Active</div>
          <div className="stat-value text-2xl">{active}</div>
          <div className="stat-desc">usable against the MCP and API</div>
        </div>
        <div className="stat">
          <div className="stat-title">Revoked</div>
          <div className="stat-value text-2xl">{tokens.length - active}</div>
          <div className="stat-desc">rejected on sight</div>
        </div>
      </div>

      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-4">
          <h2 className="card-title flex items-center gap-2 text-base">
            <KeyRound size={18} /> Create a token
          </h2>
          <p className="text-sm text-base-content/60">
            Mint one per person and machine. The role decides what the MCP allows; the project
            scope narrows it to a single engagement.
          </p>
          <CreateTokenForm
            action={createAdminToken}
            portalUrl={portalUrl}
            users={users}
            roles={MINTABLE_ROLES}
            defaultRole="DEVELOPER"
            projects={projects}
          />
        </div>
      </div>

      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-4 p-0">
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Project</th>
                  <th>Prefix</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id}>
                    <td className="font-medium">{token.name}</td>
                    <td>{token.user.name}</td>
                    <td>
                      <RoleBadge role={token.role} />
                    </td>
                    <td>
                      {token.project ? (
                        <span className="badge badge-ghost badge-xs stack-mono">{token.project.key}</span>
                      ) : (
                        <span className="text-base-content/40">all</span>
                      )}
                    </td>
                    <td className="stack-mono text-xs">{token.prefix}…</td>
                    <td className="whitespace-nowrap text-xs text-base-content/70">
                      {formatDate(token.createdAt, "—")}
                    </td>
                    <td className="whitespace-nowrap text-xs text-base-content/70">
                      {formatDate(token.lastUsedAt, "never")}
                    </td>
                    <td>
                      {token.revokedAt ? (
                        <span className="badge badge-error badge-sm whitespace-nowrap">revoked</span>
                      ) : (
                        <span className="badge badge-success badge-sm whitespace-nowrap">active</span>
                      )}
                    </td>
                    <td className="text-right">
                      {token.revokedAt ? (
                        <span className="text-xs text-base-content/40">revoked {formatDate(token.revokedAt, "")}</span>
                      ) : (
                        <form action={revokeToken.bind(null, token.id)}>
                          <button
                            type="submit"
                            className="btn btn-ghost btn-xs gap-1 text-error"
                            title="Revoking is immediate and permanent; that machine must be given a new token"
                          >
                            <Ban size={13} /> Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
                {tokens.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center text-sm text-base-content/50">
                      No tokens yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">How a token is used</h2>
        <TokenUsage portalUrl={portalUrl} mcpUrl={mcpUrl} />
      </section>
    </div>
  );
}
