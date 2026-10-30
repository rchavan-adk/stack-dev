import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@stack/db";
import type { IssueStatus } from "@stack/core";
import { transitionIssue } from "@/lib/issues";
import { githubFullNameFromRemote } from "@/lib/github-url";

/**
 * GitHub App plumbing. Everything that knows how to verify a GitHub delivery,
 * build the App manifest, or walk an item through review lives here so the
 * webhook route, the manifest route and the setup page agree by construction.
 * The pre-existing /api/git/events route (Actions-style, one shared secret) is
 * deliberately untouched.
 */

/** 32 random bytes, hex — the per-repo webhook secret GitHub signs deliveries with. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(rawBody, secret), timing-safe. */
export function verifyGithubSignature(
  raw: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header) return false;
  const provided = header.trim().replace(/^sha256=/i, "");
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface GithubAppManifest {
  name: string;
  url: string;
  description: string;
  redirect_url: string;
  hook_attributes: {
    url: string;
    active: boolean;
    content_type: "json";
    secret: string;
    insecure_ssl: "0";
  };
  callback_urls: string[];
  setup_url: string;
  default_events: string[];
  default_permissions: Record<string, string>;
  public: false;
}

export function githubWebhookUrl(webhookBaseUrl: string): string {
  return `${webhookBaseUrl}/api/git/webhooks/github`;
}

export function githubManifestUrl(webhookBaseUrl: string, projectKey: string): string {
  return `${webhookBaseUrl}/api/github/manifest?project=${projectKey.toUpperCase()}`;
}

export function githubAppNewUrl(webhookBaseUrl: string, projectKey: string): string {
  return `https://github.com/apps/new?manifest=${encodeURIComponent(
    githubManifestUrl(webhookBaseUrl, projectKey),
  )}`;
}

export function buildAppManifest(input: {
  projectKey: string;
  webhookBaseUrl: string;
  webhookSecret: string;
}): GithubAppManifest {
  const key = input.projectKey.toUpperCase();
  return {
    name: `Stack AI – ${key}`,
    url: input.webhookBaseUrl,
    description: "Stack AI delivery evidence: pushes and pull requests move work on this portal.",
    redirect_url: `${input.webhookBaseUrl}/projects/${key}/github-setup`,
    hook_attributes: {
      url: githubWebhookUrl(input.webhookBaseUrl),
      active: true,
      content_type: "json",
      secret: input.webhookSecret,
      insecure_ssl: "0",
    },
    callback_urls: [`${input.webhookBaseUrl}/api/github/app-callback?project=${key}`],
    setup_url: `${input.webhookBaseUrl}/projects/${key}/github-setup`,
    default_events: ["push", "pull_request"],
    default_permissions: { contents: "read", pull_requests: "read", metadata: "read" },
    public: false,
  };
}

export interface MatchedGithubRepo {
  id: string;
  name: string;
  webhookSecret: string | null;
  defaultBranch: string;
  project: { id: string; key: string; handlePattern: string };
}

/** A github-provider repo whose name or remote basename equals repository.full_name. */
export async function matchGithubRepo(fullName: string): Promise<MatchedGithubRepo | null> {
  const wanted = fullName.trim().toLowerCase();
  const repos = await prisma.repo.findMany({
    where: { provider: "github" },
    include: { project: { select: { id: true, key: true, handlePattern: true } } },
  });

  const match = repos.find((repo) => {
    const byName = repo.name.trim().toLowerCase();
    const byRemote = githubFullNameFromRemote(repo.remotePath);
    return byName === wanted || byRemote === wanted;
  });
  if (!match) return null;

  return {
    id: match.id,
    name: match.name,
    webhookSecret: match.webhookSecret,
    defaultBranch: match.defaultBranch,
    project: match.project,
  };
}

export function handlePattern(project: { handlePattern: string }): RegExp {
  return new RegExp(project.handlePattern, "g");
}

/** Handles found in free text (a commit message, a branch name, a PR title). */
export function extractHandles(pattern: RegExp, ...texts: string[]): string[] {
  const handles = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const found of String(text).match(pattern) ?? []) handles.add(found.toUpperCase());
  }
  return [...handles];
}

export interface MovedIssue {
  handle: string;
  from: string;
  to: string;
}

/**
 * Walks one item through an explicit path of statuses (evidence-driven, never
 * human-only), returning only the moves that actually happened. This is the
 * shared shape behind the push and pull_request paths.
 */
export async function moveIssueThroughPath(input: {
  handle: string;
  projectId: string;
  path: IssueStatus[];
  actor: string;
  note: string;
  eventKind: (step: IssueStatus) => string;
}): Promise<MovedIssue[]> {
  const moved: MovedIssue[] = [];
  const issue = await prisma.issue.findUnique({ where: { handle: input.handle.toUpperCase() } });
  if (!issue || issue.projectId !== input.projectId) return moved;

  let current = issue.status as IssueStatus;
  for (const step of input.path) {
    const result = await transitionIssue({
      handle: input.handle,
      to: step,
      actor: input.actor,
      note: input.note,
      humanDriven: false,
      eventKind: input.eventKind(step),
    });
    if (!result.ok) break;
    if (current !== step) {
      moved.push({ handle: input.handle.toUpperCase(), from: current, to: step });
      current = step;
    }
  }
  return moved;
}

/** Records a COMMIT event for each commit that names an item, and returns the handles. */
export async function recordCommitEvents(input: {
  projectId: string;
  branch: string;
  commits: Array<{ id?: string; message?: string; author?: { name?: string } }>;
}): Promise<{ handles: string[]; unlinked: string[] }> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { handlePattern: true },
  });
  if (!project) return { handles: [], unlinked: [] };

  const pattern = handlePattern(project);
  const handles = new Set<string>();
  const unlinked: string[] = [];

  for (const commit of input.commits) {
    const message = String(commit.message ?? "");
    const matches = extractHandles(pattern, message);
    if (matches.length === 0) {
      unlinked.push(commit.id?.slice(0, 8) ?? "unknown");
      continue;
    }
    for (const handle of matches) handles.add(handle);

    const primary = matches[0]!;
    const issue = await prisma.issue.findUnique({ where: { handle: primary } });
    await prisma.event.create({
      data: {
        projectId: input.projectId,
        issueId: issue?.id ?? null,
        kind: "COMMIT",
        actor: commit.author?.name ?? "github",
        summary: `${commit.id?.slice(0, 8) ?? ""} ${message.split("\n")[0]}`.trim(),
        payload: JSON.stringify({ sha: commit.id, branch: input.branch }),
      },
    });
  }

  return { handles: [...handles], unlinked };
}

/** Stamps the branch and/or PR number onto items the delivery named. */
export async function stampIssue(input: {
  handle: string;
  projectId: string;
  branch?: string;
  prNumber?: number;
}): Promise<void> {
  const issue = await prisma.issue.findUnique({ where: { handle: input.handle.toUpperCase() } });
  if (!issue || issue.projectId !== input.projectId) return;

  await prisma.issue.update({
    where: { id: issue.id },
    data: {
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.prNumber ? { prNumber: input.prNumber } : {}),
    },
  });
}
