"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@stack/db";
import { requireSessionUser, revokeAllSessions } from "@/lib/session";
import { createInvite, invitePath } from "@/lib/invites";
import { portalUrl } from "@/lib/urls";
import type { InviteState } from "@/components/invite-person-form";

const ALLOWED_ROLES = ["ADMIN", "LEAD", "DEVELOPER", "CLIENT"] as const;

/**
 * Inviting is an ADMIN action, not a lead one.
 *
 * canAdminister() lets a lead manage a project, which is project-scoped work. An
 * account is global: it exists across every project, and the role on it decides
 * what the person can see anywhere. That is a different kind of decision, so it
 * needs the higher role rather than the project one.
 */
async function requireAdmin() {
  const user = await requireSessionUser();
  if (user.role !== "ADMIN") return null;
  return user;
}

function describeExpiry(at: Date): string {
  const hours = Math.round((at.getTime() - Date.now()) / (60 * 60 * 1000));
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Create a person and hand back their single-use activation link.
 *
 * The account is created immediately with a null passwordHash, which the schema
 * describes as "cannot sign in yet". An invitation that is never accepted is
 * therefore not a credential, it is an inert row.
 */
export async function invitePerson(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const actor = await requireAdmin();
  if (!actor) return { status: "error", message: "Only an administrator can invite people." };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "").trim().toUpperCase();
  const title = String(formData.get("title") ?? "").trim();

  if (!name) return { status: "error", message: "Enter the person's name." };
  if (!email || !email.includes("@")) return { status: "error", message: "Enter a valid email address." };
  if (!ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number])) {
    return { status: "error", message: "Pick a role: admin, lead, developer or client." };
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return { status: "error", message: `${email} already has an account. Use a reset link instead.` };
  }

  const created = await prisma.user.create({
    data: {
      name,
      email,
      role,
      title: title || null,
      // Null until they accept: the account cannot be signed into yet.
      passwordHash: null,
    },
    select: { id: true },
  });

  const { token, expiresAt } = await createInvite({
    userId: created.id,
    kind: "INVITE",
    createdById: actor.id,
  });

  revalidatePath("/admin/people");

  return {
    status: "created",
    name,
    email,
    inviteUrl: portalUrl(invitePath(token)),
    expiresAt: describeExpiry(expiresAt),
  };
}

/**
 * Mint a reset link for an existing person and cut off their live sessions.
 *
 * Sessions are revoked here rather than only when the new password is set,
 * because the usual reason to reset is that you no longer trust whoever has the
 * account. Waiting for them to click the link would leave that access open.
 */
export async function createResetLink(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const actor = await requireAdmin();
  if (!actor) return { status: "error", message: "Only an administrator can reset a password." };

  const userId = String(formData.get("userId") ?? "").trim();
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, passwordHash: true },
  });
  if (!target) return { status: "error", message: "That person is no longer in the directory." };

  // Someone who never accepted their invitation has no password to reset, so
  // they get a fresh invitation and the wording on the page stays truthful.
  const kind = target.passwordHash ? "RESET" : "INVITE";
  const { token, expiresAt } = await createInvite({
    userId: target.id,
    kind,
    createdById: actor.id,
  });

  const revoked = await revokeAllSessions(target.id);

  revalidatePath("/admin/people");

  return {
    status: "created",
    name: target.name,
    email: target.email,
    inviteUrl: portalUrl(invitePath(token)),
    expiresAt: describeExpiry(expiresAt),
    message:
      kind === "RESET"
        ? `Reset link created. ${revoked} session${revoked === 1 ? "" : "s"} revoked.`
        : "That account had not been activated yet, so this is a fresh invitation.",
  };
}
