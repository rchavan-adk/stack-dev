/**
 * Invitations and password resets.
 *
 * The portal had exactly one way to create an account: /setup, which closes
 * itself after the first administrator. That made every multi-role workflow
 * unreachable, because a LEAD or a DEVELOPER could never exist.
 *
 * An invitation creates the user row immediately with a null passwordHash, which
 * is the state the schema already describes as "cannot sign in yet", and hands
 * back a single-use link. Until that link is used the account cannot be signed
 * into at all, so an invitation that is never accepted is not a credential.
 */
import { prisma } from "@stack/db";
import { generateInviteToken, hashInviteToken } from "@stack/core";

/** A week to accept an invitation: long enough for a holiday to intervene. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** An hour for a reset, because a reset link is a live credential on an active account. */
export const RESET_TTL_MS = 60 * 60 * 1000;

export type InviteKind = "INVITE" | "RESET";

export interface CreatedInvite {
  token: string;
  expiresAt: Date;
}

/**
 * Mint a link. The plaintext token is returned exactly once and never stored.
 * Any earlier unused link of the same kind is consumed first, so generating a
 * second link cannot leave two working ones in the wild.
 */
export async function createInvite(input: {
  userId: string;
  kind: InviteKind;
  createdById?: string | null;
}): Promise<CreatedInvite> {
  const ttl = input.kind === "RESET" ? RESET_TTL_MS : INVITE_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  const { token, tokenHash } = generateInviteToken();

  await prisma.invite.updateMany({
    where: { userId: input.userId, kind: input.kind, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.invite.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      tokenHash,
      expiresAt,
      createdById: input.createdById ?? null,
    },
  });

  return { token, expiresAt };
}

export type InviteLookup =
  | { ok: true; invite: { id: string; kind: string; userId: string }; user: InviteUser }
  | { ok: false; reason: "unknown" | "used" | "expired" };

export interface InviteUser {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string | null;
}

/**
 * Resolve a token from a link. Expiry and single-use are checked here rather
 * than in the page, so every caller gets the same answer.
 */
export async function lookupInvite(token: string): Promise<InviteLookup> {
  if (!token) return { ok: false, reason: "unknown" };

  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, title: true } },
    },
  });
  if (!invite) return { ok: false, reason: "unknown" };
  if (invite.usedAt) return { ok: false, reason: "used" };
  if (invite.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  return {
    ok: true,
    invite: { id: invite.id, kind: invite.kind, userId: invite.userId },
    user: invite.user,
  };
}

/**
 * Mark a link used, but only if it is still unused.
 *
 * The conditional update is the guard against a replay: two requests arriving
 * together both pass lookupInvite, and exactly one of them wins here.
 */
export async function consumeInvite(inviteId: string): Promise<boolean> {
  const result = await prisma.invite.updateMany({
    where: { id: inviteId, usedAt: null },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}

/** The link a person follows. Built from the public URL, never from the request host. */
export function invitePath(token: string): string {
  return `/invite/${token}`;
}
