import { destroySession } from "@/lib/session";

export async function POST(request: Request) {
  await destroySession();
  return Response.redirect(new URL("/login", request.url), 303);
}
