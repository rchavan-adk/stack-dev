"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@stack/db";
import { generateApiToken } from "@stack/core";
import { isReadOnly, requireSessionUser } from "@/lib/session";
import type { CreateTokenState } from "@/components/create-token-form";

// Rank decides what a person may mint for themselves: a developer can never
// mint a lead or admin token, even by hand-crafting the request.
const ROLE_RANK: Record<string, number> = { ADMIN: 3, LEAD: 2, DEVELOPER: 1 };

export async function createOwnToken(
  _previous: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const user = await requireSessionUser();
  if (isReadOnly(user.role)) {
    return { status: "error", message: "Clients get a read-only persona login, not MCP tokens." };
  }

  const requestedRole = String(formData.get("role") ?? user.role);
  const requestedRank = ROLE_RANK[requestedRole];
  if (requestedRank === undefined) {
    return { status: "error", message: "Token role must be admin, lead or developer." };
  }
  if (requestedRank > (ROLE_RANK[user.role] ?? 0)) {
    return {
      status: "error",
      message: `You are a ${user.role.toLowerCase()}; you cannot mint a ${requestedRole.toLowerCase()} token. Ask a lead or admin.`,
    };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { status: "error", message: "Give the token a name (for example “MacBook”)." };

  let projectId: string | null = null;
  const projectIdRaw = String(formData.get("projectId") ?? "");
  if (projectIdRaw) {
    const project = await prisma.project.findUnique({
      where: { id: projectIdRaw },
      select: { id: true },
    });
    if (!project) return { status: "error", message: "That project no longer exists." };
    if (user.role !== "ADMIN") {
      const membership = await prisma.membership.findUnique({
        where: { userId_projectId: { userId: user.id, projectId: project.id } },
        select: { id: true },
      });
      if (!membership) return { status: "error", message: "You are not a member of that project." };
    }
    projectId = project.id;
  }

  const generated = generateApiToken(requestedRole);
  await prisma.apiToken.create({
    data: {
      name,
      userId: user.id,
      projectId,
      role: requestedRole,
      prefix: generated.prefix,
      tokenHash: generated.tokenHash,
    },
  });

  revalidatePath("/settings/tokens");
  return { status: "created", token: generated.token, name };
}

export async function revokeOwnToken(tokenId: string): Promise<void> {
  const user = await requireSessionUser();

  // updateMany with the userId in the where clause keeps the scope tight.
  await prisma.apiToken.updateMany({
    where: { id: tokenId, userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/settings/tokens");
}
