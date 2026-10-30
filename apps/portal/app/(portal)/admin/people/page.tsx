import { ShieldAlert, UserPlus, Users } from "lucide-react";
import { prisma } from "@stack/db";
import { requireSessionUser } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { RoleBadge } from "@/components/status";
import { InvitePersonForm } from "@/components/invite-person-form";
import { ResetLinkForm } from "@/components/reset-link-form";
import { createResetLink, invitePerson } from "./actions";

/**
 * People: the directory, and the only place accounts are created after /setup.
 *
 * Before this page existed the portal could hold exactly one account, because
 * /setup closes itself and nothing else created users. That made the roles the
 * product is built around — a lead who approves and assigns, a developer who
 * pulls work — impossible to demonstrate.
 */
export default async function PeoplePage() {
  const viewer = await requireSessionUser();
  const isAdmin = viewer.role === "ADMIN";

  const [users, outstanding] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        title: true,
        passwordHash: true,
        createdAt: true,
        _count: { select: { sessions: true, memberships: true, tokens: true } },
      },
    }),
    // Only unused, unexpired links matter: an expired one cannot be accepted.
    prisma.invite.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      select: { userId: true, kind: true, expiresAt: true },
    }),
  ]);

  const linkFor = new Map(outstanding.map((invite) => [invite.userId, invite]));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Users size={22} /> People
        </h1>
        <p className="max-w-3xl text-sm text-base-content/60">
          An account is global: the role on it decides what someone sees across every project.
          Project membership is separate, and is set per project.
        </p>
      </header>

      {isAdmin ? (
        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-4">
            <div>
              <h2 className="card-title flex items-center gap-2 text-base">
                <UserPlus size={18} /> Invite a person
              </h2>
              <p className="text-sm text-base-content/60">
                The account is created straight away but cannot be signed into until they open the
                link and choose a password. The portal sends no email, so hand the link over
                yourself.
              </p>
            </div>
            <InvitePersonForm action={invitePerson} />
          </div>
        </section>
      ) : (
        <div className="alert alert-info items-start text-left">
          <ShieldAlert className="mt-0.5 shrink-0" size={18} />
          <span className="text-sm">
            You can see the directory, but only an administrator can invite people or reset a
            password. An account is global, so it is a different decision from running a project.
          </span>
        </div>
      )}

      <section className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">
            Directory <span className="text-sm font-normal text-base-content/50">({users.length})</span>
          </h2>

          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Projects</th>
                  <th>Tokens</th>
                  <th>Joined</th>
                  {isAdmin && <th>Password</th>}
                </tr>
              </thead>
              <tbody>
                {users.map((person) => {
                  const invite = linkFor.get(person.id);
                  const active = Boolean(person.passwordHash);
                  return (
                    <tr key={person.id}>
                      <td>
                        <div className="font-medium">{person.name}</div>
                        <div className="text-xs text-base-content/60">{person.email}</div>
                        {person.title && (
                          <div className="text-xs text-base-content/50">{person.title}</div>
                        )}
                      </td>
                      <td>
                        <RoleBadge role={person.role} />
                      </td>
                      <td>
                        {active ? (
                          <span className="badge badge-success badge-sm">active</span>
                        ) : (
                          <span className="badge badge-warning badge-sm">invited</span>
                        )}
                        {person._count.sessions > 0 && (
                          <div className="text-xs text-base-content/50">
                            {person._count.sessions} live session
                            {person._count.sessions === 1 ? "" : "s"}
                          </div>
                        )}
                        {!active && invite && (
                          <div className="text-xs text-base-content/50">
                            link valid until {formatDate(invite.expiresAt)}
                          </div>
                        )}
                      </td>
                      <td className="stack-mono text-xs">{person._count.memberships}</td>
                      <td className="stack-mono text-xs">{person._count.tokens}</td>
                      <td className="text-xs">{formatDate(person.createdAt)}</td>
                      {isAdmin && (
                        <td>
                          <ResetLinkForm
                            action={createResetLink}
                            userId={person.id}
                            label={active ? "Reset link" : "New invite link"}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-base-content/50">
            A reset link lasts an hour and revokes every session that person holds. An invitation
            lasts seven days. Both work exactly once, and the portal stores only a hash, so a link
            that is lost has to be replaced rather than recovered.
          </p>
        </div>
      </section>
    </div>
  );
}
