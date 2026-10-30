"use server";

import { redirect } from "next/navigation";
import { prisma } from "@stack/db";
import { hashPassword, passwordProblem } from "@stack/core";
import { createSession } from "@/lib/session";

function back(message: string): never {
  redirect(`/setup?error=${encodeURIComponent(message)}`);
}

/**
 * First-run bootstrap: the first administrator of a fresh deployment.
 *
 * This is only reachable while the database has no users at all, which is the
 * one moment where an unauthenticated caller may create an admin. The check is
 * inside the transaction-less path but re-read immediately before the write, so
 * a second caller racing the first is refused.
 */
export async function createFirstAdmin(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (await prisma.user.count()) {
    back("This deployment is already set up. Sign in instead.");
  }
  if (!name) back("Enter the administrator's name.");
  if (!email || !email.includes("@")) back("Enter a valid email address.");
  if (password !== confirm) back("The two passwords do not match.");

  const problem = passwordProblem(password);
  if (problem) back(problem);

  const passwordHash = await hashPassword(password);

  let userId: string;
  try {
    const user = await prisma.user.create({
      data: { name, email, role: "ADMIN", title: "Platform administrator", passwordHash },
    });
    userId = user.id;
  } catch {
    back("That account could not be created. It may already exist.");
  }

  await createSession(userId);
  redirect("/dashboard");
}
