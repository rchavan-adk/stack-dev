import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@stack/db";
import type { IssueStatus } from "@stack/core";
import { transitionIssue } from "@/lib/issues";

interface GitCommit {
  sha: string;
  message: string;
  author?: string;
}

interface GitEventBody {
  repo?: string;
  branch?: string;
  action?: "push" | "merge";
  prNumber?: number | null;
  commits?: GitCommit[];
}

function normaliseRepo(value: string): string {
  return value
    .trim()
    .replace(/^git@([^:]+):/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/\.git$/, "")
    .toLowerCase();
}

/** Signature check, same shape GitHub Actions produces with openssl dgst. */
function signatureValid(raw: string, header: string | null): boolean {
  const secret = process.env.STACK_WEBHOOK_SECRET;
  if (!secret) return true; // mock mode: no secret configured, accept and flag in the response
  if (!header) return false;

  const provided = header.replace(/^sha256=/, "");
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The only way a card moves forward: evidence from git. The portal never trusts a
 * claim of progress, and it never receives code, only event metadata.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!signatureValid(raw, request.headers.get("x-stack-signature"))) {
    return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let body: GitEventBody;
  try {
    body = JSON.parse(raw) as GitEventBody;
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!body.repo) return Response.json({ error: "repo is required" }, { status: 400 });

  const repos = await prisma.repo.findMany({ include: { project: true } });
  const incoming = normaliseRepo(body.repo);
  const incomingBasename = incoming.split("/").pop() ?? incoming;
  const repo = repos.find((candidate) => {
    const registered = normaliseRepo(candidate.remotePath || candidate.name);
    return (
      registered === incoming ||
      normaliseRepo(candidate.name) === incoming ||
      registered.endsWith(`/${incomingBasename}`)
    );
  });

  if (!repo) {
    return Response.json(
      { error: `No registered repository matches ${body.repo}`, moved: [] },
      { status: 404 },
    );
  }

  const project = repo.project;
  const pattern = new RegExp(project.handlePattern, "g");
  const commits = body.commits ?? [];
  const branch = body.branch ?? repo.defaultBranch;
  const isDefaultBranch = branch === repo.defaultBranch;
  const action = body.action ?? (isDefaultBranch ? "merge" : "push");

  const handles = new Set<string>();
  const unlinked: string[] = [];

  for (const commit of commits) {
    const matches = String(commit.message ?? "").match(pattern) ?? [];
    if (matches.length === 0) {
      unlinked.push(commit.sha?.slice(0, 8) ?? "unknown");
      continue;
    }
    for (const handle of matches) handles.add(handle.toUpperCase());

    const [primaryHandle] = matches;
    if (!primaryHandle) continue;
    const issue = await prisma.issue.findUnique({ where: { handle: primaryHandle.toUpperCase() } });
    await prisma.event.create({
      data: {
        projectId: project.id,
        issueId: issue?.id ?? null,
        kind: "COMMIT",
        actor: commit.author ?? "github",
        summary: `${commit.sha?.slice(0, 8) ?? ""} ${String(commit.message).split("\n")[0]}`.trim(),
        payload: JSON.stringify({ sha: commit.sha, branch }),
      },
    });
  }

  const moved: Array<{ handle: string; from: string; to: string }> = [];

  for (const handle of handles) {
    const issue = await prisma.issue.findUnique({ where: { handle } });
    if (!issue || issue.projectId !== project.id) continue;

    const from = issue.status as IssueStatus;
    const target: IssueStatus = action === "merge" ? "AWAITING_VALIDATION" : "IN_REVIEW";

    // A merge may arrive while the card is still in progress; walk it through review.
    const path: IssueStatus[] =
      target === "AWAITING_VALIDATION" && from === "IN_PROGRESS"
        ? ["IN_REVIEW", "AWAITING_VALIDATION"]
        : [target];

    let current = from;
    for (const step of path) {
      const result = await transitionIssue({
        handle,
        to: step,
        actor: "github-app",
        note: action === "merge" ? `merged to ${branch}` : `pushed to ${branch}`,
        humanDriven: false,
        eventKind: action === "merge" && step === "AWAITING_VALIDATION" ? "PR_MERGED" : "PR_OPENED",
      });
      if (result.ok && result.issue) {
        moved.push({ handle, from: current, to: step });
        current = step;
      }
    }

    await prisma.issue.update({
      where: { id: issue.id },
      data: {
        branch: isDefaultBranch ? issue.branch : branch,
        prNumber: body.prNumber ?? issue.prNumber,
      },
    });
  }

  return Response.json({
    ok: true,
    project: project.key,
    repo: repo.name,
    action,
    branch,
    commits: commits.length,
    unlinkedCommits: unlinked,
    moved,
    signatureChecked: Boolean(process.env.STACK_WEBHOOK_SECRET),
  });
}
