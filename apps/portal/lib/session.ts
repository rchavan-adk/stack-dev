import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@stack/db";

export const SESSION_COOKIE = "stack_session";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const userId = store.get(SESSION_COOKIE)?.value;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, title: true },
  });
  return user ?? null;
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export function canAdminister(role: string): boolean {
  return role === "ADMIN" || role === "LEAD";
}

/** Clients get a read-only view; everything that mutates is hidden from them. */
export function isReadOnly(role: string): boolean {
  return role === "CLIENT";
}
