import Link from "next/link";
import { Ban, EyeOff, KeyRound, Terminal } from "lucide-react";
import { prisma } from "@stack/db";
import { isReadOnly, requireSessionUser } from "@/lib/session";
import { RoleBadge } from "@/components/status";
import { CreateTokenForm } from "@/components/create-token-form";
import { TokenUsage } from "@/components/token-usage";
import { CopyButton } from "@/components/copy-button";
import { formatDate } from "@/lib/format";
import { createOwnToken, revokeOwnToken } from "./actions";

export default async function MyTokensPage() {
  const user = await requireSessionUser();

  const [tokens, memberships, allProjects] = await Promise.all([
    prisma.apiToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { project: { select: { key: true } } },
    }),
    prisma.membership.findMany({
      where: { userId: user.id },
      include: { project: { select: { id: true, key: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    user.role === "ADMIN"
      ? prisma.project.findMany({ orderBy: { key: "asc" }, select: { id: true, key: true, name: true } })
      : Promise.resolve([]),
  ]);

  const projects = user.role === "ADMIN" ? allProjects : memberships.map((m) => m.project);
  const readOnly = isReadOnly(user.role);
  const portalUrl = process.env.STACK_PORTAL_URL ?? "http://localhost:4200";
  const mcpUrl = process.env.STACK_MCP_URL ?? "http://localhost:4300/mcp";
  const loginCommand = "stack login --token stk_dev_…";

  const allowedRoles =
    user.role === "ADMIN"
      ? [
          { value: "ADMIN", label: "admin — everything" },
          { value: "LEAD", label: "lead — planner tools, approvals" },
          { value: "DEVELOPER", label: "developer — pull work, report status" },
        ]
      : user.role === "LEAD"
        ? [
            { value: "LEAD", label: "lead — planner tools, approvals" },
            { value: "DEVELOPER", label: "developer — pull work, report status" },
          ]
        : [{ value: "DEVELOPER", label: "developer — pull work, report status" }];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">My API tokens</h1>
        <p className="max-w-3xl text-sm text-base-content/60">
          This is the page <code className="stack-mono">stack login</code> points you at. A token
          signs the CLI, OpenCode and CI into the portal — it never grants the persona login.
          Signed in as {user.name} <RoleBadge role={user.role} />
        </p>
      </header>

      <div className="card border border-secondary/40 bg-base-100">
        <div className="card-body gap-3">
          <h2 className="card-title flex items-center gap-2 text-base">
            <Terminal size={18} /> Paste your token into the CLI
          </h2>
          <p className="text-sm text-base-content/60">
            Create a token below, copy it, then run <code className="stack-mono">stack login</code>{" "}
            on your machine. The CLI stores it at{" "}
            <code className="stack-mono">~/.stack/credentials.json</code> (mode 0600) and validates
            it against the portal before saving. Add{" "}
            <code className="stack-mono">--portal {portalUrl}</code> when the portal is not the
            default one.
          </p>
          <div className="flex items-center gap-2">
            <div className="mockup-code min-w-0 flex-1 text-xs">
              <pre data-prefix="$">
                <code>{loginCommand}</code>
              </pre>
            </div>
            <CopyButton text={loginCommand} className="btn-sm shrink-0" />
          </div>
        </div>
      </div>

      {readOnly && (
        <div className="alert alert-warning items-start text-left">
          <EyeOff className="mt-1 shrink-0" size={20} />
          <div>
            <h2 className="font-semibold">Clients do not need API tokens</h2>
            <p className="text-sm">
              Your persona login is read-only by design — dashboards, evidence and spend. Tokens
              exist for machines: the CLI, OpenCode and CI. Ask a lead if you need more.
            </p>
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <h2 className="card-title flex items-center gap-2 text-base">
              <KeyRound size={18} /> New token
            </h2>
            <p className="text-sm text-base-content/60">
              The token carries your role by default. You cannot mint a token above your own role —
              that is enforced server-side, not just hidden in this form.
            </p>
            <CreateTokenForm
              action={createOwnToken}
              portalUrl={portalUrl}
              roles={allowedRoles}
              defaultRole={user.role}
              projects={projects}
              submitLabel="Create my token"
            />
          </div>
        </div>
      )}

      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-4 p-0">
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Name</th>
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
                        <span className="text-xs text-base-content/40">—</span>
                      ) : (
                        <form action={revokeOwnToken.bind(null, token.id)}>
                          <button
                            type="submit"
                            className="btn btn-ghost btn-xs gap-1 text-error"
                            disabled={readOnly}
                            title="Revoking is immediate; this machine or agent must be given a new token"
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
                    <td colSpan={8} className="text-center text-sm text-base-content/50">
                      {readOnly
                        ? "You have no tokens (clients do not need them)."
                        : "No tokens yet — create your first one above."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {!readOnly && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">How your token is used</h2>
          <TokenUsage portalUrl={portalUrl} mcpUrl={mcpUrl} />
          <p className="text-xs text-base-content/50">
            Leads: the same token also unlocks the planner MCP tools (submit plans, waves and
            specs). The <Link href="/get-started" className="link">get started</Link> page walks
            through the whole setup.
          </p>
        </section>
      )}
    </div>
  );
}
