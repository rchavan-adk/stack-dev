/** Thin wrappers over the git CLI. Everything is best-effort and never throws. */

import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Run git and capture output. Returns { ok, stdout, stderr }. */
export async function git(args, { cwd } = {}) {
  try {
    const { stdout, stderr } = await exec("git", args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout ?? "").trim(),
      stderr: String(error.stderr ?? error.message ?? "").trim(),
    };
  }
}

/**
 * Run a command (bash, node, npm). With inherit: true the child talks straight to
 * this terminal, which is what `stack verify` needs: execFile cannot inherit
 * stdio, so that path uses spawn.
 */
export async function run(command, args, { cwd, env, inherit = false } = {}) {
  if (inherit) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: "inherit",
      });
      child.on("error", (error) => resolve({ ok: false, code: 1, stdout: "", stderr: error.message }));
      child.on("close", (code, signal) => {
        resolve({
          ok: code === 0,
          code: code ?? 1,
          signal: signal ?? null,
          stdout: "",
          stderr: "",
        });
      });
    });
  }
  try {
    const { stdout, stderr } = await exec(command, args, {
      cwd,
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, code: 0, stdout: String(stdout ?? "").trim(), stderr: String(stderr ?? "").trim() };
  } catch (error) {
    return {
      ok: false,
      code: typeof error.code === "number" ? error.code : 1,
      stdout: String(error.stdout ?? "").trim(),
      stderr: String(error.stderr ?? error.message ?? "").trim(),
    };
  }
}

/** Absolute path of the repository that contains `cwd`, or null. */
export async function repoRoot(cwd = process.cwd()) {
  const result = await git(["rev-parse", "--show-toplevel"], { cwd });
  return result.ok && result.stdout ? path.resolve(result.stdout) : null;
}

export async function remoteUrl(cwd, remote = "origin") {
  const result = await git(["remote", "get-url", remote], { cwd });
  return result.ok ? result.stdout : "";
}

export async function headSha(cwd) {
  const result = await git(["rev-parse", "HEAD"], { cwd });
  return result.ok ? result.stdout : "";
}

export async function hooksDir(cwd) {
  const result = await git(["rev-parse", "--git-path", "hooks"], { cwd });
  if (result.ok && result.stdout) {
    return path.resolve(cwd, result.stdout);
  }
  return path.join(cwd, ".git", "hooks");
}

/** The ref we should diff the current branch against for `stack verify`. */
export async function defaultBaseRef(cwd) {
  for (const candidate of ["origin/main", "origin/master", "main", "master", "origin/develop", "develop"]) {
    const verify = await git(["rev-parse", "--verify", "--quiet", candidate], { cwd });
    if (!verify.ok) continue;
    const mergeBase = await git(["merge-base", candidate, "HEAD"], { cwd });
    if (mergeBase.ok && mergeBase.stdout) return mergeBase.stdout;
  }
  const parent = await git(["rev-parse", "--verify", "--quiet", "HEAD~1"], { cwd });
  return parent.ok ? parent.stdout : "";
}
