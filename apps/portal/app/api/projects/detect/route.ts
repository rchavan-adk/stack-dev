import { prisma } from "@stack/db";
import { authenticate, jsonError } from "@/lib/api-auth";
import { portalBaseUrl } from "@/lib/urls";

const portalUrl = () => portalBaseUrl();

/** Normalise any git remote form to "owner/repo". */
function normaliseRepo(value: string): string {
  return value
    .trim()
    .replace(/^git@([^:]+):/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^ssh:\/\/git@[^/]+\//, "")
    .replace(/\.git$/, "")
    .toLowerCase();
}

/**
 * The CLI asks this before anything else: is the repository I am standing in
 * registered with an engagement? An unregistered repo gets a portal URL, never a guess.
 */
export async function POST(request: Request) {
  try {
    await authenticate(request);
    const body = (await request.json().catch(() => ({}))) as {
      repoName?: string;
      remote?: string;
    };

    const candidates = [body.repoName, body.remote]
      .filter((value): value is string => Boolean(value))
      .map(normaliseRepo);

    if (candidates.length === 0) {
      return Response.json(
        { error: "Provide repoName or remote so the portal can match a registered repository." },
        { status: 400 },
      );
    }

    const repos = await prisma.repo.findMany({ include: { project: true } });
    const match = repos.find((repo) => {
      const registered = normaliseRepo(repo.remotePath || repo.name);
      const byName = normaliseRepo(repo.name);
      return candidates.some(
        (candidate) =>
          candidate === registered ||
          candidate === byName ||
          registered.endsWith(`/${candidate.split("/").pop()}`) ||
          candidate.endsWith(`/${byName.split("/").pop()}`),
      );
    });

    const repoName = candidates[0];

    if (!match) {
      return Response.json({
        registered: false,
        repoName,
        project: null,
        registerUrl: `${portalUrl()}/projects/new?repo=${encodeURIComponent(repoName)}`,
        message:
          "This repository is not registered with a Stack AI project. Register it in the portal, then run `stack project detect` again.",
      });
    }

    return Response.json({
      registered: true,
      repoName,
      project: {
        key: match.project.key,
        name: match.project.name,
        client: match.project.client,
        handlePattern: match.project.handlePattern,
        defaultBranch: match.defaultBranch,
      },
      registerUrl: `${portalUrl()}/projects/${match.project.key}`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
