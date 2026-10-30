// tsx loads @stack/core as CommonJS (the package has no "type": "module"), so
// named imports through its `export *` barrel fail at link time. Import the
// concrete source files instead.
import { ROLES } from "@stack/core/src/constants";
import type { Role } from "@stack/core/src/constants";
import { hashToken } from "@stack/core/src/tokens";
import { prisma } from "@stack/db";
import type { ApiToken, Project, User } from "@stack/db";

export class AuthError extends Error {}

/**
 * Everything a request is allowed to do hangs off this context. `role` is the
 * token's role (the MCP grant), not the portal profile of the user.
 */
export interface AuthContext {
  token: ApiToken;
  user: User;
  role: Role;
  projectId?: string;
  project?: Project;
}

export async function resolveToken(token: string): Promise<AuthContext> {
  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true, project: true },
  });
  if (!record) throw new AuthError("unknown API token");
  if (record.revokedAt) {
    throw new AuthError("this API token was revoked; issue a new one in the portal");
  }
  if (!ROLES.includes(record.role as Role)) {
    throw new AuthError(`token has an invalid role "${record.role}"`);
  }
  await prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  return {
    token: record,
    user: record.user,
    role: record.role as Role,
    projectId: record.projectId ?? undefined,
    project: record.project ?? undefined,
  };
}
