"use server";

import { redirect } from "next/navigation";
import { prisma } from "@stack/db";
import { hashPassword, passwordProblem } from "@stack/core";
import { createSession, revokeAllSessions } from "@/lib/session";
import { consumeInvite, lookupInvite } from "@/lib/invites";
import type { PasswordState } from "@/components/password-form";

/**
 * Accept an invitation or complete a password reset.
 *
 * Both flows are the same act: the holder of a single-use link chooses a
 * password. The link is the proof of identity, which is why no current password
 * is asked for — on an invitation there is none, and on a reset the person by
 * definition cannot supply one.
 */
export async function acceptInvite(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const found = await lookupInvite(token);
  if (!found.ok) {
    // A dead link is not an error the person can fix, so it is reported plainly.
    return {
      status: "error",
      message:
        found.reason === "used"
          ? "This link has already been used. Ask an administrator for a new one."
          : found.reason === "expired"
            ? "This link has expired. Ask an administrator for a new one."
            : "This link is not valid. Check that it was copied in full.",
    };
  }

  if (password !== confirm) return { status: "error", message: "The two passwords do not match." };
  const problem = passwordProblem(password);
  if (problem) return { status: "error", message: problem };

  // Claim the link before writing the password. If two requests race, only the
  // one that wins this conditional update may proceed.
  if (!(await consumeInvite(found.invite.id))) {
    return {
      status: "error",
      message: "This link was just used. Ask an administrator for a new one.",
    };
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: found.user.id }, data: { passwordHash } });

  // Any session that existed before this moment is no longer trustworthy: on a
  // reset it may be the attacker's, and on an invitation it cannot exist.
  await revokeAllSessions(found.user.id);

  // No evidence event here on purpose. The ledger records project work, and a
  // password change is not project evidence; writing one with a borrowed
  // project id would put a false row in the record.
  console.log(
    `[auth] ${found.user.email} set their password via ${
      found.invite.kind === "RESET" ? "a reset link" : "an invitation"
    }`,
  );

  await createSession(found.user.id);
  redirect("/dashboard");
}
