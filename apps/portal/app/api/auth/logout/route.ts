import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(request: Request) {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return Response.redirect(new URL("/login", request.url), 303);
}
