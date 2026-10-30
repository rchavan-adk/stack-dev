"use server";

import { prisma } from "@stack/db";
import { hashPassword, passwordProblem, verifyPassword } from "@stack/core";
import { createSession, requireSessionUser, revokeAllSessions } from "@/lib/session";
import type { PasswordState } from "@/components/password-form";

/**
 * Change your own password.
 *
 * The current password is required, and that is the point: a session cookie is
 * proof of a session, not proof of the person. Without this check, anyone who
 * got hold of a logged-in browser for a moment could set a new password and lock
 * the real owner out of their own account.
 *
 * On success every session is revoked, including this one, and a fresh session
 * is issued. Changing a password is usually a response to suspecting compromise,
 * and leaving the other sessions alive would defeat that.
 */
export async function changeOwnPassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const viewer = await requireSessionUser();

  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const user = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!user) return { status: "error", message: "That account no longer exists." };

  const ok = await verifyPassword(current, user.passwordHash);
  if (!ok) return { status: "error", message: "That is not your current password." };

  if (password !== confirm) return { status: "error", message: "The two new passwords do not match." };
  if (password === current) {
    return { status: "error", message: "That is the password you already have. Pick a new one." };
  }
  const problem = passwordProblem(password);
  if (problem) return { status: "error", message: problem };

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });

  const revoked = await revokeAllSessions(user.id);
  await createSession(user.id);
  console.log(`[auth] ${user.email} changed their password; ${revoked} session(s) revoked`);

  return {
    status: "success",
    message: "Password changed. Every other device has been signed out.",
    resetKey: Date.now(),
  };
}
