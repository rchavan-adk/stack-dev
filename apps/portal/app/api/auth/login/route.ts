import { prisma } from "@stack/db";
import { verifyPassword } from "@stack/core";
import { createSession } from "@/lib/session";

/**
 * Email and password. The previous version accepted a user id from the form
 * and trusted it, so anyone could sign in as anyone.
 *
 * Failures are deliberately indistinguishable: an unknown address, an account
 * with no password set, and a wrong password all answer the same way, so this
 * endpoint cannot be used to find out who has an account here.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  const fail = () => Response.redirect(new URL("/login?error=invalid", request.url), 303);

  if (!email || !password) return fail();

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok) return fail();

  await createSession(user.id, request.headers.get("user-agent"));
  return Response.redirect(new URL("/dashboard", request.url), 303);
}
