"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@stack/db";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { transitionIssue } from "@/lib/issues";
import { generateWebhookSecret } from "@/lib/github";
import { isGithubRepoUrl, normaliseBaseUrl } from "@/lib/github-url";

const registerProjectSchema = z.object({
  key: z.string().min(1, "Project key is required."),
  name: z.string().min(1, "Project name is required."),
  client: z.string().min(1, "Client is required."),
  summary: z.string().default(""),
  repoUrl: z.string().default(""),
  provider: z.string().default(""),
  webhookBaseUrl: z.string().default(""),
  handlePattern: z.string().default("STACK-[0-9]+"),
  gatewayUrl: z.string().default(""),
  budgetUsd: z.string().default("250"),
  defaultBranch: z.string().default("main"),
});

export async function registerProject(formData: FormData) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) {
    throw new Error("Only a lead or admin can register a project.");
  }

  // FormData carries null for absent fields; normalise once so the schema sees strings.
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };

  const parsed = registerProjectSchema.safeParse({
    key: text("key"),
    name: text("name"),
    client: text("client"),
    summary: text("summary"),
    repoUrl: text("repoUrl"),
    provider: text("provider"),
    webhookBaseUrl: text("webhookBaseUrl"),
    handlePattern: text("handlePattern") || "STACK-[0-9]+",
    gatewayUrl: text("gatewayUrl"),
    budgetUsd: text("budgetUsd") || "250",
    defaultBranch: text("defaultBranch") || "main",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "That project was not valid.");
  }

  const input = parsed.data;
  const key = input.key.toUpperCase();
  const repoUrl = input.repoUrl;
  const handlePattern = input.handlePattern || "STACK-[0-9]+";
  const budget = Number(input.budgetUsd);
  const budgetUsd = Number.isFinite(budget) ? budget : 250;
  const defaultBranch = input.defaultBranch || "main";

  // A github.com remote goes through the GitHub App wizard: provider "github",
  // a generated per-repo webhook secret, and the public base URL the tunnel serves.
  // Any other remote keeps the previous default of provider "github".
  const githubRepo = isGithubRepoUrl(repoUrl);
  const provider = githubRepo ? "github" : input.provider || "github";

  let webhookBaseUrl: string | null = null;
  if (githubRepo && input.webhookBaseUrl) {
    webhookBaseUrl = normaliseBaseUrl(input.webhookBaseUrl);
    if (!webhookBaseUrl) {
      throw new Error(
        "The public webhook base URL must be a full URL, e.g. https://xxxx.ngrok.app.",
      );
    }
  }

  const existing = await prisma.project.findUnique({ where: { key } });
  if (existing) throw new Error(`Project key ${key} is already registered.`);

  const repoName = repoUrl
    ? repoUrl
        .replace(/^git@[^:]+:/, "")
        .replace(/^https?:\/\/[^/]+\//, "")
        .replace(/\.git$/, "")
    : "";

  const webhookSecret = githubRepo ? generateWebhookSecret() : null;

  const project = await prisma.project.create({
    data: {
      key,
      name: input.name,
      client: input.client,
      summary: input.summary || `${input.name} for ${input.client}.`,
      handlePattern,
      gatewayUrl: input.gatewayUrl || "http://localhost:4200/api/gateway",
      budgetUsd,
      webhookBaseUrl,
      memberships: { create: { userId: user.id, role: user.role === "ADMIN" ? "ADMIN" : "LEAD" } },
      ...(repoName
        ? {
            repos: {
              create: {
                name: repoName,
                provider,
                remotePath: repoUrl,
                defaultBranch,
                webhookSecret,
              },
            },
          }
        : {}),
    },
  });

  await prisma.event.create({
    data: {
      projectId: project.id,
      kind: "STATUS_REPORTED",
      actor: user.name,
      summary: `project ${project.key} registered${repoName ? ` with repository ${repoName}` : ""}`,
    },
  });

  revalidatePath("/projects");
  redirect(githubRepo ? `/projects/${project.key}/github-setup` : `/projects/${project.key}`);
}

/** Approval is a human decision: BACKLOG to APPROVED is never available to a token. */
export async function approveIssue(formData: FormData) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) throw new Error("Only a lead or admin can approve an item.");

  const handle = String(formData.get("handle") ?? "");
  const projectKey = String(formData.get("projectKey") ?? "");
  const assigneeId = String(formData.get("assigneeId") ?? "");

  const result = await transitionIssue({
    handle,
    to: "APPROVED",
    actor: user.name,
    humanDriven: true,
    note: "approved in the portal",
  });
  if (!result.ok) throw new Error(result.reason ?? "Could not approve this item.");

  if (assigneeId) {
    await prisma.issue.update({
      where: { handle: handle.toUpperCase() },
      data: { assigneeId },
    });
  }

  revalidatePath(`/projects/${projectKey}/issues/${handle}`);
  revalidatePath(`/projects/${projectKey}/issues`);
}

/** Validation is the only route to Done, and it requires a person. */
export async function validateIssue(formData: FormData) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) throw new Error("Only a lead or admin can validate an item.");

  const handle = String(formData.get("handle") ?? "");
  const projectKey = String(formData.get("projectKey") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const result = await transitionIssue({
    handle,
    to: "DONE",
    actor: user.name,
    humanDriven: true,
    note: note || "validated in the portal",
    eventKind: "VALIDATED",
  });
  if (!result.ok) throw new Error(result.reason ?? "Could not validate this item.");

  await prisma.approval.create({
    data: {
      projectId: result.issue!.projectId,
      subjectType: "ISSUE",
      subjectId: result.issue!.id,
      approverId: user.id,
      decision: "APPROVED",
      note: note || null,
    },
  });

  revalidatePath(`/projects/${projectKey}/issues/${handle}`);
  revalidatePath(`/projects/${projectKey}/issues`);
  revalidatePath("/dashboard");
}

export async function sendBackIssue(formData: FormData) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) throw new Error("Only a lead or admin can send work back.");

  const handle = String(formData.get("handle") ?? "");
  const projectKey = String(formData.get("projectKey") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const result = await transitionIssue({
    handle,
    to: "IN_PROGRESS",
    actor: user.name,
    humanDriven: true,
    note: note || "sent back after validation review",
  });
  if (!result.ok) throw new Error(result.reason ?? "Could not send this item back.");

  revalidatePath(`/projects/${projectKey}/issues/${handle}`);
  revalidatePath(`/projects/${projectKey}/issues`);
}
