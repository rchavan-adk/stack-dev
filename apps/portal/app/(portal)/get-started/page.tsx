import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import Link from "next/link";
import {
  CheckCircle2,
  ClipboardList,
  KeyRound,
  Package,
  Plug,
  Radar,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { prisma } from "@stack/db";
import { requireSessionUser } from "@/lib/session";
import { publishedPack } from "@/lib/queries";
import { mcpEndpointUrl, portalBaseUrl } from "@/lib/urls";
import { CopyButton } from "@/components/copy-button";

/** The portal runs from apps/portal, so the workspace root is two levels up. */
function resolveWorkspaceRoot(): string {
  const candidates = [resolve(process.cwd(), "..", ".."), process.cwd()];
  return (
    candidates.find((dir) => existsSync(join(dir, "cli", "stack", "bin", "stack.mjs"))) ??
    candidates[0]
  );
}

const STEPS = [
  { id: "step-1", label: "OpenCode" },
  { id: "step-2", label: "Stack CLI" },
  { id: "step-3", label: "Login" },
  { id: "step-4", label: "MCP" },
  { id: "step-5", label: "Detect" },
  { id: "step-6", label: "Harness" },
  { id: "step-7", label: "Doctor" },
];

const DOCTOR_CHECKS = [
  { label: "credentials present and valid", detail: "the saved token is accepted by the portal", fix: "stack login" },
  { label: "repository linked to a project", detail: ".stack/project.json exists", fix: "stack project detect" },
  { label: "stack.toml matches the published pack", detail: "the installed version equals the published one", fix: "stack harness install --force" },
  { label: ".stack/pack checksum matches", detail: "the extracted pack is byte-identical to what was published", fix: "stack harness install --force" },
  { label: "git hooks installed and executable", detail: "commit-msg and pre-push present with mode 755", fix: "stack harness install --force" },
  { label: "Stack MCP server reachable", detail: "the MCP health endpoint answers", fix: "npm run dev:mcp" },
  { label: "an item is claimed in this session", detail: ".stack/session.json holds a handle", fix: "stack claim STACK-101" },
];

const HARNESS_WRITES = [
  [".stack/pack/", "the extracted pack components, file modes preserved"],
  ["stack.toml", "rendered from the pack's stack.toml.template"],
  ["AGENTS.md", "rendered from the pack's agents/AGENTS.md"],
  [".git/hooks/commit-msg", "blocks commits whose message carries no handle"],
  [".git/hooks/pre-push", "blocks pushes to protected branches"],
];

export default async function GetStartedPage() {
  const user = await requireSessionUser();

  const workspaceRoot = resolveWorkspaceRoot();
  const stackBin = join(workspaceRoot, "cli", "stack", "bin", "stack.mjs");
  const mcpStdio = join(workspaceRoot, "apps", "mcp", "src", "stdio.ts");

  const portalUrl = portalBaseUrl();
  const mcpUrl = mcpEndpointUrl();

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { project: { select: { id: true, key: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const projectsWithPacks = await Promise.all(
    memberships.map(async (membership) => ({
      project: membership.project,
      published: await publishedPack(membership.project.id),
    })),
  );

  const opencodeRemote = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        stack: {
          type: "remote",
          url: mcpUrl,
          enabled: true,
          headers: { Authorization: "Bearer stk_dev_…" },
        },
      },
    },
    null,
    2,
  );

  const opencodeLocal = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        stack: {
          type: "local",
          command: ["npx", "tsx", mcpStdio],
          environment: { STACK_TOKEN: "stk_dev_…" },
          enabled: true,
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Get started</h1>
        <p className="max-w-3xl text-sm text-base-content/60">
          From a clean machine to enforced work in seven commands. Every block is copy-ready — the
          portal runs no AI itself, it holds the record and the rules.
        </p>
      </header>

      <ul className="steps steps-vertical w-full lg:steps-horizontal">
        {STEPS.map((step) => (
          <li key={step.id} className="step step-primary">
            <a href={`#${step.id}`} className="text-xs">
              {step.label}
            </a>
          </li>
        ))}
      </ul>

      <div className="space-y-6">
        {/* 1. OpenCode */}
        <div id="step-1" className="card scroll-mt-24 border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <div className="flex items-center gap-2">
              <span className="badge badge-secondary badge-sm">1</span>
              <h2 className="card-title text-base">Install OpenCode</h2>
            </div>
            <p className="text-sm text-base-content/60">
              The IDE agent this harness is written for. The version installed locally is{" "}
              <span className="stack-mono">1.18.30</span>.
            </p>
            <div className="flex items-start gap-2">
              <div className="mockup-code w-fit text-xs">
                <pre data-prefix="$">
                  <code>curl -fsSL https://opencode.ai/install | bash</code>
                </pre>
                <pre data-prefix="$">
                  <code>opencode --version</code>
                </pre>
              </div>
              <CopyButton text="curl -fsSL https://opencode.ai/install | bash" />
            </div>
          </div>
        </div>

        {/* 2. Stack CLI */}
        <div id="step-2" className="card scroll-mt-24 border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <div className="flex items-center gap-2">
              <span className="badge badge-secondary badge-sm">2</span>
              <h2 className="card-title text-base">Install the Stack CLI</h2>
            </div>
            <p className="text-sm text-base-content/60">
              Installs globally from npm. From a local checkout of the portal&apos;s repository it
              also runs straight from the workspace — no install needed, so alias it and the rest
              of this page works verbatim.
            </p>
            <div className="flex items-start gap-2">
              <div className="mockup-code w-fit text-xs">
                <pre data-prefix="$">
                  <code>npm i -g stack-ai</code>
                </pre>
                <pre data-prefix="#">
                  <code>local checkout: run it from the workspace instead</code>
                </pre>
                <pre data-prefix="$">
                  <code>node {stackBin} --help</code>
                </pre>
                <pre data-prefix="$">
                  <code>alias stack="node {stackBin}"</code>
                </pre>
              </div>
              <CopyButton text={`alias stack="node ${stackBin}"`} label="Copy alias" />
            </div>
            <p className="text-xs text-base-content/50">
              Put the alias in your shell profile. Everything below assumes{" "}
              <code className="stack-mono">stack</code> works in any directory.
            </p>
          </div>
        </div>

        {/* 3. Login */}
        <div id="step-3" className="card scroll-mt-24 border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <div className="flex items-center gap-2">
              <span className="badge badge-secondary badge-sm">3</span>
              <h2 className="card-title flex items-center gap-2 text-base">
                <KeyRound size={18} /> Log in
              </h2>
            </div>
            <p className="text-sm text-base-content/60">
              <code className="stack-mono">stack login</code> asks for a token without echoing it
              and validates it before saving. Create yours first:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/settings/tokens" className="btn btn-secondary btn-sm">
                Open /settings/tokens
              </Link>
              <span className="text-xs text-base-content/50">
                the exact page <code className="stack-mono">stack login</code> prints
              </span>
            </div>
            <div className="flex items-start gap-2">
              <div className="mockup-code w-fit text-xs">
                <pre data-prefix="$">
                  <code>stack login</code>
                </pre>
                <pre data-prefix="$">
                  <code>stack login --token stk_dev_…</code>
                </pre>
              </div>
              <CopyButton text="stack login" />
            </div>
            <p className="text-xs text-base-content/50">
              The token is stored at <code className="stack-mono">~/.stack/credentials.json</code>{" "}
              (mode 0600). Its role decides what the MCP allows.
            </p>
          </div>
        </div>

        {/* 4. MCP */}
        <div id="step-4" className="card scroll-mt-24 border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <div className="flex items-center gap-2">
              <span className="badge badge-secondary badge-sm">4</span>
              <h2 className="card-title flex items-center gap-2 text-base">
                <Plug size={18} /> Wire the MCP server into OpenCode
              </h2>
            </div>
            <p className="text-sm text-base-content/60">
              One command writes the entry into <code className="stack-mono">opencode.json</code>{" "}
              for you (remote mode by default). The two shapes it can write:
            </p>
            <div className="flex items-start gap-2">
              <div className="mockup-code w-fit text-xs">
                <pre data-prefix="$">
                  <code>stack mcp install --agent opencode</code>
                </pre>
                <pre data-prefix="$">
                  <code>stack mcp install --agent opencode --mode local</code>
                </pre>
              </div>
              <CopyButton text="stack mcp install --agent opencode" />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Remote (default)</h3>
                <p className="text-xs text-base-content/50">
                  The shared MCP server authenticates the token on every call.
                </p>
                <div className="mockup-code overflow-x-auto text-xs">
                  <pre>
                    <code>{opencodeRemote}</code>
                  </pre>
                </div>
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Local stdio</h3>
                <p className="text-xs text-base-content/50">
                  OpenCode runs the MCP server in-process; needs the workspace built
                  (<code className="stack-mono">npm run dev:mcp</code>).
                </p>
                <div className="mockup-code overflow-x-auto text-xs">
                  <pre>
                    <code>{opencodeLocal}</code>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 5. Detect */}
        <div id="step-5" className="card scroll-mt-24 border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <div className="flex items-center gap-2">
              <span className="badge badge-secondary badge-sm">5</span>
              <h2 className="card-title flex items-center gap-2 text-base">
                <Radar size={18} /> Link your repository
              </h2>
            </div>
            <div className="flex items-start gap-2">
              <div className="mockup-code w-fit text-xs">
                <pre data-prefix="$">
                  <code>cd &lt;your repo&gt; &amp;&amp; stack project detect</code>
                </pre>
              </div>
              <CopyButton text="stack project detect" />
            </div>
            <p className="text-sm text-base-content/60">Two outcomes:</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-box border border-success/40 bg-base-200 p-3 text-sm">
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  <CheckCircle2 size={16} className="text-success" /> Registered
                </div>
                <p className="text-base-content/70">
                  The repo matched a project. Pick the project by number and the CLI writes{" "}
                  <code className="stack-mono">.stack/project.json</code> — portal and
                  MCP URLs included.
                </p>
              </div>
              <div className="rounded-box border border-warning/40 bg-base-200 p-3 text-sm">
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  <ClipboardList size={16} className="text-warning" /> Not registered
                </div>
                <p className="text-base-content/70">
                  The CLI prints the registration URL,{" "}
                  <code className="stack-mono">/projects/new?repo=&lt;name&gt;</code>. Open it,
                  create the project (a lead approves), then re-run detect or link straight away
                  with <code className="stack-mono">stack link &lt;KEY&gt;</code>.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 6. Harness */}
        <div id="step-6" className="card scroll-mt-24 border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <div className="flex items-center gap-2">
              <span className="badge badge-secondary badge-sm">6</span>
              <h2 className="card-title flex items-center gap-2 text-base">
                <Package size={18} /> Install the harness pack
              </h2>
            </div>
            <div className="flex items-start gap-2">
              <div className="mockup-code w-fit text-xs">
                <pre data-prefix="$">
                  <code>stack harness install</code>
                </pre>
              </div>
              <CopyButton text="stack harness install" />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                Published right now, for your projects
              </h3>
              {projectsWithPacks.length === 0 && (
                <div className="alert alert-info text-sm">
                  <span>You are not on a project yet — ask a lead to add you.</span>
                </div>
              )}
              {projectsWithPacks.map(({ project, published }) =>
                published ? (
                  <div
                    key={project.id}
                    className="flex flex-wrap items-center gap-2 rounded-box border border-base-300 bg-base-200 p-3 text-sm"
                  >
                    <span className="badge badge-secondary badge-sm stack-mono">{project.key}</span>
                    <span className="stack-mono font-medium">{published.pack.name}</span>
                    <span className="badge badge-success badge-sm stack-mono">
                      {published.version.version}
                    </span>
                    <span className="badge badge-ghost badge-sm stack-mono">
                      {published.version.checksum
                        ? `${published.version.checksum.slice(0, 12)}…`
                        : "no checksum"}
                    </span>
                    <span className="badge badge-ghost badge-sm">
                      {published.version.components.length} components
                    </span>
                  </div>
                ) : (
                  <div
                    key={project.id}
                    className="flex flex-wrap items-center gap-2 rounded-box border border-base-300 bg-base-200 p-3 text-sm"
                  >
                    <span className="badge badge-ghost badge-sm stack-mono">{project.key}</span>
                    <span className="text-base-content/60">
                      no published pack yet — a lead publishes one under Harness packs
                    </span>
                  </div>
                ),
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Written</th>
                    <th>What it is</th>
                  </tr>
                </thead>
                <tbody>
                  {HARNESS_WRITES.map(([path, what]) => (
                    <tr key={path}>
                      <td>
                        <kbd className="kbd kbd-sm stack-mono">{path}</kbd>
                      </td>
                      <td className="text-base-content/70">{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-base-content/50">
              Re-run with <code className="stack-mono">--force</code> after a new version is
              published; <code className="stack-mono">stack doctor</code> compares the installed
              checksum against the portal&apos;s.
            </p>
          </div>
        </div>

        {/* 7. Doctor */}
        <div id="step-7" className="card scroll-mt-24 border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <div className="flex items-center gap-2">
              <span className="badge badge-secondary badge-sm">7</span>
              <h2 className="card-title flex items-center gap-2 text-base">
                <Stethoscope size={18} /> Check everything
              </h2>
            </div>
            <div className="flex items-start gap-2">
              <div className="mockup-code w-fit text-xs">
                <pre data-prefix="$">
                  <code>stack doctor</code>
                </pre>
              </div>
              <CopyButton text="stack doctor" />
            </div>
            <p className="text-sm text-base-content/60">
              A numbered checklist over this machine and this repo. It exits non-zero when a
              required check fails, and every failure prints the exact command that fixes it:
            </p>
            <ol className="space-y-2">
              {DOCTOR_CHECKS.map((check, index) => (
                <li
                  key={check.label}
                  className="flex flex-wrap items-baseline gap-2 rounded-box border border-base-300 bg-base-200 p-2 text-sm"
                >
                  <span className="badge badge-ghost badge-xs">{index + 1}</span>
                  <span className="font-medium">{check.label}</span>
                  <span className="text-base-content/60">— {check.detail}</span>
                  <span className="ml-auto text-xs text-base-content/50">
                    fix: <code className="stack-mono">{check.fix}</code>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* What gets enforced */}
        <div className="card border border-secondary/40 bg-base-100">
          <div className="card-body gap-4">
            <h2 className="card-title flex items-center gap-2 text-base">
              <ShieldCheck size={18} /> What gets enforced
            </h2>
            <ul className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="badge badge-primary badge-sm mt-0.5 shrink-0">commit</span>
                <span>
                  A commit whose message carries no handle matching the project pattern is rejected
                  locally by <code className="stack-mono">commit-msg</code> — and rejected again
                  server-side when the event arrives.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="badge badge-primary badge-sm mt-0.5 shrink-0">push</span>
                <span>
                  Pushes to protected branches are blocked by <code className="stack-mono">pre-push</code>{" "}
                  until the work has passed review.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="badge badge-primary badge-sm mt-0.5 shrink-0">people</span>
                <span>
                  Only a person can validate. Agents and the CLI move work up to{" "}
                  <em>awaiting validation</em>; the final <em>done</em> is human, with the evidence
                  attached.
                </span>
              </li>
            </ul>
            <div className="alert alert-soft text-sm">
              <span>
                The same MCP token carries your role. Leads get the planner tools on top —
                submitting plans, waves and specs, and approving them — through the same
                Authorization header. Use the persona switcher on the{" "}
                <Link href="/login" className="link">
                  login screen
                </Link>{" "}
                to see the portal through a lead&apos;s eyes.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
