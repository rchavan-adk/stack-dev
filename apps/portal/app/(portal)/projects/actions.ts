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
    defaultBranch: text("defaultBranch") || "main",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "That project was not valid.");
  }

  const input = parsed.data;
  const key = input.key.toUpperCase();
  const repoUrl = input.repoUrl;
  const handlePattern = input.handlePattern || "STACK-[0-9]+";
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
    // An item can only be owned by someone on the engagement.
    const membership = await prisma.membership.findFirst({
      where: { projectId: result.issue!.projectId, userId: assigneeId },
    });
    if (!membership) throw new Error("That person is not a member of this project.");
    await prisma.issue.update({
      where: { handle: handle.toUpperCase() },
      data: { assigneeId },
    });
  }

  revalidatePath(`/projects/${projectKey}/issues/${handle}`);
  revalidatePath(`/projects/${projectKey}/issues`);
}

/**
 * Ownership can change after approval: people leave, waves get rebalanced.
 * The assignee was only settable in the approve form, which meant a wrong
 * owner was permanent. The change is evidence like any other.
 */
export async function assignIssue(formData: FormData) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) throw new Error("Only a lead or admin can reassign an item.");

  const handle = String(formData.get("handle") ?? "").toUpperCase();
  const projectKey = String(formData.get("projectKey") ?? "");
  const assigneeId = String(formData.get("assigneeId") ?? "");

  const issue = await prisma.issue.findUnique({
    where: { handle },
    include: { assignee: { select: { name: true } } },
  });
  if (!issue) throw new Error(`Unknown item ${handle}.`);

  let assignee: { id: string; name: string } | null = null;
  if (assigneeId) {
    const membership = await prisma.membership.findFirst({
      where: { projectId: issue.projectId, userId: assigneeId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!membership) {
      throw new Error("That person is not a member of this project.");
    }
    assignee = membership.user;
  }

  if ((issue.assigneeId ?? "") === assigneeId) return;

  await prisma.issue.update({
    where: { id: issue.id },
    data: { assigneeId: assignee?.id ?? null },
  });

  const was = issue.assignee?.name ?? "nobody";
  await prisma.event.create({
    data: {
      projectId: issue.projectId,
      issueId: issue.id,
      kind: "STATUS_REPORTED",
      actor: user.name,
      summary: `${issue.handle} reassigned from ${was} to ${assignee?.name ?? "nobody"}`,
    },
  });

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
