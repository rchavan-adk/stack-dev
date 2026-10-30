import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@stack/db";
import { generateSessionToken, hashSessionToken } from "@stack/core";

export const SESSION_COOKIE = "stack_session";

/** Twelve hours, renewed on use: long enough for a working day, short enough to matter. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string | null;
}

/**
 * The cookie used to be the user id in plain text, which meant anyone could
 * become anyone by editing it. It now carries a random token whose hash is
 * the only thing stored, and the row behind it can be revoked.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, title: true } },
    },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  // Sliding expiry, written at most once an hour so a page load is not a write.
  if (Date.now() - session.lastSeenAt.getTime() > RENEW_AFTER_MS) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      })
      .catch(() => undefined);
  }

  return session.user;
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function createSession(userId: string, userAgent?: string | null): Promise<void> {
  const { token, tokenHash } = generateSessionToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 200) ?? null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Set over TLS in a deployment; staying off on http://localhost keeps dev working.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Signing out revokes the session server-side, not just in the browser. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashSessionToken(token) } })
      .catch(() => undefined);
  }
  store.delete(SESSION_COOKIE);
}

export function canAdminister(role: string): boolean {
  return role === "ADMIN" || role === "LEAD";
}

/** Clients get a read-only view; everything that mutates is hidden from them. */
export function isReadOnly(role: string): boolean {
  return role === "CLIENT";
}
