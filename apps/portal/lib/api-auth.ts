import { prisma } from "@stack/db";
import { hashToken } from "@stack/core";

export interface ApiContext {
  tokenId: string;
  role: string;
  user: { id: string; name: string; email: string; role: string };
  projectId: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Bearer tokens are the only way in for the CLI, CI and agents. */
export async function authenticate(request: Request): Promise<ApiContext> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw new ApiError(401, "Missing bearer token. Run `stack login` first.");
  }

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(match[1].trim()) },
    include: { user: true },
  });

  if (!token || token.revokedAt) {
    throw new ApiError(401, "Token is unknown or revoked. Create a new one in the portal.");
  }

  await prisma.apiToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    tokenId: token.id,
    role: token.role,
    projectId: token.projectId,
    user: {
      id: token.user.id,
      name: token.user.name,
      email: token.user.email,
      role: token.user.role,
    },
  };
}

export function requireRole(ctx: ApiContext, roles: string[]): void {
  if (!roles.includes(ctx.role)) {
    throw new ApiError(403, `This token has role ${ctx.role}; ${roles.join(" or ")} required.`);
  }
}

/** Projects a token may see: admins see everything, everyone else sees memberships. */
export async function visibleProjectIds(ctx: ApiContext): Promise<string[] | null> {
  if (ctx.role === "ADMIN") return null;
  const memberships = await prisma.membership.findMany({
    where: { userId: ctx.user.id },
    select: { projectId: true },
  });
  const ids = memberships.map((m) => m.projectId);
  return ctx.projectId ? ids.filter((id) => id === ctx.projectId) : ids;
}

export function jsonError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "Unexpected server error" }, { status: 500 });
}
