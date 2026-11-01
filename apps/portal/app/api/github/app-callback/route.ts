import { revalidatePath } from "next/cache";
import { prisma } from "@stack/db";
import { portalUrl } from "@/lib/urls";

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

interface ExchangeFailure {
  ok: false;
  error: string;
  guidance: string;
  status: number;
}

interface ExchangeSuccess {
  ok: true;
  projectKey: string;
  repoName: string;
  appId: string;
  webhookSecretUpdated: boolean;
}

/**
 * The second half of the manifest flow. GitHub hands over a temporary `code`;
 * exchanging it is how the portal learns the App ID and the webhook secret
 * GitHub generated. No auth header: the single-use code is the proof.
 */
async function completeManifestFlow(
  key: string,
  code: string,
): Promise<ExchangeSuccess | ExchangeFailure> {
  if (!key) {
    return {
      ok: false,
      error: "project is required",
      guidance: "GitHub is redirected to /api/github/app-callback?project=<PROJECT KEY>.",
      status: 400,
    };
  }

  const project = await prisma.project.findUnique({
    where: { key },
    include: { repos: { orderBy: { name: "asc" } } },
  });
  if (!project) {
    return {
      ok: false,
      error: `Unknown project ${key}`,
      guidance: "Register the project in the portal first.",
      status: 404,
    };
  }

  const repo = project.repos.find((candidate) => candidate.provider === "github");
  if (!repo) {
    return {
      ok: false,
      error: `No GitHub repository is linked to ${project.key}`,
      guidance: "Link a github-provider repository before creating the app.",
      status: 404,
    };
  }

  if (!code) {
    return {
      ok: false,
      error: "Missing code",
      guidance: "GitHub sends a temporary code with the redirect; this request carried none.",
      status: 400,
    };
  }

  let exchange: Response;
  try {
    exchange = await fetch(`${GITHUB_EXCHANGE}/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error("github manifest exchange failed", error);
    return {
      ok: false,
      error: "Could not reach GitHub",
      guidance:
        "The portal could not call api.github.com. Check outbound network access and use the paste-back App ID form instead.",
      status: 502,
    };
  }

  if (!exchange.ok) {
    const detail = await exchange.text().catch(() => "");
    console.error("github manifest exchange rejected", exchange.status, detail);
    return {
      ok: false,
      error: `GitHub rejected the manifest code (${exchange.status})`,
      guidance:
        "The code is single-use and expires within an hour. Start the app creation again from the setup page, or paste the App ID by hand.",
      status: 502,
    };
  }

  let payload: { id?: unknown; webhook_secret?: unknown };
  try {
    payload = (await exchange.json()) as { id?: unknown; webhook_secret?: unknown };
  } catch {
    return {
      ok: false,
      error: "GitHub returned an unreadable response",
      guidance: "Retry the app creation, or paste the App ID by hand.",
      status: 502,
    };
  }

  const appId = payload.id === undefined || payload.id === null ? "" : String(payload.id);
  if (!appId) {
    return {
      ok: false,
      error: "GitHub did not return an App ID",
      guidance: "Paste the App ID from the app settings page by hand.",
      status: 502,
    };
  }

  // GitHub mints its own webhook secret for a manifest app, which replaces the
  // one generated at registration. Deliveries are signed with this one.
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

  return {
    ok: true,
    projectKey: project.key,
    repoName: repo.name,
    appId,
    webhookSecretUpdated: Boolean(webhookSecret),
  };
}

/**
 * The manifest flow redirects a browser here, so the answer has to be a
 * redirect back to the wizard rather than JSON a person would have to read.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = (url.searchParams.get("project") ?? "").trim().toUpperCase();
  const code = (url.searchParams.get("code") ?? "").trim();

  const result = await completeManifestFlow(key, code);
  const back = key ? `/projects/${key}/github-setup` : "/projects";

  if (!result.ok) {
    return Response.redirect(
      portalUrl(`${back}?error=${encodeURIComponent(`${result.error}. ${result.guidance}`)}`),
      303,
    );
  }
  return Response.redirect(portalUrl(`${back}?saved=app`), 303);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const key = (url.searchParams.get("project") ?? "").trim().toUpperCase();

  let code = "";
  try {
    code = await readCode(request, url);
  } catch {
    code = "";
  }

  const result = await completeManifestFlow(key, code);
  if (!result.ok) return bad(result.error, result.guidance, result.status);

  return Response.json({
    ok: true,
    project: result.projectKey,
    repo: result.repoName,
    appId: result.appId,
    webhookSecretUpdated: result.webhookSecretUpdated,
  });
}
