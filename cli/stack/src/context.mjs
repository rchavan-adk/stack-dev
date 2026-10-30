/**
 * Per-invocation context handed to every command: parsed flags, resolved URLs,
 * credentials, the repo link and small output helpers.
 */

import { Api } from "./api.mjs";
import { CliError } from "./errors.mjs";
import * as config from "./config.mjs";
import * as git from "./git.mjs";
import * as ui from "./ui.mjs";

export function createContext({ flags = {}, positionals = [], cwd = process.cwd() } = {}) {
  const state = {
    portalUrl: null,
    credentials: null,
    credentialsLoaded: false,
    root: undefined,
  };

  const ctx = {
    flags,
    args: positionals,
    cwd,
    json: Boolean(flags.json),
    ui,

    /** Portal URL for this invocation (flag, env, credentials, default). */
    async portal() {
      if (!state.portalUrl) state.portalUrl = await config.resolvePortalUrl(flags);
      return state.portalUrl;
    },

    async credentials() {
      if (!state.credentialsLoaded) {
        state.credentials = await config.readCredentials();
        state.credentialsLoaded = true;
      }
      return state.credentials;
    },

    async token() {
      if (flags.token) return String(flags.token);
      if (process.env.STACK_TOKEN) return process.env.STACK_TOKEN;
      const credentials = await ctx.credentials();
      return credentials?.token ?? "";
    },

    /** Credentials or a clear error telling the developer to log in. */
    async requireCredentials() {
      const credentials = await ctx.credentials();
      if (!credentials?.token) {
        throw new CliError("not signed in to Stack AI", {
          fix: "stack login",
        });
      }
      return credentials;
    },

    /** Authenticated portal client. */
    async api({ auth = true } = {}) {
      const portalUrl = await ctx.portal();
      const token = await ctx.token();
      if (auth && !token) {
        throw new CliError("not signed in to Stack AI", { fix: "stack login" });
      }
      return new Api({ portalUrl, token });
    },

    /** Absolute path of the git repository we are working in. */
    async repoRoot({ required = true } = {}) {
      if (state.root === undefined) state.root = await git.repoRoot(cwd);
      if (!state.root && required) {
        throw new CliError(`not inside a git repository (${cwd})`, {
          fix: "git init   # then: stack project detect",
        });
      }
      return state.root;
    },

    /** The repo link plus its `.stack/project.json`. */
    async project() {
      const root = await ctx.repoRoot();
      const project = await config.readProjectConfig(root);
      if (!project?.projectKey) {
        throw new CliError("this repository is not linked to a Stack AI project", {
          fix: "stack project detect",
        });
      }
      return { root, project, key: project.projectKey };
    },

    /**
     * The repo and its `.stack/project.json`, or null fields when this repository
     * is not linked yet. Used by the harness commands, which fall back to the
     * org-level default pack instead of failing.
     */
    async link() {
      const root = await ctx.repoRoot();
      const project = await config.readProjectConfig(root);
      return { root, project, key: project?.projectKey ?? null, linked: Boolean(project?.projectKey) };
    },

    async session() {
      const root = await ctx.repoRoot({ required: false });
      if (!root) return null;
      return config.readSession(root);
    },
    /** Print JSON when --json was passed, otherwise render the human view. */
    emit(jsonValue, render) {
      if (ctx.json) {
        ui.printJson(jsonValue);
        return;
      }
      render();
    },

    /** Swallow portal errors for optional, cosmetic calls. */
    async soft(promise, fallback = null) {
      try {
        return await promise;
      } catch {
        return fallback;
      }
    },
  };

  return ctx;
}
