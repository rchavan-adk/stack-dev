import { revalidatePath } from "next/cache";
import { prisma } from "@stack/db";

const GITHUB_EXCHANGE = "https://api.github.com/app-manifests";

function bad(error: string, guidance: string, status: number) {
  return Response.json({ error, guidance }, { status });
}

/** GitHub posts { code } — JSON, form-encoded, or on the query string. */
async function readCode(request: Request, url: URL): Promise<string> {
  const fromQuery = url.searchParams.get("code");
  if (fromQuery) return fromQuery.trim();

  const contentType = request.headers.get("content-type") ?? "";
  const raw = await request.text();
  if (!raw) return "";

  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(raw) as { code?: unknown };
      return typeof body.code === "string" ? body.code.trim() : "";
    } catch {
      return "";
    }
  }
  // GitHub's manifest redirect posts application/x-www-form-urlencoded.
  return new URLSearchParams(raw).get("code")?.trim() ?? "";
}

/**
 * The second half of the manifest flow. GitHub redirects here with a temporary
 * `code`; exchanging it for an access token is how the portal learns the App ID
 * and the webhook secret GitHub generated. No auth header: the code is the proof.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const key = (url.searchParams.get("project") ?? "").trim().toUpperCase();
  if (!key) {
    return bad(
      "project is required",
      "GitHub is redirected to /api/github/app-callback?project=<PROJECT KEY>.",
      400,
    );
  }

  const project = await prisma.project.findUnique({
    where: { key },
    include: { repos: { orderBy: { name: "asc" } } },
  });
  if (!project) {
    return bad(`Unknown project ${key}`, "Register the project in the portal first.", 404);
  }

  const repo = project.repos.find((candidate) => candidate.provider === "github");
  if (!repo) {
    return bad(
      `No GitHub repository is linked to ${project.key}`,
      "Link a github-provider repository before creating the app.",
      404,
    );
  }

  let code = "";
  try {
    code = await readCode(request, url);
  } catch {
    code = "";
  }
  if (!code) {
    return bad(
      "Missing code",
      "GitHub sends a temporary code in the request body; this request carried none.",
      400,
    );
  }

  let exchange: Response;
  try {
    exchange = await fetch(`${GITHUB_EXCHANGE}/${encodeURIComponent(code)}/access_tokens`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error("github manifest exchange failed", error);
    return bad(
      "Could not reach GitHub",
      "The portal could not call api.github.com. Check outbound network access and try the paste-back App ID form instead.",
      502,
    );
  }

  if (!exchange.ok) {
    const detail = await exchange.text().catch(() => "");
    console.error("github manifest exchange rejected", exchange.status, detail);
    return bad(
      `GitHub rejected the manifest code (${exchange.status})`,
      "The code is single-use and expires quickly. Start the app creation again from the setup page, or paste the App ID by hand.",
      502,
    );
  }

  let payload: { id?: unknown; webhook_secret?: unknown };
  try {
    payload = (await exchange.json()) as { id?: unknown; webhook_secret?: unknown };
  } catch {
    return bad(
      "GitHub returned an unreadable response",
      "Retry the app creation, or paste the App ID by hand.",
      502,
    );
  }

  const appId = payload.id === undefined || payload.id === null ? "" : String(payload.id);
  if (!appId) {
    return bad(
      "GitHub did not return an App ID",
      "Paste the App ID from the app settings page by hand.",
      502,
    );
  }

  const webhookSecret =
    typeof payload.webhook_secret === "string" && payload.webhook_secret.length > 0
      ? payload.webhook_secret
      : null;

  await prisma.repo.update({
    where: { id: repo.id },
    data: {
      githubAppId: appId,
      ...(webhookSecret ? { webhookSecret } : {}),
    },
  });

  await prisma.event.create({
    data: {
      projectId: project.id,
      kind: "STATUS_REPORTED",
      actor: "github-app",
      summary: `GitHub App #${appId} connected to ${repo.name}`,
    },
  });

  revalidatePath(`/projects/${project.key}/github-setup`);
  revalidatePath(`/projects/${project.key}`);

  return Response.json({
    ok: true,
    project: project.key,
    repo: repo.name,
    appId,
    webhookSecretUpdated: Boolean(webhookSecret),
  });
}
