/**
 * The Stack AI MCP server. One server instance is built per request from the
 * API token context, so the tool list a client sees is the enforcement itself:
 * a tool is either registered for that role or it does not exist.
 */
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
// Subpath imports, not the @stack/core barrel: tsx loads that package as
// CommonJS (no "type": "module"), and named imports through its `export *`
// index fail at link time. The barrel will work again once the package
// declares ESM.
import {
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
  ISSUE_TRANSITIONS,
  HUMAN_ONLY_TRANSITIONS,
  TEMPLATE_KINDS,
} from "@stack/core/src/constants";
import type { EventKind, IssueStatus, Role, TemplateKind } from "@stack/core/src/constants";
import {
  checkAgainstTemplate,
  parseTemplateDefinition,
  renderTemplateSkeleton,
} from "@stack/core/src/templates";
import { sha256, signPayload } from "@stack/core/src/tokens";
import { prisma } from "@stack/db";
import type { Project, Wave } from "@stack/db";
import type { AuthContext } from "./auth.js";
import { portalUrl, signingSecret } from "./env.js";

const MCP_VERSION = "0.1.0";

/** Role order for gating: CLIENT < DEVELOPER < LEAD < ADMIN. */
const ROLE_RANK: Record<Role, number> = { CLIENT: 0, DEVELOPER: 1, LEAD: 2, ADMIN: 3 };
type MinRole = "CLIENT" | "DEVELOPER" | "LEAD";

interface ToolSpec {
  name: string;
  minRole: MinRole;
  register: (server: McpServer, ctx: AuthContext) => void;
}

/** Internal refusal: reported to the caller as ok:false, never as a crash. */
class Refusal extends Error {}

interface ToolOutput {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
}

function succeed(summary: string, data?: Record<string, unknown>): ToolOutput {
  return { ok: true, summary, ...(data ? { data } : {}) };
}

function refuse(summary: string, data?: Record<string, unknown>): ToolOutput {
  return { ok: false, summary, ...(data ? { data } : {}) };
}

/**
 * Wraps every tool callback: one stderr line per call (timestamp, token prefix,
 * tool, outcome) and a structured result instead of a thrown error. Stderr, not
 * stdout, because stdout is the protocol channel in stdio mode.
 */
async function runTool(
  name: string,
  ctx: AuthContext,
  fn: () => Promise<ToolOutput>,
): Promise<CallToolResult> {
  let output: ToolOutput;
  let outcome: "ok" | "refused" | "error";
  try {
    output = await fn();
    outcome = output.ok ? "ok" : "refused";
  } catch (error) {
    if (error instanceof Refusal) {
      output = refuse(error.message);
      outcome = "refused";
    } else {
      output = refuse(`stack tool failed: ${error instanceof Error ? error.message : String(error)}`);
      outcome = "error";
      console.error(`${new Date().toISOString()} [${ctx.token.prefix}] ${name} error:`, error);
    }
  }
  console.error(`${new Date().toISOString()} [${ctx.token.prefix}] ${name} ${outcome}`);
  return {
    content: [{ type: "text" as const, text: output.summary }],
    structuredContent: { ok: output.ok, ...(output.data ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Shared query helpers
// ---------------------------------------------------------------------------

async function visibleProjects(ctx: AuthContext): Promise<Project[]> {
  const scopeId = ctx.project?.id;
  let projects: Project[];
  if (ctx.role === "ADMIN") {
    projects = await prisma.project.findMany({ orderBy: { key: "asc" } });
  } else {
    const memberships = await prisma.membership.findMany({
      where: { userId: ctx.user.id },
      include: { project: true },
    });
    projects = memberships.map((m) => m.project);
  }
  const scoped = scopeId ? projects.filter((p) => p.id === scopeId) : projects;
  return [...new Map(scoped.map((p) => [p.id, p]))].map(([, p]) => p).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Resolve the project an operation targets. Precedence: the token's own scope,
 * then an explicit key, then the only visible project. A project-scoped token
 * can never leave its project.
 */
async function requireProject(ctx: AuthContext, key?: string): Promise<Project> {
  const scope = ctx.project;
  if (scope) {
    if (key && key.toUpperCase() !== scope.key.toUpperCase() && key !== scope.id) {
      throw new Refusal(`this token is scoped to project ${scope.key}; "${key}" is out of scope`);
    }
    return scope;
  }
  const projects = await visibleProjects(ctx);
  if (key) {
    const wanted = key.toUpperCase();
    const found = projects.find((p) => p.key.toUpperCase() === wanted || p.id === key);
    if (!found) {
      throw new Refusal(
        `no project "${key}"; visible projects: ${projects.map((p) => p.key).join(", ") || "none"}`,
      );
    }
    return found;
  }
  if (projects.length === 0) throw new Refusal("this token cannot see any project");
  if (projects.length === 1) return projects[0];
  throw new Refusal(
    `this token sees ${projects.length} projects; pass one of: ${projects.map((p) => p.key).join(", ")}`,
  );
}

async function canSeeProject(ctx: AuthContext, projectId: string): Promise<boolean> {
  if (ctx.project && ctx.project.id !== projectId) return false;
  if (ctx.role === "ADMIN") return true;
  const member = await prisma.membership.findFirst({ where: { userId: ctx.user.id, projectId } });
  return member !== null;
}

async function requireIssue(ctx: AuthContext, handle: string) {
  const issue = await prisma.issue.findUnique({
    where: { handle },
    include: { project: true, assignee: true, wave: true, spec: true },
  });
  if (!issue) throw new Refusal(`no issue "${handle}"; use stack_issue_list to find handles`);
  if (!(await canSeeProject(ctx, issue.projectId))) {
    throw new Refusal(
      `issue "${handle}" belongs to project ${issue.project.key}, which this token cannot see`,
    );
  }
  return issue;
}

async function findWave(project: Project, ref: string | number): Promise<Wave | null> {
  const waves = await prisma.wave.findMany({ where: { projectId: project.id } });
  const numeric = typeof ref === "number" ? ref : /^\d+$/.test(ref.trim()) ? Number(ref.trim()) : null;
  if (numeric !== null) return waves.find((w) => w.number === numeric) ?? null;
  const wanted = String(ref).toLowerCase();
  return waves.find((w) => w.name.toLowerCase() === wanted) ?? null;
}

async function activeTemplate(kind: TemplateKind) {
  return prisma.template.findFirst({ where: { kind, active: true }, orderBy: { updatedAt: "desc" } });
}

async function currentPublishedVersion(projectId: string) {
  return prisma.harnessVersion.findFirst({
    where: { status: "PUBLISHED", pack: { projectId } },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    include: { pack: true, publishedBy: true, components: true },
  });
}

/** Every mutation lands in the evidence ledger; the portal renders this trail. */
async function writeEvent(input: {
  projectId: string;
  issueId?: string;
  kind: EventKind;
  actor: string;
  summary: string;
  payload?: unknown;
}): Promise<void> {
  await prisma.event.create({
    data: {
      projectId: input.projectId,
      issueId: input.issueId ?? null,
      kind: input.kind,
      actor: input.actor,
      summary: input.summary,
      payload: input.payload === undefined ? null : JSON.stringify(input.payload),
    },
  });
}

function statusLabel(status: string): string {
  return ISSUE_STATUSES.includes(status as IssueStatus)
    ? ISSUE_STATUS_LABELS[status as IssueStatus]
    : status;
}

function parseAcceptance(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseEventPayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Next handle in the project's own sequence: max existing handle number + 1. */
async function allocateHandle(project: Project): Promise<string> {
  const issues = await prisma.issue.findMany({ where: { projectId: project.id }, select: { handle: true } });
  const pattern = new RegExp(`^${project.handlePattern}$`);
  let max = 0;
  let prefix: string | null = null;
  for (const { handle } of issues) {
    const tail = /^(.*?)(\d+)$/.exec(handle);
    if (!tail) continue;
    if (pattern.test(handle)) prefix = tail[1];
    max = Math.max(max, Number(tail[2]));
  }
  if (prefix === null) {
    const fromPattern = /^(.+?)(?:\[0-9]\+|\\d\+|\.)/.exec(project.handlePattern);
    prefix = fromPattern?.[1] ?? "STACK-";
  }
  return `${prefix}${max + 1}`;
}

/**
 * checkAgainstTemplate counts acceptance criteria from an array, but a
 * well-written spec or wave keeps them as a checklist inside the body. Pull
 * them out so the body stays the single source of truth.
 */
function extractChecklist(body: string, headings: string[]): string[] {
  for (const heading of headings) {
    const regex = new RegExp(
      `^#{1,4}\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
      "im",
    );
    const match = regex.exec(body);
    if (!match) continue;
    const rest = body.slice(match.index + match[0].length);
    const next = /^#{1,4}\s+\S/m.exec(rest);
    const section = next ? rest.slice(0, next.index) : rest;
    const items = section
      .split(/\r?\n/)
      .map((line) => /^\s*(?:[-*+]\s+\[[ xX]\]\s*|[-*+]\s+)(.*)$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1].trim())
      .filter((item) => item.length > 0);
    if (items.length > 0) return items;
  }
  return [];
}

function parseDate(value: string | undefined, label: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Refusal(`${label} is not a valid date: "${value}" (use ISO yyyy-mm-dd)`);
  }
  return date;
}

/** Normal forms for repo matching: full clean path and its last segment. */
function repoRef(ref: string): { clean: string; base: string } {
  let value = ref.trim();
  value = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  value = value.replace(/^[^@/\s]+@[^:/\s]+[:/]/, "");
  value = value.replace(/\/+$/, "");
  value = value.replace(/\.git$/i, "");
  const segments = value.split(/[:/]/).filter(Boolean);
  return { clean: value, base: segments[segments.length - 1] ?? "" };
}

// ---------------------------------------------------------------------------
// Tools — every role
// ---------------------------------------------------------------------------

function registerWhoami(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_whoami",
    {
      title: "Who am I",
      description:
        "Identity of this API token: user, role, project scope, the projects you can see with issue counts, and the exact tools this token may call.",
    },
    async () =>
      runTool("stack_whoami", ctx, async () => {
        const projects = await visibleProjects(ctx);
        const rows = await prisma.issue.findMany({
          where: { projectId: { in: projects.map((p) => p.id) } },
          select: { projectId: true, status: true },
        });
        const counts = new Map<string, { total: number; open: number; done: number }>();
        for (const project of projects) counts.set(project.id, { total: 0, open: 0, done: 0 });
        for (const row of rows) {
          const entry = counts.get(row.projectId);
          if (!entry) continue;
          entry.total += 1;
          if (row.status === "DONE") entry.done += 1;
          else entry.open += 1;
        }
        const tools = toolsForRole(ctx.role);
        const data = {
          user: {
            name: ctx.user.name,
            email: ctx.user.email,
            title: ctx.user.title,
            portalRole: ctx.user.role,
          },
          token: {
            name: ctx.token.name,
            prefix: ctx.token.prefix,
            role: ctx.role,
            project: ctx.project?.key ?? null,
          },
          role: ctx.role,
          projects: projects.map((p) => ({
            key: p.key,
            name: p.name,
            client: p.client,
            status: p.status,
            issues: counts.get(p.id) ?? { total: 0, open: 0, done: 0 },
          })),
          tools,
        };
        const scope = ctx.project ? ` scoped to ${ctx.project.key}` : "";
        return succeed(
          `${ctx.user.name} — ${ctx.role} token${scope}. ${projects.length} project(s), ${tools.length} tools available.`,
          data,
        );
      }),
  );
}

function registerProjectList(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_project_list",
    {
      title: "List projects",
      description:
        "Projects this token can see: ADMIN tokens see every project, others see their memberships. A project-scoped token only ever sees its own project.",
    },
    async () =>
      runTool("stack_project_list", ctx, async () => {
        const projects = await visibleProjects(ctx);
        return succeed(
          projects.length
            ? `${projects.length} project(s): ${projects.map((p) => `${p.key} — ${p.name}`).join("; ")}`
            : "No projects visible to this token.",
          {
            count: projects.length,
            projects: projects.map((p) => ({
              key: p.key,
              name: p.name,
              client: p.client,
              summary: p.summary,
              status: p.status,
              handlePattern: p.handlePattern,
            })),
          },
        );
      }),
  );
}

function registerProjectDetect(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_project_detect",
    {
      title: "Detect the project for a repository",
      description:
        "Check whether a repository is registered to a Stack project, and get the portal URL to register it when it is not. Match by repo name (e.g. acme/checkout) or remote path.",
      inputSchema: {
        repoName: z.string().optional().describe("Repository name as the portal stores it, e.g. acme/checkout"),
        remote: z.string().optional().describe("Remote URL or filesystem path, e.g. /srv/git/acme-checkout.git"),
      },
    },
    async (args) =>
      runTool("stack_project_detect", ctx, async () => {
        if (!args.repoName && !args.remote) {
          return refuse("pass repoName or remote so the server has something to match");
        }
        const raw = (args.repoName ?? args.remote ?? "").trim();
        const query = repoRef(raw);
        const projects = await visibleProjects(ctx);
        const repos = await prisma.repo.findMany({
          where: { projectId: { in: projects.map((p) => p.id) } },
          include: { project: true },
        });
        const hit = repos.find((repo) => {
          const candidates = [repo.name, repo.remotePath].map(repoRef);
          return candidates.some((c) => c.base.includes(query.base) || query.base.includes(c.base));
        });
        if (hit) {
          return succeed(`Repository ${hit.name} belongs to project ${hit.project.key} (${hit.project.name}).`, {
            registered: true,
            project: {
              key: hit.project.key,
              name: hit.project.name,
              client: hit.project.client,
              status: hit.project.status,
            },
            repo: {
              name: hit.name,
              provider: hit.provider,
              remotePath: hit.remotePath,
              defaultBranch: hit.defaultBranch,
            },
          });
        }
        const registerUrl = `${portalUrl()}/projects/new?repo=${encodeURIComponent(raw)}`;
        return succeed(`No project claims "${raw}". Register it in the portal: ${registerUrl}`, {
          registered: false,
          project: null,
          registerUrl,
        });
      }),
  );
}

function registerIssueList(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_issue_list",
    {
      title: "List issues",
      description:
        "Issues of a project with wave, assignee and parsed acceptance criteria. Filter by status, wave, or only your own. project defaults to the token's scope, or your only visible project.",
      inputSchema: {
        project: z.string().optional().describe("Project key, e.g. ACME"),
        mine: z.boolean().optional().describe("Only issues assigned to you"),
        status: z.enum(ISSUE_STATUSES).optional().describe("Filter by status"),
        wave: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Wave number (e.g. 2) or wave name (e.g. Foundations)"),
      },
    },
    async (args) =>
      runTool("stack_issue_list", ctx, async () => {
        const project = await requireProject(ctx, args.project);
        let waveId: string | undefined;
        if (args.wave !== undefined) {
          const wave = await findWave(project, args.wave);
          if (!wave) throw new Refusal(`no wave matching "${args.wave}" in ${project.key}`);
          waveId = wave.id;
        }
        const issues = await prisma.issue.findMany({
          where: {
            projectId: project.id,
            ...(args.mine ? { assigneeId: ctx.user.id } : {}),
            ...(args.status ? { status: args.status } : {}),
            ...(waveId ? { waveId } : {}),
          },
          orderBy: { handle: "asc" },
          include: { wave: true, assignee: true },
        });
        return succeed(
          `${issues.length} issue(s) in ${project.key}${args.mine ? " assigned to you" : ""}.`,
          {
            project: project.key,
            count: issues.length,
            issues: issues.map((issue) => ({
              handle: issue.handle,
              title: issue.title,
              type: issue.type,
              status: issue.status,
              statusLabel: statusLabel(issue.status),
              estimate: issue.estimate,
              assignee: issue.assignee?.name ?? null,
              wave: issue.wave ? `${issue.wave.number}. ${issue.wave.name}` : null,
              acceptance: parseAcceptance(issue.acceptance),
              branch: issue.branch,
              prNumber: issue.prNumber,
            })),
          },
        );
      }),
  );
}

function registerIssueGet(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_issue_get",
    {
      title: "Get one issue",
      description:
        "Full issue by handle: body, parsed acceptance criteria, linked spec, wave, assignee and the last 20 evidence events. The starting point for working an issue.",
      inputSchema: { handle: z.string().describe("Issue handle, e.g. STACK-104") },
    },
    async ({ handle }) =>
      runTool("stack_issue_get", ctx, async () => {
        const issue = await requireIssue(ctx, handle);
        const events = await prisma.event.findMany({
          where: { issueId: issue.id },
          orderBy: { createdAt: "desc" },
          take: 20,
        });
        return succeed(
          `${issue.handle} — ${issue.title} [${statusLabel(issue.status)}] · spec ${issue.spec ? "attached" : "none"} · ${events.length} recent events.`,
          {
            handle: issue.handle,
            title: issue.title,
            body: issue.body,
            type: issue.type,
            status: issue.status,
            statusLabel: statusLabel(issue.status),
            project: issue.project.key,
            wave: issue.wave
              ? { number: issue.wave.number, name: issue.wave.name, status: issue.wave.status }
              : null,
            assignee: issue.assignee?.name ?? null,
            estimate: issue.estimate,
            acceptance: parseAcceptance(issue.acceptance),
            branch: issue.branch,
            prNumber: issue.prNumber,
            spec: issue.spec
              ? { id: issue.spec.id, title: issue.spec.title, status: issue.spec.status, body: issue.spec.body }
              : null,
            events: events.map((e) => ({
              kind: e.kind,
              actor: e.actor,
              summary: e.summary,
              at: e.createdAt.toISOString(),
              payload: parseEventPayload(e.payload),
            })),
          },
        );
      }),
  );
}

function registerWaveList(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_wave_list",
    {
      title: "List waves",
      description:
        "Waves of a project with issue counts per status: the delivery plan at a glance. Wave ids feed stack_issue_create's waveId.",
      inputSchema: { project: z.string().optional().describe("Project key, e.g. ACME") },
    },
    async ({ project }) =>
      runTool("stack_wave_list", ctx, async () => {
        const resolved = await requireProject(ctx, project);
        const waves = await prisma.wave.findMany({
          where: { projectId: resolved.id },
          orderBy: { number: "asc" },
        });
        const rows = await prisma.issue.findMany({
          where: { projectId: resolved.id },
          select: { waveId: true, status: true },
        });
        return succeed(`${waves.length} wave(s) in ${resolved.key}.`, {
          project: resolved.key,
          waves: waves.map((wave) => {
            const own = rows.filter((r) => r.waveId === wave.id);
            const byStatus: Record<string, number> = {};
            for (const status of ISSUE_STATUSES) {
              byStatus[status] = own.filter((r) => r.status === status).length;
            }
            return {
              id: wave.id,
              number: wave.number,
              name: wave.name,
              goal: wave.goal,
              status: wave.status,
              startsOn: wave.startsOn?.toISOString() ?? null,
              endsOn: wave.endsOn?.toISOString() ?? null,
              issues: { total: own.length, byStatus },
            };
          }),
        });
      }),
  );
}

function registerTemplateGet(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_template_get",
    {
      title: "Get the active template",
      description:
        "The active ISSUE, SPEC or WAVE template: its definition and a markdown skeleton submissions must follow. Read this before stack_issue_create, stack_spec_submit or stack_wave_create.",
      inputSchema: {
        kind: z.enum(TEMPLATE_KINDS).describe("Template kind: ISSUE, SPEC or WAVE"),
      },
    },
    async ({ kind }) =>
      runTool("stack_template_get", ctx, async () => {
        const template = await activeTemplate(kind);
        if (!template) throw new Refusal(`no active ${kind} template is configured`);
        const definition = parseTemplateDefinition(template.definition);
        return succeed(
          `${template.name} v${template.version} (${kind}) — ${definition.sections.length} sections, ${definition.fields.length} fields.`,
          {
            kind,
            name: template.name,
            version: template.version,
            definition,
            skeleton: renderTemplateSkeleton(definition),
          },
        );
      }),
  );
}

function registerHarnessCurrent(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_harness_current",
    {
      title: "Current harness pack",
      description:
        "The published harness pack for a project: name, version, checksum and component list, plus the CLI command that installs it.",
      inputSchema: { project: z.string().optional().describe("Project key, e.g. ACME") },
    },
    async ({ project }) =>
      runTool("stack_harness_current", ctx, async () => {
        const resolved = await requireProject(ctx, project);
        const version = await currentPublishedVersion(resolved.id);
        if (!version) throw new Refusal(`no published harness pack for ${resolved.key} yet`);
        return succeed(
          `Harness for ${resolved.key}: ${version.pack.name} ${version.version} (${version.components.length} components). Install with: stack harness install`,
          {
            project: resolved.key,
            pack: { name: version.pack.name, description: version.pack.description },
            version: version.version,
            checksum: version.checksum,
            notes: version.notes,
            publishedAt: version.publishedAt?.toISOString() ?? null,
            publishedBy: version.publishedBy?.name ?? null,
            components: version.components
              .slice()
              .sort((a, b) => a.path.localeCompare(b.path))
              .map((c) => ({ kind: c.kind, path: c.path, mode: c.mode })),
            installCommand: "stack harness install",
          },
        );
      }),
  );
}

function registerHarnessDownloadUrl(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_harness_download_url",
    {
      title: "Signed harness download URL",
      description:
        "A short-lived signed URL for the current published harness tarball. Hand it to the stack CLI or CI; it carries no API token and expires in 10 minutes.",
      inputSchema: { project: z.string().optional().describe("Project key, e.g. ACME") },
    },
    async ({ project }) =>
      runTool("stack_harness_download_url", ctx, async () => {
        const resolved = await requireProject(ctx, project);
        const secret = signingSecret();
        if (!secret) {
          throw new Refusal("STACK_SIGNING_SECRET is not configured on the server; cannot sign a download URL");
        }
        const version = await currentPublishedVersion(resolved.id);
        if (!version) throw new Refusal(`no published harness pack for ${resolved.key} yet`);
        const signed = signPayload({ projectKey: resolved.key, versionId: version.id }, secret, 600);
        const url = `${portalUrl()}/api/harness/download?t=${encodeURIComponent(signed)}`;
        return succeed(
          `Download ${version.pack.name} ${version.version} within 10 minutes: ${url}`,
          {
            project: resolved.key,
            pack: version.pack.name,
            version: version.version,
            url,
            expiresInSeconds: 600,
          },
        );
      }),
  );
}

function registerSpecGet(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_spec_get",
    {
      title: "Get a spec",
      description:
        "A spec by its id or by the handle of the issue it belongs to: title, status, body and approver.",
      inputSchema: {
        handle: z.string().optional().describe("Issue handle whose spec you want, e.g. STACK-104"),
        specId: z.string().optional().describe("Spec id"),
      },
    },
    async (args) =>
      runTool("stack_spec_get", ctx, async () => {
        if (!args.handle && !args.specId) return refuse("pass handle or specId");
        const spec = args.specId
          ? await prisma.spec.findUnique({
              where: { id: args.specId },
              include: { issue: true, approvedBy: true, project: true },
            })
          : (
              await prisma.issue.findUnique({
                where: { handle: args.handle ?? "" },
                include: {
                  spec: { include: { issue: true, approvedBy: true, project: true } },
                },
              })
            )?.spec ?? null;
        if (!spec) throw new Refusal("no spec found; check the handle or specId with stack_issue_get");
        if (!(await canSeeProject(ctx, spec.projectId))) {
          throw new Refusal("that spec belongs to a project this token cannot see");
        }
        return succeed(
          `${spec.title} — ${spec.status}${spec.issue ? ` for ${spec.issue.handle}` : ""}.`,
          {
            id: spec.id,
            title: spec.title,
            status: spec.status,
            body: spec.body,
            project: spec.project.key,
            issue: spec.issue ? { handle: spec.issue.handle, title: spec.issue.title } : null,
            approvedBy: spec.approvedBy?.name ?? null,
            createdAt: spec.createdAt.toISOString(),
            updatedAt: spec.updatedAt.toISOString(),
          },
        );
      }),
  );
}

// ---------------------------------------------------------------------------
// Tools — DEVELOPER and above
// ---------------------------------------------------------------------------

function registerIssueClaim(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_issue_claim",
    {
      title: "Claim an issue",
      description:
        "Assign an APPROVED or IN_PROGRESS issue to yourself and move it to IN_PROGRESS. Refuses issues in any other status, or already assigned to someone else.",
      inputSchema: { handle: z.string().describe("Issue handle, e.g. STACK-104") },
    },
    async ({ handle }) =>
      runTool("stack_issue_claim", ctx, async () => {
        const issue = await requireIssue(ctx, handle);
        if (issue.status !== "APPROVED" && issue.status !== "IN_PROGRESS") {
          throw new Refusal(
            `cannot claim ${handle}: it is ${statusLabel(issue.status)}. Only APPROVED or IN_PROGRESS issues can be claimed`,
          );
        }
        if (issue.assigneeId && issue.assigneeId !== ctx.user.id) {
          throw new Refusal(
            `cannot claim ${handle}: already assigned to ${issue.assignee?.name ?? "another developer"}`,
          );
        }
        // Conditional update so a concurrent claim cannot steal the issue.
        const updated = await prisma.issue.updateMany({
          where: {
            id: issue.id,
            status: { in: ["APPROVED", "IN_PROGRESS"] },
            OR: [{ assigneeId: null }, { assigneeId: ctx.user.id }],
          },
          data: { assigneeId: ctx.user.id, status: "IN_PROGRESS" },
        });
        if (updated.count === 0) {
          throw new Refusal(`${handle} changed while claiming; re-check with stack_issue_get and retry`);
        }
        await writeEvent({
          projectId: issue.projectId,
          issueId: issue.id,
          kind: "CLAIMED",
          actor: ctx.user.name,
          summary: `${ctx.user.name} claimed ${handle} via MCP`,
          payload: { via: "mcp", token: ctx.token.prefix },
        });
        return succeed(`Claimed ${handle}. It is now IN_PROGRESS and assigned to ${ctx.user.name}.`, {
          handle,
          status: "IN_PROGRESS",
          assignee: ctx.user.name,
        });
      }),
  );
}

function registerIssueReportStatus(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_issue_report_status",
    {
      title: "Report an issue status",
      description:
        "Move an issue along its lifecycle following the allowed transitions. BACKLOG→APPROVED and AWAITING_VALIDATION→DONE are human-only: a person must do those in the portal.",
      inputSchema: {
        handle: z.string().describe("Issue handle, e.g. STACK-104"),
        status: z.enum(ISSUE_STATUSES).describe("Target status"),
        note: z.string().optional().describe("Short reason recorded as evidence, e.g. 'PR #43 opened'"),
      },
    },
    async (args) =>
      runTool("stack_issue_report_status", ctx, async () => {
        const issue = await requireIssue(ctx, args.handle);
        const current = issue.status as IssueStatus;
        if (!ISSUE_STATUSES.includes(current)) {
          throw new Refusal(
            `${args.handle} has unknown status "${issue.status}"; fix the record in the portal`,
          );
        }
        const target = args.status;
        if (!ISSUE_TRANSITIONS[current].includes(target)) {
          throw new Refusal(
            `${args.handle} cannot go from ${statusLabel(current)} to ${statusLabel(target)}. Allowed: ${
              ISSUE_TRANSITIONS[current].map(statusLabel).join(", ") || "none"
            }`,
          );
        }
        if (HUMAN_ONLY_TRANSITIONS.some((t) => t.from === current && t.to === target)) {
          throw new Refusal(
            `a person must do this in the portal: moving ${args.handle} from ${statusLabel(current)} to ${statusLabel(target)} is a human-only transition`,
          );
        }
        await prisma.issue.update({ where: { id: issue.id }, data: { status: target } });
        await writeEvent({
          projectId: issue.projectId,
          issueId: issue.id,
          kind: "STATUS_REPORTED",
          actor: ctx.user.name,
          summary: `${args.handle}: ${statusLabel(current)} → ${statusLabel(target)}${
            args.note ? ` — ${args.note}` : ""
          } (via MCP)`,
          payload: { from: current, to: target, note: args.note ?? null, token: ctx.token.prefix },
        });
        return succeed(`${args.handle} is now ${statusLabel(target)}.`, {
          handle: args.handle,
          from: current,
          to: target,
        });
      }),
  );
}

function registerEvidenceAppend(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_evidence_append",
    {
      title: "Append evidence",
      description:
        "Add a row to an issue's evidence ledger: a commit, an opened or merged PR, or a progress note. The portal shows this trail next to the issue.",
      inputSchema: {
        handle: z.string().describe("Issue handle the evidence belongs to"),
        summary: z
          .string()
          .describe("One line of evidence, e.g. 'STACK-104: add line-item tax breakdown' or 'PR #43 opened'"),
        kind: z
          .enum(["COMMIT", "PR_OPENED", "PR_MERGED", "STATUS_REPORTED"])
          .optional()
          .describe("Evidence kind; defaults to COMMIT"),
        payload: z
          .record(z.unknown())
          .optional()
          .describe('Structured details stored as JSON, e.g. {"sha": "..."}'),
      },
    },
    async (args) =>
      runTool("stack_evidence_append", ctx, async () => {
        const issue = await requireIssue(ctx, args.handle);
        const kind = args.kind ?? "COMMIT";
        await prisma.event.create({
          data: {
            projectId: issue.projectId,
            issueId: issue.id,
            kind,
            actor: ctx.user.name,
            summary: args.summary,
            payload: args.payload === undefined ? null : JSON.stringify(args.payload),
          },
        });
        return succeed(`Evidence recorded on ${args.handle}: [${kind}] ${args.summary}`, {
          handle: args.handle,
          kind,
          summary: args.summary,
        });
      }),
  );
}

// ---------------------------------------------------------------------------
// Tools — LEAD and above
// ---------------------------------------------------------------------------

function registerIssueCreate(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_issue_create",
    {
      title: "Create an issue",
      description:
        "Create an issue in BACKLOG with the next handle in the project's sequence. The body must follow the active ISSUE template (stack_template_get kind=ISSUE); a draft that misses sections or fields is refused with the violations and nothing is created.",
      inputSchema: {
        project: z.string().describe("Project key, e.g. ACME"),
        title: z.string().min(3).max(140).describe("Issue title"),
        body: z
          .string()
          .describe("Markdown body following the ISSUE template sections (Context, Scope, Acceptance criteria, Out of scope)"),
        type: z
          .enum(["FEATURE", "BUG", "CHORE", "SPIKE"])
          .optional()
          .describe("Issue type; the ISSUE template requires it"),
        estimate: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Estimate in points; the ISSUE template requires it"),
        waveId: z
          .string()
          .optional()
          .describe("Wave id from stack_wave_list; the ISSUE template requires a wave"),
        acceptance: z.array(z.string()).describe("Acceptance criteria a person can validate"),
        fields: z
          .record(z.union([z.string(), z.number()]))
          .optional()
          .describe("Extra template fields when the active template requires more"),
      },
    },
    async (args) =>
      runTool("stack_issue_create", ctx, async () => {
        const project = await requireProject(ctx, args.project);
        const wave = args.waveId
          ? await prisma.wave.findFirst({ where: { id: args.waveId, projectId: project.id } })
          : null;
        if (args.waveId && !wave) {
          throw new Refusal(`no wave "${args.waveId}" in ${project.key}; use stack_wave_list for wave ids`);
        }
        const template = await activeTemplate("ISSUE");
        if (!template) throw new Refusal("no active ISSUE template is configured; an admin must fix the portal");
        const definition = parseTemplateDefinition(template.definition);
        const fields: Record<string, string | number> = { ...(args.fields ?? {}) };
        if (args.type !== undefined) fields.type = args.type;
        if (args.estimate !== undefined) fields.estimate = args.estimate;
        if (wave) fields.wave = `Wave ${wave.number}: ${wave.name}`;
        const acceptance = args.acceptance.map((a) => a.trim()).filter(Boolean);
        const check = checkAgainstTemplate(definition, {
          title: args.title,
          body: args.body,
          fields,
          acceptance,
          waveId: wave?.id ?? null,
          specId: null,
        });
        if (!check.ok) {
          await writeEvent({
            projectId: project.id,
            kind: "TEMPLATE_REJECTED",
            actor: ctx.user.name,
            summary: `Issue draft "${args.title}" rejected by ${template.name} v${template.version}`,
            payload: { violations: check.violations, token: ctx.token.prefix },
          });
          return refuse(
            `Issue draft rejected by ${template.name} v${template.version}: ${check.violations
              .map((v) => v.message)
              .join(" ")}`,
            { violations: check.violations },
          );
        }
        const handle = await allocateHandle(project);
        const issue = await prisma.issue.create({
          data: {
            projectId: project.id,
            waveId: wave?.id ?? null,
            handle,
            title: args.title,
            body: args.body,
            type: args.type ?? "FEATURE",
            status: "BACKLOG",
            estimate: args.estimate ?? null,
            acceptance: JSON.stringify(acceptance),
          },
        });
        await writeEvent({
          projectId: project.id,
          issueId: issue.id,
          kind: "STATUS_REPORTED",
          actor: ctx.user.name,
          summary: `${handle} "${args.title}" created in Backlog via MCP`,
          payload: {
            handle,
            type: issue.type,
            waveId: wave?.id ?? null,
            estimate: issue.estimate,
            token: ctx.token.prefix,
          },
        });
        return succeed(`Created ${handle} in ${project.key} (Backlog).`, {
          handle,
          id: issue.id,
          project: project.key,
          status: "BACKLOG",
          wave: wave ? `${wave.number}. ${wave.name}` : null,
        });
      }),
  );
}

function registerWaveCreate(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_wave_create",
    {
      title: "Create a wave",
      description:
        "Create a PLANNED wave. `goal` is the markdown body: follow the active WAVE template's sections (stack_template_get kind=WAVE), otherwise the draft is refused with the violations and nothing is created.",
      inputSchema: {
        project: z.string().describe("Project key, e.g. ACME"),
        name: z.string().min(3).max(80).describe("Wave name, e.g. Payments and receipts"),
        goal: z.string().describe("Wave goal as markdown following the WAVE template sections"),
        number: z.number().int().positive().optional().describe("Wave number; defaults to max + 1 in the project"),
        startsOn: z.string().optional().describe("Start date, ISO yyyy-mm-dd"),
        endsOn: z.string().optional().describe("End date, ISO yyyy-mm-dd"),
        acceptance: z
          .array(z.string())
          .optional()
          .describe("Exit criteria; defaults to the checklist under the body's Exit criteria heading"),
        fields: z
          .record(z.union([z.string(), z.number()]))
          .optional()
          .describe(
            'Extra template fields, e.g. { duration_weeks: 6, shape: "VERTICAL" }; shape defaults to HORIZONTAL and duration_weeks is derived from the dates when both are given',
          ),
      },
    },
    async (args) =>
      runTool("stack_wave_create", ctx, async () => {
        const project = await requireProject(ctx, args.project);
        const existing = await prisma.wave.findMany({
          where: { projectId: project.id },
          select: { number: true },
        });
        const nextNumber = args.number ?? Math.max(0, ...existing.map((w) => w.number)) + 1;
        if (existing.some((w) => w.number === nextNumber)) {
          throw new Refusal(`wave ${nextNumber} already exists in ${project.key}`);
        }
        const startsOn = parseDate(args.startsOn, "startsOn");
        const endsOn = parseDate(args.endsOn, "endsOn");
        const template = await activeTemplate("WAVE");
        if (!template) throw new Refusal("no active WAVE template is configured; an admin must fix the portal");
        const definition = parseTemplateDefinition(template.definition);
        const acceptance = (
          args.acceptance ?? extractChecklist(args.goal, ["Acceptance criteria", "Exit criteria"])
        )
          .map((a) => a.trim())
          .filter(Boolean);
        const fields: Record<string, string | number> = { shape: "HORIZONTAL", ...(args.fields ?? {}) };
        if (startsOn && endsOn) {
          fields.duration_weeks = Math.max(
            1,
            Math.ceil((endsOn.getTime() - startsOn.getTime()) / (7 * 24 * 60 * 60 * 1000)),
          );
        }
        const check = checkAgainstTemplate(definition, {
          title: args.name,
          body: args.goal,
          fields,
          acceptance,
        });
        if (!check.ok) {
          await writeEvent({
            projectId: project.id,
            kind: "TEMPLATE_REJECTED",
            actor: ctx.user.name,
            summary: `Wave draft "${args.name}" rejected by ${template.name} v${template.version}`,
            payload: { violations: check.violations, token: ctx.token.prefix },
          });
          return refuse(
            `Wave draft rejected by ${template.name} v${template.version}: ${check.violations
              .map((v) => v.message)
              .join(" ")}`,
            { violations: check.violations },
          );
        }
        const wave = await prisma.wave.create({
          data: {
            projectId: project.id,
            number: nextNumber,
            name: args.name,
            goal: args.goal,
            status: "PLANNED",
            startsOn,
            endsOn,
          },
        });
        await writeEvent({
          projectId: project.id,
          kind: "STATUS_REPORTED",
          actor: ctx.user.name,
          summary: `Wave ${wave.number} "${wave.name}" created (PLANNED) via MCP`,
          payload: { number: wave.number, token: ctx.token.prefix },
        });
        return succeed(`Created wave ${wave.number} "${wave.name}" in ${project.key} (PLANNED).`, {
          id: wave.id,
          number: wave.number,
          name: wave.name,
          status: wave.status,
        });
      }),
  );
}

function registerSpecSubmit(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_spec_submit",
    {
      title: "Submit a spec",
      description:
        "Submit a spec for review with status SUBMITTED. The body must follow the active SPEC template (stack_template_get kind=SPEC); a draft that misses sections is refused with the violations and nothing is created.",
      inputSchema: {
        project: z.string().describe("Project key, e.g. ACME"),
        title: z.string().min(3).max(140).describe("Spec title"),
        body: z
          .string()
          .describe("Markdown body following the SPEC template sections (Problem, Proposal, Interfaces, Risks and rollback, Acceptance criteria)"),
        issueHandle: z.string().optional().describe("Issue handle to link the spec to"),
        acceptance: z
          .array(z.string())
          .optional()
          .describe("Acceptance criteria; defaults to the checklist under the body's Acceptance criteria heading"),
        fields: z
          .record(z.union([z.string(), z.number()]))
          .optional()
          .describe('Extra template fields, e.g. { author_role: "LEAD" }; defaults to PLANNER_AGENT'),
      },
    },
    async (args) =>
      runTool("stack_spec_submit", ctx, async () => {
        const project = await requireProject(ctx, args.project);
        let issue: { id: string; handle: string } | null = null;
        if (args.issueHandle) {
          const found = await prisma.issue.findUnique({ where: { handle: args.issueHandle } });
          if (!found) throw new Refusal(`no issue "${args.issueHandle}"`);
          if (found.projectId !== project.id) {
            throw new Refusal(`${args.issueHandle} is not in ${project.key}`);
          }
          const linked = await prisma.spec.findUnique({ where: { issueId: found.id } });
          if (linked) {
            throw new Refusal(`${args.issueHandle} already has spec "${linked.title}" (${linked.status})`);
          }
          issue = { id: found.id, handle: found.handle };
        }
        const template = await activeTemplate("SPEC");
        if (!template) throw new Refusal("no active SPEC template is configured; an admin must fix the portal");
        const definition = parseTemplateDefinition(template.definition);
        const acceptance = (args.acceptance ?? extractChecklist(args.body, ["Acceptance criteria"]))
          .map((a) => a.trim())
          .filter(Boolean);
        const fields: Record<string, string | number> = { author_role: "PLANNER_AGENT", ...(args.fields ?? {}) };
        const check = checkAgainstTemplate(definition, { title: args.title, body: args.body, fields, acceptance });
        if (!check.ok) {
          await writeEvent({
            projectId: project.id,
            kind: "TEMPLATE_REJECTED",
            actor: ctx.user.name,
            summary: `Spec draft "${args.title}" rejected by ${template.name} v${template.version}`,
            payload: { violations: check.violations, token: ctx.token.prefix },
          });
          return refuse(
            `Spec draft rejected by ${template.name} v${template.version}: ${check.violations
              .map((v) => v.message)
              .join(" ")}`,
            { violations: check.violations },
          );
        }
        const spec = await prisma.spec.create({
          data: {
            projectId: project.id,
            issueId: issue?.id ?? null,
            title: args.title,
            body: args.body,
            status: "SUBMITTED",
          },
        });
        await writeEvent({
          projectId: project.id,
          kind: "STATUS_REPORTED",
          actor: ctx.user.name,
          summary: `Spec "${args.title}" submitted${issue ? ` for ${issue.handle}` : ""} via MCP`,
          payload: { specId: spec.id, issueHandle: issue?.handle ?? null, token: ctx.token.prefix },
        });
        return succeed(`Spec "${args.title}" submitted for review.`, {
          id: spec.id,
          title: spec.title,
          status: spec.status,
          issue: issue?.handle ?? null,
        });
      }),
  );
}

function registerHarnessPublish(server: McpServer, ctx: AuthContext): void {
  server.registerTool(
    "stack_harness_publish",
    {
      title: "Publish a harness version",
      description:
        "Publish a DRAFT version of a harness pack: sets status PUBLISHED, publisher, timestamp and checksum. Only a DRAFT can be published.",
      inputSchema: {
        project: z.string().describe("Project key, e.g. ACME"),
        packName: z.string().describe("Harness pack name, e.g. miracle-standards"),
        version: z.string().describe("Version to publish, e.g. 0.2.0 — must exist as DRAFT"),
        notes: z.string().optional().describe("Release notes for this version"),
      },
    },
    async (args) =>
      runTool("stack_harness_publish", ctx, async () => {
        const project = await requireProject(ctx, args.project);
        const pack = await prisma.harnessPack.findFirst({
          where: { projectId: project.id, name: args.packName },
          include: { versions: { where: { version: args.version }, include: { components: true } } },
        });
        if (!pack) throw new Refusal(`no harness pack "${args.packName}" in ${project.key}`);
        const target = pack.versions[0];
        if (!target) {
          throw new Refusal(
            `no version "${args.version}" of ${args.packName}; ask the portal admin to create the DRAFT first`,
          );
        }
        if (target.status === "PUBLISHED") {
          throw new Refusal(`${args.packName} ${args.version} is already published`);
        }
        if (target.status !== "DRAFT") {
          throw new Refusal(`${args.packName} ${args.version} is ${target.status}; only a DRAFT can be published`);
        }
        if (target.components.length === 0) {
          throw new Refusal(`${args.packName} ${args.version} has no components; add them in the portal first`);
        }
        // Same convention as the seeded packs: sha256 over sorted "path:sha256(content)" lines.
        const checksum = sha256(
          target.components.map((c) => `${c.path}:${sha256(c.content)}`).sort().join("\n"),
        );
        const publishedAt = new Date();
        await prisma.harnessVersion.update({
          where: { id: target.id },
          data: {
            status: "PUBLISHED",
            publishedAt,
            publishedById: ctx.user.id,
            checksum,
            ...(args.notes ? { notes: args.notes } : {}),
          },
        });
        await writeEvent({
          projectId: project.id,
          kind: "HARNESS_INSTALLED",
          actor: ctx.user.name,
          summary: `${args.packName} ${args.version} published by ${ctx.user.name} via MCP`,
          payload: { packName: args.packName, version: args.version, checksum, token: ctx.token.prefix },
        });
        return succeed(`Published ${args.packName} ${args.version} (checksum ${checksum.slice(0, 12)}…).`, {
          packName: args.packName,
          version: args.version,
          checksum,
          publishedAt: publishedAt.toISOString(),
          components: target.components.length,
        });
      }),
  );
}

// ---------------------------------------------------------------------------
// The single role table: registration and the whoami tool list both read it.
// ---------------------------------------------------------------------------

const TOOL_SPECS: readonly ToolSpec[] = [
  { name: "stack_whoami", minRole: "CLIENT", register: registerWhoami },
  { name: "stack_project_list", minRole: "CLIENT", register: registerProjectList },
  { name: "stack_project_detect", minRole: "CLIENT", register: registerProjectDetect },
  { name: "stack_issue_list", minRole: "CLIENT", register: registerIssueList },
  { name: "stack_issue_get", minRole: "CLIENT", register: registerIssueGet },
  { name: "stack_wave_list", minRole: "CLIENT", register: registerWaveList },
  { name: "stack_template_get", minRole: "CLIENT", register: registerTemplateGet },
  { name: "stack_harness_current", minRole: "CLIENT", register: registerHarnessCurrent },
  { name: "stack_harness_download_url", minRole: "CLIENT", register: registerHarnessDownloadUrl },
  { name: "stack_spec_get", minRole: "CLIENT", register: registerSpecGet },
  { name: "stack_issue_claim", minRole: "DEVELOPER", register: registerIssueClaim },
  { name: "stack_issue_report_status", minRole: "DEVELOPER", register: registerIssueReportStatus },
  { name: "stack_evidence_append", minRole: "DEVELOPER", register: registerEvidenceAppend },
  { name: "stack_issue_create", minRole: "LEAD", register: registerIssueCreate },
  { name: "stack_wave_create", minRole: "LEAD", register: registerWaveCreate },
  { name: "stack_spec_submit", minRole: "LEAD", register: registerSpecSubmit },
  { name: "stack_harness_publish", minRole: "LEAD", register: registerHarnessPublish },
];

export function toolsForRole(role: Role): string[] {
  return TOOL_SPECS.filter((spec) => ROLE_RANK[role] >= ROLE_RANK[spec.minRole]).map(
    (spec) => spec.name,
  );
}

export function createStackMcpServer(ctx: AuthContext): McpServer {
  const server = new McpServer({ name: "stack-mcp", version: MCP_VERSION });
  for (const spec of TOOL_SPECS) {
    if (ROLE_RANK[ctx.role] >= ROLE_RANK[spec.minRole]) spec.register(server, ctx);
  }
  registerTemplateResource(server);
  registerProjectContextResource(server, ctx);
  registerHarnessManifestResource(server, ctx);
  registerPrompts(server);
  return server;
}

export const TOOL_COUNT = TOOL_SPECS.length;

// ---------------------------------------------------------------------------
// Resources — the exposed library surface
// ---------------------------------------------------------------------------

function templateVariable(variables: Record<string, string | string[]>, name: string): string {
  const raw = variables[name];
  return (Array.isArray(raw) ? raw[0] : raw ?? "").toLowerCase();
}

function registerTemplateResource(server: McpServer): void {
  server.registerResource(
    "stack-templates",
    new ResourceTemplate("stack://templates/{kind}", {
      list: async () => {
        const resources = [];
        for (const kind of ["issue", "spec", "wave"] as const) {
          const template = await activeTemplate(kind.toUpperCase() as TemplateKind);
          if (!template) continue;
          resources.push({
            uri: `stack://templates/${kind}`,
            name: `${kind} template`,
            description: `${template.name} v${template.version} — the active ${kind.toUpperCase()} template every submission is checked against`,
            mimeType: "text/markdown",
          });
        }
        return { resources };
      },
      complete: { kind: () => ["issue", "spec", "wave"] },
    }),
    {
      description:
        "Active Stack AI templates (issue, spec, wave): the JSON definition every submission is checked against, plus a markdown skeleton to fill.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const kindParam = templateVariable(variables, "kind");
      if (!["issue", "spec", "wave"].includes(kindParam)) {
        throw new Error(
          `unknown template kind "${kindParam}" — use stack://templates/issue, stack://templates/spec or stack://templates/wave`,
        );
      }
      const kind = kindParam.toUpperCase() as TemplateKind;
      const template = await activeTemplate(kind);
      if (!template) throw new Error(`no active ${kind} template is configured`);
      const definition = parseTemplateDefinition(template.definition);
      const text = [
        `# ${template.name} (v${template.version})`,
        "",
        `The active ${kind} template. Every new ${kind.toLowerCase()} submission is checked against it; a draft that misses a required section or field is refused with the violation list.`,
        "",
        "## Definition",
        "",
        "```json",
        JSON.stringify(definition, null, 2),
        "```",
        "",
        "## Skeleton",
        "",
        "Copy this skeleton so the submission passes the check:",
        "",
        renderTemplateSkeleton(definition),
      ].join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );
}

function registerProjectContextResource(server: McpServer, ctx: AuthContext): void {
  server.registerResource(
    "stack-project-context",
    new ResourceTemplate("stack://project/{key}/context", {
      list: async () => ({
        resources: (await visibleProjects(ctx)).map((p) => ({
          uri: `stack://project/${p.key}/context`,
          name: `${p.key} context`,
          description: `Delivery context for ${p.name}: waves, open work, handle pattern`,
          mimeType: "text/markdown",
        })),
      }),
      complete: { key: async () => (await visibleProjects(ctx)).map((p) => p.key) },
    }),
    {
      description:
        "Delivery context for a project: summary, waves, open issue counts by status, and the commit handle pattern. Read this before planning work.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const key = templateVariable(variables, "key").toUpperCase();
      const projects = await visibleProjects(ctx);
      const project = projects.find((p) => p.key.toUpperCase() === key);
      if (!project) throw new Error(`project "${key}" not found or not visible to this token`);
      const [waves, issues, packVersion] = await Promise.all([
        prisma.wave.findMany({ where: { projectId: project.id }, orderBy: { number: "asc" } }),
        prisma.issue.findMany({ where: { projectId: project.id }, select: { status: true } }),
        currentPublishedVersion(project.id),
      ]);
      const byStatus: Record<string, number> = {};
      for (const status of ISSUE_STATUSES) {
        byStatus[status] = issues.filter((i) => i.status === status).length;
      }
      const open = issues.filter((i) => i.status !== "DONE").length;
      const lines = [
        `# ${project.key} — ${project.name}`,
        "",
        `- Client: ${project.client}`,
        `- Status: ${project.status}`,
        `- Summary: ${project.summary}`,
        `- Commit handle pattern: ${project.handlePattern} — every commit message references an issue handle`,
        "",
        `## Open work (${open} open of ${issues.length})`,
        "",
        ...ISSUE_STATUSES.map((s) => `- ${ISSUE_STATUS_LABELS[s]}: ${byStatus[s]}`),
        "",
        "## Waves",
        "",
        ...(waves.length
          ? waves.map((w) => `- Wave ${w.number}: ${w.name} (${w.status}) — ${w.goal}`)
          : ["- No waves yet"]),
      ];
      if (packVersion) {
        lines.push(
          "",
          "## Harness",
          "",
          `- ${packVersion.pack.name} ${packVersion.version} (checksum ${packVersion.checksum ?? "n/a"})`,
          "- Install: stack harness install",
        );
      }
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: lines.join("\n") }] };
    },
  );
}

function registerHarnessManifestResource(server: McpServer, ctx: AuthContext): void {
  server.registerResource(
    "stack-harness-manifest",
    new ResourceTemplate("stack://harness/{key}/manifest", {
      list: async () => {
        const resources = [];
        for (const project of await visibleProjects(ctx)) {
          if (!(await currentPublishedVersion(project.id))) continue;
          resources.push({
            uri: `stack://harness/${project.key}/manifest`,
            name: `${project.key} harness manifest`,
            description: `Published harness pack for ${project.name}`,
            mimeType: "text/markdown",
          });
        }
        return { resources };
      },
      complete: { key: async () => (await visibleProjects(ctx)).map((p) => p.key) },
    }),
    {
      description:
        "Manifest of the published harness pack for a project: pack name, version, checksum and the components the CLI writes on disk.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const key = templateVariable(variables, "key").toUpperCase();
      const projects = await visibleProjects(ctx);
      const project = projects.find((p) => p.key.toUpperCase() === key);
      if (!project) throw new Error(`project "${key}" not found or not visible to this token`);
      const version = await currentPublishedVersion(project.id);
      if (!version) throw new Error(`no published harness pack for ${project.key}`);
      const manifest = {
        pack: version.pack.name,
        description: version.pack.description,
        project: project.key,
        version: version.version,
        checksum: version.checksum,
        publishedAt: version.publishedAt?.toISOString() ?? null,
        publishedBy: version.publishedBy?.name ?? null,
        notes: version.notes,
        installCommand: "stack harness install",
        components: version.components
          .slice()
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((c) => ({ kind: c.kind, path: c.path, mode: c.mode })),
      };
      const text = [
        `# Harness manifest — ${project.key}`,
        "",
        `${manifest.pack} ${manifest.version} (${manifest.components.length} components).`,
        "",
        "```json",
        JSON.stringify(manifest, null, 2),
        "```",
        "",
        "Install with: stack harness install",
      ].join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function workflowRules(handle: string): string[] {
  return [
    "1. Read the full issue with the stack_issue_get tool before touching any code.",
    "2. Restate the goal and the acceptance criteria in your own words, and list the files you expect to change.",
    `3. Every commit message must reference the issue handle, e.g. "${handle}: add line-item tax breakdown". The repository hook rejects commits without the handle.`,
    "4. Append evidence as you go with stack_evidence_append (commits, PR numbers, commands you ran).",
    `5. When the work is ready, open a PR titled with the handle ("${handle}: ...") and report it with stack_issue_report_status status=IN_REVIEW.`,
    "6. Only a person can move an issue from AWAITING_VALIDATION to DONE — never mark work validated yourself.",
  ];
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "start-issue",
    {
      title: "Start a Stack issue",
      description:
        "Kick off an issue the Miracle way: read the spec, restate the goal, commit with the issue handle and append evidence.",
      argsSchema: { handle: z.string().describe("Issue handle, e.g. STACK-104") },
    },
    async ({ handle }) => {
      const issue = await prisma.issue.findUnique({
        where: { handle },
        include: { spec: true, wave: true, project: true },
      });
      const acceptance = issue ? parseAcceptance(issue.acceptance) : [];
      const text = issue
        ? [
            `Start work on ${handle} — "${issue.title}" (${statusLabel(issue.status)}) in project ${issue.project.key}${
              issue.wave ? `, wave ${issue.wave.number} (${issue.wave.name})` : ""
            }.`,
            "",
            "Follow the Miracle workflow:",
            "",
            ...workflowRules(handle),
            issue.spec
              ? `The spec attached to this issue is available with stack_spec_get handle=${handle}; read it before coding.`
              : "No spec is attached to this issue; follow the acceptance criteria in the body.",
            "",
            "Acceptance criteria:",
            ...(acceptance.length ? acceptance.map((a) => `- [ ] ${a}`) : ["- (see the issue body)"]),
          ].join("\n")
        : [
            `Start work on ${handle}.`,
            "",
            `The issue is not visible to this token yet; call stack_issue_get handle=${handle} to read it.`,
            "",
            "Follow the Miracle workflow:",
            "",
            ...workflowRules(handle),
          ].join("\n");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    },
  );

  server.registerPrompt(
    "open-pull-request",
    {
      title: "Open a Miracle pull request",
      description:
        "The Miracle PR body skeleton for an issue: summary, changes, evidence and the acceptance checklist. The PR title must start with the issue handle.",
      argsSchema: { handle: z.string().describe("Issue handle, e.g. STACK-104") },
    },
    async ({ handle }) => {
      const issue = await prisma.issue.findUnique({ where: { handle }, include: { project: true } });
      const acceptance = issue ? parseAcceptance(issue.acceptance) : [];
      const title = issue ? `${handle}: ${issue.title}` : `${handle}`;
      const text = [
        `Open a pull request for ${title}.`,
        "",
        `The PR title must start with the issue handle ("${handle}: ...") so the portal can link the PR to the issue.`,
        "",
        "Fill this Miracle PR body skeleton:",
        "",
        "## Summary",
        "<one paragraph: what this PR changes and why, in plain language>",
        "",
        "## Changes",
        "- <file or area, one line each>",
        "",
        "## Evidence",
        `- [ ] Every commit message references ${handle}`,
        "- [ ] Tests or commands that prove the change: <paste commands and results>",
        "- [ ] Evidence appended with stack_evidence_append (kind PR_OPENED once the PR exists)",
        "",
        "## Acceptance criteria",
        ...(acceptance.length
          ? acceptance.map((a) => `- [ ] ${a}`)
          : ["- [ ] <copy the acceptance criteria from the issue>"]),
        "",
        "## Out of scope",
        "- <what this PR deliberately does not cover>",
        "",
        "When the PR is open: append evidence with stack_evidence_append and move the issue to IN_REVIEW with stack_issue_report_status.",
      ].join("\n");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    },
  );
}
