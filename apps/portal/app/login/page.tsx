import { redirect } from "next/navigation";
import { prisma } from "@stack/db";
import { ArrowRight, GitBranch, ShieldCheck, Workflow } from "lucide-react";
import { BrandOnDark } from "@/components/brand";
import { RoleBadge } from "@/components/status";
import { getSessionUser } from "@/lib/session";

const ROLE_BLURB: Record<string, string> = {
  ADMIN: "Platform owner. Sets templates, publishes harness packs, issues MCP tokens.",
  LEAD: "Engagement lead. Plans waves, approves specs, validates finished work.",
  DEVELOPER: "Pulls assigned work through the developer MCP and ships it from the IDE.",
  CLIENT: "Read-only view of progress and the evidence behind every status.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSessionUser()) redirect("/dashboard");

  // Nobody has an account yet: this deployment has never been set up.
  const userCount = await prisma.user.count();
  if (userCount === 0) redirect("/setup");

  const { error } = await searchParams;
  const devAccounts =
    process.env.NODE_ENV === "production"
      ? []
      : await prisma.user.findMany({
          where: { passwordHash: { not: null } },
          orderBy: [{ role: "asc" }, { name: "asc" }],
          select: { email: true, name: true, role: true },
        });

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="miracle-gradient relative hidden flex-col justify-between p-12 text-white lg:flex">
        <BrandOnDark />

        <div className="max-w-lg">
          <h1 className="text-4xl font-semibold leading-tight">
            One record between two AI ecosystems.
          </h1>
          <p className="mt-4 text-white/80">
            Planners submit plans and waves. Developers pull assigned work into their own IDE. Stack
            AI holds the truth in the middle, runs no AI itself, and never sees client code.
          </p>

          <ul className="mt-10 space-y-4 text-sm">
            <li className="flex gap-3">
              <Workflow className="mt-0.5 shrink-0" size={18} />
              <span>
                <strong className="font-semibold">Templates enforced.</strong> Every issue and spec
                matches the Miracle template, or it comes back with the reason.
              </span>
            </li>
            <li className="flex gap-3">
              <GitBranch className="mt-0.5 shrink-0" size={18} />
              <span>
                <strong className="font-semibold">Status from evidence.</strong> Cards move on pull
                request and merge events, never on a claim.
              </span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 shrink-0" size={18} />
              <span>
                <strong className="font-semibold">People decide.</strong> Agents propose. Approval and
                validation stay human.
              </span>
            </li>
          </ul>
        </div>

        <p className="text-xs text-white/60">
          Evidence-backed delivery record · no client code stored
        </p>
      </section>

      <section className="flex items-center justify-center bg-base-200 p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <div className="miracle-gradient rounded-box p-5">
              <BrandOnDark compact />
            </div>
          </div>

          <div className="card border border-base-300 bg-base-100 shadow-sm">
            <div className="card-body gap-4">
              <div>
                <h2 className="card-title text-xl">Sign in</h2>
                <p className="text-sm text-base-content/60">
                  Your Stack account. Agents and the CLI never use this form.
                </p>
              </div>

              {error && (
                <div className="alert alert-error text-sm">
                  <span>That email and password did not match an account.</span>
                </div>
              )}

              <form action="/api/auth/login" method="post" className="space-y-3">
                <fieldset className="fieldset">
                  <legend className="fieldset-legend text-xs">Email</legend>
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    placeholder="you@miraclesoft.com"
                    className="input input-bordered w-full"
                  />
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend text-xs">Password</legend>
                  <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    className="input input-bordered w-full"
                  />
                </fieldset>
                <button type="submit" className="btn btn-primary w-full">
                  Sign in <ArrowRight size={16} />
                </button>
              </form>

              <div className="alert alert-soft text-xs">
                <span>
                  Agents and the CLI never use this login. They authenticate with an MCP token from{" "}
                  <span className="stack-mono">/settings/tokens</span>.
                </span>
              </div>

              {devAccounts.length > 0 && (
                <div className="rounded-box border border-dashed border-base-300 p-3">
                  <p className="text-xs font-medium">Development accounts</p>
                  <p className="mt-1 text-xs text-base-content/60">
                    Seeded locally with the password{" "}
                    <span className="stack-mono">stack-dev-password</span>. This block never renders
                    in production.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {devAccounts.map((account) => (
                      <li key={account.email} className="flex items-center gap-2 text-xs">
                        <RoleBadge role={account.role} />
                        <span className="stack-mono truncate">{account.email}</span>
                        <span className="truncate text-base-content/50">{account.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
