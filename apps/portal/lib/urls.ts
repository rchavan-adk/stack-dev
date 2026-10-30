/**
 * The portal's own public address, and the addresses of the services beside it.
 *
 * Every absolute URL the portal hands back to a browser has to be built from
 * here, never from `request.url`. Behind the load balancer and CloudFront,
 * Next.js resolves `request.url` from the incoming Host header, which is the
 * container's own address, so a redirect written as
 * `new URL("/login", request.url)` sends a real user to http://localhost:4200.
 * That is a broken login in production, and it is the kind of bug that only
 * shows up once the app is behind a proxy.
 *
 * Each function prefers its configured value and falls back to the address the
 * service uses in development, so a local checkout keeps working unchanged.
 */

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function portalBaseUrl(): string {
  const configured = process.env.STACK_PORTAL_URL;
  return configured ? trimTrailingSlash(configured) : "http://localhost:4200";
}

/** The MCP endpoint as an outside client should reach it. */
export function mcpEndpointUrl(): string {
  const configured = process.env.STACK_MCP_URL;
  return configured ? trimTrailingSlash(configured) : "http://localhost:4300/mcp";
}

/**
 * An absolute URL for a path on this portal.
 *
 * `fallbackOrigin` is the origin of the incoming request. It is consulted only
 * when nothing is configured, and deliberately last: it is the value that is
 * wrong in a proxied deployment.
 */
export function portalUrl(path: string, fallbackOrigin?: string): string {
  const base = process.env.STACK_PORTAL_URL;
  if (base) return new URL(path, `${trimTrailingSlash(base)}/`).toString();
  if (fallbackOrigin) return new URL(path, fallbackOrigin).toString();
  return new URL(path, `${portalBaseUrl()}/`).toString();
}

/**
 * True when the portal is running on a developer machine, which is what decides
 * whether instructions should be talking about tunnels.
 */
export function isLocalDeployment(): boolean {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(
    portalBaseUrl().replace(/^https?:\/\//, ""),
  );
}
