"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@stack/db";
import { generateApiToken } from "@stack/core";
import { canAdminister, requireSessionUser } from "@/lib/session";
import type { CreateTokenState } from "@/components/create-token-form";

const MINTABLE_ROLES = ["ADMIN", "LEAD", "DEVELOPER"] as const;

/**
 * Admins mint tokens for any user. Only the hash and the 12-character prefix
 * are stored; the plaintext is returned once to the creating browser.
 */
export async function createAdminToken(
  _previous: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) {
    return { status: "error", message: "Minting tokens needs lead or admin rights." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { status: "error", message: "Give the token a name." };

  const userId = String(formData.get("userId") ?? "");
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) return { status: "error", message: "Choose a user for this token." };

  const role = String(formData.get("role") ?? "");
  if (!(MINTABLE_ROLES as readonly string[]).includes(role)) {
    return { status: "error", message: "Token role must be admin, lead or developer." };
  }

  let projectId: string | null = null;
  const projectIdRaw = String(formData.get("projectId") ?? "");
  if (projectIdRaw) {
    const project = await prisma.project.findUnique({
      where: { id: projectIdRaw },
      select: { id: true },
    });
    if (!project) return { status: "error", message: "That project no longer exists." };
    projectId = project.id;
  }

  const generated = generateApiToken(role);
  await prisma.apiToken.create({
    data: {
      name,
      userId,
      projectId,
      role,
      prefix: generated.prefix,
      tokenHash: generated.tokenHash,
    },
  });

  revalidatePath("/admin/tokens");
  return { status: "created", token: generated.token, name };
}

export async function revokeToken(tokenId: string): Promise<void> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) return;

  await prisma.apiToken.updateMany({
    where: { id: tokenId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/admin/tokens");
}
