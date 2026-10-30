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

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/dashboard");

  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    include: { memberships: { include: { project: { select: { key: true } } } } },
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
          Mock environment · deterministic demo data · no client code stored
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
                  Mock login. Pick a seeded persona to see the portal through their eyes.
                </p>
              </div>

              <ul className="divide-y divide-base-300">
                {users.map((user) => (
                  <li key={user.id}>
                    <form action="/api/auth/login" method="post">
                      <input type="hidden" name="userId" value={user.id} />
                      <button
                        type="submit"
                        className="group flex w-full items-center gap-3 px-1 py-3 text-left transition hover:bg-base-200"
                      >
                        <div className="avatar avatar-placeholder">
                          <div className="h-10 w-10 rounded-full bg-secondary text-secondary-content">
                            <span className="text-sm">
                              {user.name
                                .split(" ")
                                .map((part) => part[0])
                                .slice(0, 2)
                                .join("")}
                            </span>
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{user.name}</span>
                            <RoleBadge role={user.role} />
                          </div>
                          <p className="truncate text-xs text-base-content/60">
                            {ROLE_BLURB[user.role] ?? user.email}
                          </p>
                        </div>
                        <ArrowRight
                          size={16}
                          className="shrink-0 text-base-content/30 transition group-hover:translate-x-0.5 group-hover:text-primary"
                        />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>

              <div className="alert alert-soft text-xs">
                <span>
                  Agents and the CLI never use this login. They authenticate with an MCP token from{" "}
                  <span className="stack-mono">/settings/tokens</span>.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
