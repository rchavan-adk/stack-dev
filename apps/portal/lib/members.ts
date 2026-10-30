import { prisma } from "@stack/db";
import { z } from "zod";
import { canAdminister } from "@/lib/session";

/**
 * Project membership is the only way a developer sees work, so every change to it
 * is a lead/admin action, validated here rather than in the UI. The lib knows
 * nothing about React; the settings page and the verification scripts both call it.
 */
export const MEMBERSHIP_ROLES = ["DEVELOPER", "LEAD", "CLIENT", "ADMIN"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MEMBERSHIP_ROLE_LABELS: Record<MembershipRole, string> = {
  DEVELOPER: "Developer",
  LEAD: "Lead",
  CLIENT: "Client",
  ADMIN: "Admin",
};

export interface MemberActor {
  id: string;
  name: string;
  role: string;
}

const actorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
});

const addMemberSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(MEMBERSHIP_ROLES),
  actor: actorSchema,
});

const removeMemberSchema = z.object({
  projectId: z.string().min(1),
  membershipId: z.string().min(1),
  actor: actorSchema,
});

export type MemberResult = { ok: true; membershipId: string } | { ok: false; reason: string };

function invalidReason(error: z.ZodError): string {
  const field = error.issues[0]?.path.join(".") ?? "";
  switch (field) {
    case "role":
      return "Role must be developer, lead, client or admin.";
    case "userId":
      return "Pick a person to add to the project.";
    case "membershipId":
      return "That membership is missing.";
    case "projectId":
      return "That project is missing.";
    case "actor":
      return "Only a signed-in lead or admin can change project membership.";
    default:
      return "That membership change was not valid.";
  }
}

export async function addMember(input: {
  projectId: string;
  userId: string;
  role: string;
  actor: MemberActor;
}): Promise<MemberResult> {
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: invalidReason(parsed.error) };

  const { projectId, userId, role, actor } = parsed.data;
  if (!canAdminister(actor.role)) {
    return { ok: false, reason: "Only a lead or admin can change project membership." };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, key: true },
  });
  if (!project) return { ok: false, reason: "That project no longer exists." };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
  if (!user) return { ok: false, reason: "That person is not in the directory." };

  const existing = await prisma.membership.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { id: true, role: true },
  });
  if (existing) {
    return {
      ok: false,
      reason: `${user.name} is already a ${existing.role.toLowerCase()} on ${project.key}.`,
    };
  }

  const membership = await prisma.membership.create({
    data: { projectId, userId, role },
    select: { id: true },
  });

  await prisma.event.create({
    data: {
      projectId,
      kind: "STATUS_REPORTED",
      actor: actor.name,
      summary: `added ${user.name} to ${project.key} as ${role.toLowerCase()}`,
    },
  });

  return { ok: true, membershipId: membership.id };
}

export async function removeMember(input: {
  projectId: string;
  membershipId: string;
  actor: MemberActor;
}): Promise<MemberResult> {
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: invalidReason(parsed.error) };

  const { projectId, membershipId, actor } = parsed.data;
  if (!canAdminister(actor.role)) {
    return { ok: false, reason: "Only a lead or admin can change project membership." };
  }

  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: {
      user: { select: { id: true, name: true } },
      project: { select: { id: true, key: true } },
    },
  });
  if (!membership) return { ok: false, reason: "That membership no longer exists." };
  if (membership.projectId !== projectId) {
    return { ok: false, reason: "That membership belongs to another project." };
  }

  await prisma.membership.delete({ where: { id: membershipId } });

  await prisma.event.create({
    data: {
      projectId: membership.projectId,
      kind: "STATUS_REPORTED",
      actor: actor.name,
      summary: `removed ${membership.user.name} from ${membership.project.key}`,
    },
  });

  return { ok: true, membershipId };
}
