"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@stack/db";
import { canAdminister, requireSessionUser } from "@/lib/session";

const PROJECT_STATUSES = ["ACTIVE", "PAUSED", "CLOSED"];
const REPO_PROVIDERS = ["mock-github", "github"];
const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/;

function backTo(projectKey: string): string {
  return `/admin/settings?project=${encodeURIComponent(projectKey)}`;
}

function fail(projectKey: string, message: string): never {
  redirect(`${backTo(projectKey)}&error=${encodeURIComponent(message)}`);
}

export async function saveDelivery(projectId: string, formData: FormData): Promise<void> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) redirect("/admin/settings");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { key: true },
  });
  if (!project) fail("ACME", "That project no longer exists.");

  const handlePattern = String(formData.get("handlePattern") ?? "").trim();
  const gatewayUrl = String(formData.get("gatewayUrl") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  const budgetUsd = Number(String(formData.get("budgetUsd") ?? "").trim());

  if (!handlePattern || !gatewayUrl) {
    fail(project.key, "Handle pattern and gateway URL are required.");
  }
  try {
    new RegExp(handlePattern);
  } catch {
    fail(project.key, `“${handlePattern}” is not a valid regular expression.`);
  }
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    fail(project.key, "Budget must be a number in USD (0 or more).");
  }
  if (!PROJECT_STATUSES.includes(status)) {
    fail(project.key, "Project status must be active, paused or closed.");
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { handlePattern, gatewayUrl, budgetUsd, status },
  });
  revalidatePath("/admin/settings");
  redirect(`${backTo(project.key)}&saved=delivery`);
}

function validateRepoFields(
  provider: string,
  name: string,
  remotePath: string,
  projectKey: string,
): { ok: true; name: string; remotePath: string } {
  if (!REPO_PROVIDERS.includes(provider)) {
    fail(projectKey, "Provider must be mock-github or github.");
  }
  if (!name.trim()) fail(projectKey, "Repository name is required.");
  if (!remotePath.trim()) fail(projectKey, "Remote path is required.");
  if (provider === "github" && !GITHUB_URL_RE.test(remotePath.trim())) {
    fail(projectKey, `A GitHub repo needs its clone URL, e.g. https://github.com/owner/repo.git`);
  }
  return { ok: true, name: name.trim(), remotePath: remotePath.trim() };
}

export async function saveRepo(repoId: string, formData: FormData): Promise<void> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) redirect("/admin/settings");

  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    include: { project: { select: { key: true, id: true } } },
  });
  if (!repo) fail("ACME", "That repository link no longer exists.");

  const provider = String(formData.get("provider") ?? "mock-github");
  const defaultBranch = String(formData.get("defaultBranch") ?? "").trim() || "main";
  const fields = validateRepoFields(
    provider,
    String(formData.get("name") ?? ""),
    String(formData.get("remotePath") ?? ""),
    repo.project.key,
  );

  await prisma.repo.update({
    where: { id: repoId },
    data: {
      provider,
      name: fields.name,
      remotePath: fields.remotePath,
      defaultBranch,
    },
  });
  revalidatePath("/admin/settings");
  redirect(`${backTo(repo.project.key)}&saved=repo`);
}

export async function linkRepo(projectId: string, formData: FormData): Promise<void> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) redirect("/admin/settings");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { key: true },
  });
  if (!project) fail("ACME", "That project no longer exists.");

  const provider = String(formData.get("provider") ?? "mock-github");
  const fields = validateRepoFields(
    provider,
    String(formData.get("name") ?? ""),
    String(formData.get("remotePath") ?? ""),
    project.key,
  );
  const defaultBranch = String(formData.get("defaultBranch") ?? "").trim() || "main";

  const clash = await prisma.repo.findUnique({
    where: { projectId_name: { projectId, name: fields.name } },
    select: { id: true },
  });
  if (clash) {
    fail(project.key, `A repository called “${fields.name}” is already linked to this project.`);
  }

  await prisma.repo.create({
    data: {
      projectId,
      provider,
      name: fields.name,
      remotePath: fields.remotePath,
      defaultBranch,
    },
  });
  revalidatePath("/admin/settings");
  redirect(`${backTo(project.key)}&saved=repo`);
}
