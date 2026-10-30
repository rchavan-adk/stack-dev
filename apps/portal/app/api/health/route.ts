import { NextResponse } from "next/server";

/**
 * Liveness probe for the load balancer.
 *
 * It deliberately checks nothing but the process itself. An earlier version of
 * the health check pointed at /login, which redirects to /setup while the
 * deployment has no accounts yet, so the load balancer marked a perfectly
 * healthy task as unhealthy and refused to route to it.
 *
 * It also does not touch the database, on purpose. A health check that fails
 * when Postgres has a hiccup would have the load balancer replace a task that is
 * still able to serve the login page, turning a brief database problem into a
 * deployment outage. Readiness of the database is a separate concern from
 * liveness of the process.
 */
export function GET() {
  return NextResponse.json({ ok: true, service: "portal" });
}
