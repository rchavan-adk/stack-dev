/**
 * Pure GitHub URL helpers. This module must stay free of node/next imports so the
 * registration form (a client component) and the server-side lib can share one
 * definition of "this is a github.com/<owner>/<repo> remote".
 */

const GITHUB_REMOTE_RE =
  /^(?:https?:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export interface GithubRemote {
  owner: string;
  repo: string;
  /** owner/repo, lowercased — the shape GitHub puts in repository.full_name. */
  fullName: string;
}

/** Accepts https://github.com/owner/repo(.git) and git@github.com:owner/repo(.git). */
export function parseGithubRemoteUrl(value: string): GithubRemote | null {
  const match = GITHUB_REMOTE_RE.exec(value.trim());
  if (!match) return null;
  const [, owner, repo] = match;
  if (!owner || !repo) return null;
  return { owner, repo, fullName: `${owner}/${repo}`.toLowerCase() };
}

export function isGithubRepoUrl(value: string): boolean {
  return parseGithubRemoteUrl(value) !== null;
}

/**
 * "owner/repo" for anything that points at a GitHub repository: a clone URL, an
 * SSH remote, or the bare name a Repo row already carries.
 */
export function githubFullNameFromRemote(value: string): string | null {
  const parsed = parseGithubRemoteUrl(value);
  if (parsed) return parsed.fullName;
  const trimmed = value.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

/** Normalises a user-supplied public base URL: full URL, no trailing slash. */
export function normaliseBaseUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}
