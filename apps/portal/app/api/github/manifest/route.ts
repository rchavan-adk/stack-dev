import { prisma } from "@stack/db";
import { buildAppManifest, githubManifestUrl } from "@/lib/github";
import { normaliseBaseUrl } from "@/lib/github-url";

/**
 * Serves the GitHub App manifest for one project. GitHub fetches this URL when a
 * lead follows the "create the app" deep link, so it must be reachable from the
 * public tunnel — hence the explicit 400 when the base URL has not been set yet.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = (url.searchParams.get("project") ?? "").trim().toUpperCase();
  if (!key) {
    return Response.json(
      {
        error: "project is required",
        guidance: "Call this endpoint as /api/github/manifest?project=<PROJECT KEY>.",
      },
      { status: 400 },
    );
  }

  const project = await prisma.project.findUnique({
    where: { key },
    include: { repos: { orderBy: { name: "asc" } } },
  });
  if (!project) {
    return Response.json(
      { error: `Unknown project ${key}`, guidance: "Register the project in the portal first." },
      { status: 404 },
    );
  }

  const repo = project.repos.find((candidate) => candidate.provider === "github");
  if (!repo) {
    return Response.json(
      {
        error: `No GitHub repository is linked to ${project.key}`,
        guidance: `Link a github-provider repository to ${project.key} in project settings.`,
      },
      { status: 404 },
    );
  }

  const baseUrl = project.webhookBaseUrl ? normaliseBaseUrl(project.webhookBaseUrl) : null;
  if (!baseUrl) {
    return Response.json(
      {
        error: `No public webhook base URL is set for ${project.key}`,
        guidance:
          "Start your tunnel (for example `ngrok http 4200`), then set the public webhook base URL on the project before creating the GitHub App.",
        expected: githubManifestUrl("<public base URL>", project.key),
      },
      { status: 400 },
    );
  }

  if (!repo.webhookSecret) {
    return Response.json(
      {
        error: `Repository ${repo.name} has no webhook secret`,
        guidance:
          "The secret signs deliveries. Register the project again with a GitHub remote, or re-link the repository so the portal generates one.",
      },
      { status: 400 },
    );
  }

  return Response.json(
    buildAppManifest({
      projectKey: project.key,
      webhookBaseUrl: baseUrl,
      webhookSecret: repo.webhookSecret,
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
