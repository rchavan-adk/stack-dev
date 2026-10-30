import { cookies } from "next/headers";
import { prisma } from "@stack/db";
import { SESSION_COOKIE } from "@/lib/session";

/** Mock login: no password, the seeded persona id is the session. */
export async function POST(request: Request) {
  const form = await request.formData();
  const userId = String(form.get("userId") ?? "");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return Response.redirect(new URL("/login?error=unknown-user", request.url), 303);
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return Response.redirect(new URL("/dashboard", request.url), 303);
}
