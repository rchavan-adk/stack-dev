import type { IssueStatus } from "@stack/core";
import { prisma } from "@stack/db";
import {
  extractHandles,
  handlePattern,
  matchGithubRepo,
  moveIssueThroughPath,
  recordCommitEvents,
  stampIssue,
  verifyGithubSignature,
} from "@/lib/github";

interface GithubPushPayload {
  ref?: string;
  after?: string;
  repository?: { full_name?: string };
  commits?: Array<{
    id?: string;
    message?: string;
    author?: { name?: string; username?: string };
  }>;
}

interface GithubPullRequestPayload {
  action?: string;
  number?: number;
  repository?: { full_name?: string };
  pull_request?: {
    number?: number;
    merged?: boolean;
    title?: string;
    body?: string;
    head?: { ref?: string };
    base?: { ref?: string };
  };
}

const ok = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

/**
 * GitHub App deliveries for a single repository. The secret is per repository
 * (unlike the Actions-style /api/git/events route), so the body has to be read
 * raw before the HMAC can be checked, and the repository is identified from the
 * payload before the secret is known.
 */
export async function POST(request: Request) {
  const raw = await request.text();

  let payload: GithubPushPayload & GithubPullRequestPayload;
  try {
    payload = JSON.parse(raw) as GithubPushPayload & GithubPullRequestPayload;
  } catch {
    return ok({ error: "Body must be JSON" }, 400);
  }

  const fullName = payload.repository?.full_name ?? "";
  if (!fullName) {
    return ok({ error: "repository.full_name is required" }, 400);
  }

  const repo = await matchGithubRepo(fullName);
  if (!repo) {
    return ok({ error: `No registered repository matches ${fullName}`, moved: [] }, 404);
  }

  if (!repo.webhookSecret) {
    return ok(
      {
        error: `Repository ${repo.name} has no webhook secret; deliveries cannot be verified.`,
        moved: [],
      },
      401,
    );
  }

  if (!verifyGithubSignature(raw, request.headers.get("x-hub-signature-256"), repo.webhookSecret)) {
    return ok({ error: "Invalid webhook signature", moved: [] }, 401);
  }

  const event = request.headers.get("x-github-event") ?? "";
  if (!event) return ok({ error: "X-GitHub-Event header is required" }, 400);

  // A ping is GitHub saying hello after the app is installed; nothing to record.
  if (event === "ping") {
    return ok({ ok: true, event: "ping", project: repo.project.key, repo: repo.name, moved: [] });
  }

  if (event === "push") {
    const branch = (payload.ref ?? "").replace(/^refs\/heads\//, "");
    if (!payload.ref || !branch || payload.ref.startsWith("refs/tags/")) {
      return ok({ ok: true, event: "push", ignored: "not a branch ref", moved: [] });
    }

    const commits = payload.commits ?? [];
    const { handles, unlinked } = await recordCommitEvents({
      projectId: repo.project.id,
      branch,
      commits,
    });

    const isDefaultBranch = branch === repo.defaultBranch;
    const moved: Array<{ handle: string; from: string; to: string }> = [];

    // A push to a feature branch is what puts a card into review; a push to the
    // default branch is a merge, which the pull_request path owns.
    if (!isDefaultBranch) {
      for (const handle of handles) {
        moved.push(
          ...(await moveIssueThroughPath({
            handle,
            projectId: repo.project.id,
            path: ["IN_REVIEW" as IssueStatus],
            actor: "github-app",
            note: `pushed to ${branch}`,
            eventKind: () => "PR_OPENED",
          })),
        );
        await stampIssue({ handle, projectId: repo.project.id, branch });
      }
    }

    return ok({
      ok: true,
      event: "push",
      project: repo.project.key,
      repo: repo.name,
      branch,
      commits: commits.length,
      unlinkedCommits: unlinked,
      moved,
      signatureChecked: true,
    });
  }

  if (event === "pull_request") {
    const pr = payload.pull_request ?? {};
    const action = payload.action ?? "";
    const prNumber = typeof pr.number === "number" ? pr.number : payload.number;
    const headRef = pr.head?.ref ?? "";
    const pattern = handlePattern(repo.project);

    // The same approach as the existing route: read the handle out of the text a
    // developer controls — here the branch name and the pull request title.
    const handles = extractHandles(pattern, headRef, pr.title ?? "");

    if (action !== "opened" && !(action === "closed" && pr.merged === true)) {
      return ok({
        ok: true,
        event: "pull_request",
        action,
        project: repo.project.key,
        repo: repo.name,
        moved: [],
        ignored: "action does not move work",
      });
    }

    const merged = action === "closed" && pr.merged === true;
    const moved: Array<{ handle: string; from: string; to: string }> = [];

    for (const handle of handles) {
      moved.push(
        ...(await moveIssueThroughPath({
          handle,
          projectId: repo.project.id,
          path: merged
            ? (["IN_REVIEW", "AWAITING_VALIDATION"] as IssueStatus[])
            : (["IN_REVIEW"] as IssueStatus[]),
          actor: "github-app",
          note: merged
            ? `PR #${prNumber ?? "?"} merged to ${pr.base?.ref ?? repo.defaultBranch}`
            : `PR #${prNumber ?? "?"} opened`,
          eventKind: (step) =>
            merged && step === "AWAITING_VALIDATION" ? "PR_MERGED" : "PR_OPENED",
        })),
      );
      await stampIssue({
        handle,
        projectId: repo.project.id,
        ...(prNumber ? { prNumber } : {}),
        ...(headRef ? { branch: headRef } : {}),
      });
    }

    return ok({
      ok: true,
      event: "pull_request",
      action,
      project: repo.project.key,
      repo: repo.name,
      prNumber: prNumber ?? null,
      merged,
      handles,
      moved,
      signatureChecked: true,
    });
  }

  return ok({ ok: true, event, ignored: "event is not handled", moved: [] });
}
