/**
 * HTTP client for the Stack AI portal REST API.
 *
 * Auth is `Authorization: Bearer <token>` with `stk_dev_…` tokens. Every failure
 * becomes a CliError with a message and a fixing command; a raw fetch error
 * (portal not running) is reported as such instead of surfacing a stack trace.
 */

import { ApiError, CliError } from "./errors.mjs";
import { normalizeUrl } from "./config.mjs";

const DEFAULT_TIMEOUT_MS = 10000;

export class Api {
  constructor({ portalUrl, token = "", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!portalUrl) throw new CliError("no portal URL configured", { fix: "stack login --portal http://localhost:4200" });
    this.portalUrl = normalizeUrl(portalUrl);
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  url(pathname) {
    if (/^https?:\/\//i.test(pathname)) return pathname;
    return `${this.portalUrl}${pathname.startsWith("/") ? "" : "/"}${pathname}`;
  }

  headers(extra = {}) {
    const headers = { Accept: "application/json", ...extra };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  async request(method, pathname, { body, timeoutMs } = {}) {
    const url = this.url(pathname);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: this.headers(body === undefined ? {} : { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      const reason = error?.cause?.code || error?.code || error?.name || error?.message || "network error";
      throw new CliError(`portal not reachable at ${this.portalUrl} (${reason})`, {
        fix: "npm run dev:portal   # or: stack login --portal <url>",
        cause: error,
      });
    }
    const text = await response.text();
    let parsed = null;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      throw this.errorFor(response, parsed, url);
    }
    return parsed;
  }

  errorFor(response, body, url) {
    const message = extractMessage(body) || `${response.status} ${response.statusText}`;
    const fix =
      response.status === 401 || response.status === 403
        ? "stack login   # your token is missing, expired or not allowed here"
        : "";
    return new ApiError(`${response.status} from ${url.replace(this.portalUrl, "")}: ${message}`, {
      status: response.status,
      body,
      url,
      fix,
    });
  }

  async requestBuffer(pathname, { timeoutMs = 60000 } = {}) {
    const url = this.url(pathname);
    let response;
    try {
      response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const reason = error?.cause?.code || error?.code || error?.name || error?.message || "network error";
      throw new CliError(`download failed, portal not reachable at ${this.portalUrl} (${reason})`, {
        fix: "npm run dev:portal",
        cause: error,
      });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let parsed = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep the text */
      }
      throw this.errorFor(response, parsed, url);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ---- endpoints, exactly as the portal contract describes them ----------

  /** GET /api/me -> { user, projects } */
  me() {
    return this.request("GET", "/api/me");
  }

  /** GET /api/projects -> { projects } */
  projects() {
    return this.request("GET", "/api/projects");
  }

  /** GET /api/projects/:key -> { project, waves, counts, repos, harness } */
  project(key) {
    return this.request("GET", `/api/projects/${encodeURIComponent(key)}`);
  }

  /** POST /api/projects/detect { repoName, remote } -> { registered, project?, registerUrl } */
  detectProject({ repoName, remote }) {
    return this.request("POST", "/api/projects/detect", { body: { repoName, remote } });
  }

  /** GET /api/projects/:key/issues?mine=1&status=... -> { issues } */
  issues(key, { mine = false, status = "" } = {}) {
    const query = new URLSearchParams();
    if (mine) query.set("mine", "1");
    if (status) query.set("status", status);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.request("GET", `/api/projects/${encodeURIComponent(key)}/issues${suffix}`);
  }

  /** GET /api/issues/:handle -> { issue, spec?, events } */
  issue(handle) {
    return this.request("GET", `/api/issues/${encodeURIComponent(handle)}`);
  }

  /** POST /api/issues/:handle/claim -> { issue } */
  claim(handle) {
    return this.request("POST", `/api/issues/${encodeURIComponent(handle)}/claim`, { body: {} });
  }

  /** POST /api/issues/:handle/status { status, note? } -> { issue } | { error } */
  setStatus(handle, { status, note = "" }) {
    const body = { status };
    if (note) body.note = note;
    return this.request("POST", `/api/issues/${encodeURIComponent(handle)}/status`, { body });
  }

  /** GET /api/projects/:key/harness/current -> { pack, downloadUrl } */
  harnessCurrent(key) {
    return this.request("GET", `/api/projects/${encodeURIComponent(key)}/harness/current`);
  }

  /**
   * GET /api/harness/default/current -> { pack, project: null, downloadUrl }
   * The org-level pack a developer installs before a lead publishes a project pack.
   */
  harnessDefault() {
    return this.request("GET", "/api/harness/default/current");
  }

  /** GET /api/harness/download?t=<signed> -> gzipped tar */
  harnessDownload(downloadUrl) {
    return this.requestBuffer(downloadUrl, { timeoutMs: 60000 });
  }

  /** POST /api/harness/installed { project, version, repo } -> { ok } */
  harnessInstalled({ project, version, repo }) {
    return this.request("POST", "/api/harness/installed", { body: { project, version, repo } });
  }
}

export function extractMessage(body) {
  if (body && typeof body === "object") {
    for (const key of ["error", "reason", "message", "detail"]) {
      if (typeof body[key] === "string" && body[key]) return body[key];
    }
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  return "";
}
