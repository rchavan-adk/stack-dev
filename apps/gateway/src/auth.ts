/**
 * Stack token auth, same scheme as the MCP server: the raw token arrives in a
 * header, only its sha256 is stored in the DB.
 *
 * Which engagement a call belongs to is resolved separately from who is
 * calling, because agents carry an item handle (STACK-110), not a project key:
 * the harness sets STACK_ITEM, never a project header.
 */
// tsx loads @stack/core as CommonJS (the package has no "type": "module"), so
// named imports through its `export *` barrel fail at link time. Import the
// concrete source files instead — same as apps/mcp.
import { hashToken } from "@stack/core/src/tokens";
import { prisma } from "@stack/db";
import type { Issue, Membership, Project, User } from "@stack/db";

export class AuthError extends Error {}

export interface TokenContext {
  user: User & { memberships: Membership[] };
  /** The project the token itself is scoped to, if it is scoped at all. */
  tokenProject: Project | null;
  role: string;
}

export async function resolveToken(rawToken: string | undefined): Promise<TokenContext> {
  if (!rawToken) {
    throw new AuthError("missing Stack token: send it as x-api-key or Authorization: Bearer");
  }
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { include: { memberships: true } }, project: true },
  });
  if (!token) throw new AuthError("unknown Stack token");
  if (token.revokedAt !== null) {
    throw new AuthError("Stack token revoked; run `stack login` again");
  }
  await prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  return { user: token.user, tokenProject: token.project, role: token.role };
}

function canSee(ctx: TokenContext, project: Project): boolean {
  return (
    ctx.user.role === "ADMIN" || ctx.user.memberships.some((m) => m.projectId === project.id)
  );
}

/**
 * Engagement resolution, in order of how specific the evidence is:
 * the token's own scope, then an explicit header, then the claimed item.
 */
export async function resolveProject(
  ctx: TokenContext,
  projectKeyHeader: string | undefined,
  issue: Issue | null,
): Promise<Project> {
  const wanted = projectKeyHeader?.toUpperCase();

  if (ctx.tokenProject) {
    if (wanted && ctx.tokenProject.key !== wanted) {
      throw new AuthError(`token is scoped to project ${ctx.tokenProject.key}, not ${wanted}`);
    }
    return ctx.tokenProject;
  }

  if (wanted) {
    const project = await prisma.project.findUnique({ where: { key: wanted } });
    if (!project) throw new AuthError(`unknown project ${wanted}`);
    if (!canSee(ctx, project)) throw new AuthError(`you are not a member of project ${wanted}`);
    return project;
  }

  if (issue) {
    const project = await prisma.project.findUnique({ where: { id: issue.projectId } });
    if (!project) throw new AuthError(`item ${issue.handle} points at a project that is gone`);
    if (!canSee(ctx, project)) {
      throw new AuthError(`you are not a member of project ${project.key}, which owns ${issue.handle}`);
    }
    return project;
  }

  throw new AuthError(
    "cannot tell which engagement this call belongs to: send X-Stack-Item (the claimed item) " +
      "or X-Stack-Project",
  );
}
