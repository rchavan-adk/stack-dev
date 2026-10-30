import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ROLE_SLUGS: Record<string, string> = {
  ADMIN: "adm",
  LEAD: "lead",
  DEVELOPER: "dev",
  CLIENT: "cli",
};

export interface GeneratedToken {
  token: string;
  prefix: string;
  tokenHash: string;
}

/** Portal issues these; the CLI stores one and the MCP server authenticates with it. */
export function generateApiToken(role: string): GeneratedToken {
  const slug = ROLE_SLUGS[role] ?? "usr";
  const token = `stk_${slug}_${randomBytes(24).toString("base64url")}`;
  return { token, prefix: token.slice(0, 12), tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export interface SignedPayload<T> {
  data: T;
  expiresAt: number;
}

/**
 * Harness tarballs are served from a signed URL so a download link can be handed
 * to a CLI, an agent, or a CI job without exposing the API token itself.
 */
export function signPayload<T>(data: T, secret: string, ttlSeconds = 600): string {
  const payload: SignedPayload<T> = { data, expiresAt: Date.now() + ttlSeconds * 1000 };
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyPayload<T>(signed: string, secret: string): T | null {
  const [body, signature] = signed.split(".");
  if (!body || !signature) return null;

  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedPayload<T>;
    if (typeof payload.expiresAt !== "number" || payload.expiresAt < Date.now()) return null;
    return payload.data;
  } catch {
    return null;
  }
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
