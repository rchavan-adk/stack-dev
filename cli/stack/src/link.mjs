/** Shared "link this repository to a project" logic used by detect and link. */

import * as config from "./config.mjs";
import { ApiError, CliError } from "./errors.mjs";

export async function fetchProjectDetail(ctx, key) {
  const api = await ctx.api();
  try {
    return await api.project(key);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new CliError(`no project with key ${key}`, { fix: "stack project list" });
    }
    throw error;
  }
}

/**
 * Write <repo>/.stack/project.json for `key`, keeping any pack install facts
 * recorded by a previous link to the same project.
 */
export async function linkProject(ctx, key, { root, detail = null } = {}) {
  const resolved = detail ?? (await fetchProjectDetail(ctx, key));
  const portalUrl = await ctx.portal();
  const project = resolved?.project ?? {};
  const harness = resolved?.harness ?? {};
  const previous = await config.readProjectConfig(root);

  const record = {
    projectKey: project.key ?? key,
    projectName: project.name ?? key,
    packName: harness.packName ?? harness.name ?? null,
    packVersion: harness.version ?? null,
    checksum: harness.checksum ?? null,
    installedAt: null,
    mcpUrl: await config.resolveMcpUrl(portalUrl, project, ctx.flags),
    handlePattern: config.handlePatternFor(project),
    portalUrl,
    linkedAt: new Date().toISOString(),
  };

  if (previous && previous.projectKey === record.projectKey) {
    record.installedAt = previous.installedAt ?? null;
    record.digest = previous.digest;
    record.tarballSha256 = previous.tarballSha256;
  }

  await config.writeProjectConfig(root, record);
  return { record, detail: resolved };
}
