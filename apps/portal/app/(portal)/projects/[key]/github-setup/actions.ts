"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@stack/db";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { generateWebhookSecret } from "@/lib/github";

const appIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,20}$/, "A GitHub App ID is the number GitHub shows on the app page.");

function backTo(projectKey: string, query: string): string {
  return `/projects/${projectKey}/github-setup?${query}`;
}

/**
 * The paste-back half of the manifest flow: a lead copies the App ID GitHub
 * assigned onto the repository row. Re-checked server-side like every mutation.
 */
export async function saveGithubAppId(
  repoId: string,
  projectKey: string,
  formData: FormData,
): Promise<void> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) {
    redirect(backTo(projectKey, `error=${encodeURIComponent("Setup needs lead or admin rights.")}`));
  }

  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    include: { project: { select: { key: true } } },
  });
  if (!repo) {
    redirect(backTo(projectKey, `error=${encodeURIComponent("That repository is no longer linked.")}`));
  }

  const raw = String(formData.get("githubAppId") ?? "").trim();
  const parsed = appIdSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(backTo(projectKey, `error=${encodeURIComponent(parsed.error.issues[0].message)}`));
  }

  await prisma.repo.update({
    where: { id: repoId },
    data: { githubAppId: parsed.data },
  });

  await prisma.event.create({
    data: {
      projectId: repo.projectId,
      kind: "STATUS_REPORTED",
      actor: user.name,
      summary: `GitHub App #${parsed.data} connected to ${repo.name}`,
    },
  });

  revalidatePath(`/projects/${projectKey}/github-setup`);
  revalidatePath(`/projects/${projectKey}`);
  redirect(backTo(projectKey, "saved=app"));
}

/**
 * Mints the per-repository webhook secret a lead needs before GitHub can sign
 * deliveries. Refuses to clobber an existing secret — rotation belongs to the
 * project settings, not this wizard.
 */
export async function generateWebhookSecretAction(
  repoId: string,
  projectKey: string,
  _formData: FormData,
): Promise<void> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) {
    redirect(backTo(projectKey, `error=${encodeURIComponent("Setup needs lead or admin rights.")}`));
  }

  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    include: { project: { select: { key: true } } },
  });
  if (!repo) {
    redirect(backTo(projectKey, `error=${encodeURIComponent("That repository is no longer linked.")}`));
  }
  if (repo.provider !== "github") {
    redirect(
      backTo(projectKey, `error=${encodeURIComponent("Only GitHub repositories need a webhook secret.")}`),
    );
  }
  if (repo.webhookSecret) {
    redirect(
      backTo(projectKey, `error=${encodeURIComponent("This repository already has a webhook secret.")}`),
    );
  }

  const secret = generateWebhookSecret();
  await prisma.repo.update({ where: { id: repoId }, data: { webhookSecret: secret } });

  await prisma.event.create({
    data: {
      projectId: repo.projectId,
      kind: "STATUS_REPORTED",
      actor: user.name,
      summary: `Webhook secret generated for ${repo.name}`,
    },
  });

  revalidatePath(`/projects/${projectKey}/github-setup`);
  revalidatePath(`/projects/${projectKey}`);
  redirect(backTo(projectKey, "saved=secret"));
}
