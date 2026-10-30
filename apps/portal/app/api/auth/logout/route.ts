import { destroySession } from "@/lib/session";
import { portalUrl } from "@/lib/urls";

export async function POST(request: Request) {
  await destroySession();
  // Built from the configured public URL, not request.url: behind CloudFront the
  // request carries the container's own address. See lib/urls.ts.
  return Response.redirect(portalUrl("/login", request.url), 303);
}
