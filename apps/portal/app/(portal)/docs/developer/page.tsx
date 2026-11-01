import Link from "next/link";
import {
  CheckCircle2,
  GitBranch,
  KeyRound,
  Package,
  Plug,
  Radar,
  Stethoscope,
  Terminal,
} from "lucide-react";
import { requireSessionUser } from "@/lib/session";
import { CopyButton } from "@/components/copy-button";

const SETUP = [
  ["npm i -g @rchavan.miracle/stack-ai", "installs the CLI (Node 20+)"],
  ["stack login", "paste the token from /settings/tokens"],
  ["stack project detect", "links this repository to your project"],
  ["stack harness install", "writes AGENTS.md, templates and git hooks"],
  ["stack mcp install --agent opencode", "wires the MCP server into opencode.json"],
  ["stack doctor", "all seven checks green"],
];

const LOOP = [
  ["stack issues --mine", "what is assigned to you right now"],
  ["stack claim STACK-106", "marks it in progress, records this session"],
  ["work on a branch", "OpenCode reads the issue through the stack MCP server"],
  ["commit with the handle", "STACK-106 in the message — the hook rejects it otherwise"],
  ["push and open the PR", "the handle in the PR title moves the card to in review"],
  ["merge", "the card moves to awaiting validation; your lead validates it"],
];

export default async function DeveloperGuidePage() {
  await requireSessionUser();

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Developer guide</h1>
        <p className="max-w-3xl text-sm text-base-content/60">
          From a clean machine to merged work, in your own IDE. The copy-ready command blocks live
          on <Link href="/get-started" className="link link-hover">Get started</Link>; this page is
          the full walkthrough with an example.
        </p>
      </header>

      <section className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">What you need</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-base-content/70">
            <li>
              <strong>OpenCode</strong> — the IDE agent the harness is written for.
            </li>
            <li>
              <strong>Node 20 or newer</strong> — for the Stack CLI.
            </li>
            <li>
              <strong>A Stack account</strong> — a lead adds you to a project, you open the invite
              link to set a password.
            </li>
            <li>
              <strong>A developer token</strong> — yours alone, created at{" "}
              <Link href="/settings/tokens" className="link link-hover">/settings/tokens</Link>. It
              carries your role everywhere the CLI and the agent go.
            </li>
          </ul>
        </div>
      </section>

      <section className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3">
          <h2 className="card-title flex items-center gap-2 text-base">
            <Terminal size={18} /> One-time setup, per machine
          </h2>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Command</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {SETUP.map(([command, what]) => (
                  <tr key={command}>
                    <td>
                      <div className="flex items-center gap-2">
                        <kbd className="kbd kbd-sm stack-mono">{command}</kbd>
                        <CopyButton text={command} className="btn-xs" />
                      </div>
                    </td>
                    <td className="text-base-content/70">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-base-content/50">
            Run <span className="stack-mono">detect</span> and everything after it inside your
            repository. Each step explains itself on{" "}
            <Link href="/get-started" className="link link-hover">Get started</Link>.
          </p>
        </div>
      </section>

      <section className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3">
          <h2 className="card-title flex items-center gap-2 text-base">
            <GitBranch size={18} /> The daily loop
          </h2>
          <ol className="space-y-2">
            {LOOP.map(([command, what], index) => (
              <li
                key={command}
                className="flex flex-wrap items-baseline gap-2 rounded-box border border-base-300 bg-base-200 p-2 text-sm"
              >
                <span className="badge badge-ghost badge-xs">{index + 1}</span>
                <span className="stack-mono font-medium">{command}</span>
                <span className="text-base-content/60">— {what}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="card border border-secondary/40 bg-base-100">
        <div className="card-body gap-4">
          <h2 className="card-title flex items-center gap-2 text-base">
            <CheckCircle2 size={18} /> Worked example: finishing STACK-106
          </h2>
          <p className="text-sm text-base-content/60">
            The item exists, it is assigned to you, and the machine is set up. This is the whole
            loop, as it actually plays out.
          </p>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">1. See it and claim it</h3>
            <div className="flex items-start gap-2">
              <div className="mockup-code w-fit text-xs">
                <pre data-prefix="$">
                  <code>stack issues --mine</code>
                </pre>
                <pre data-prefix="$">
                  <code>stack claim STACK-106</code>
                </pre>
                <pre data-prefix="$">
                  <code>git switch -c stack-106-quarterly-exports</code>
                </pre>
              </div>
              <CopyButton text="stack claim STACK-106" />
            </div>
            <p className="text-xs text-base-content/50">
              The claim records the session (the portal marks the item{" "}
              <span className="stack-mono">IN PROGRESS</span>); the branch name is yours to choose.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">2. Work it with OpenCode</h3>
            <p className="text-sm text-base-content/70">
              Tell OpenCode: <em>&ldquo;finish STACK-106&rdquo;</em>. Through the stack MCP server
              it reads the issue and the project context; from the repository it reads{" "}
              <span className="stack-mono">AGENTS.md</span> and the templates the harness
              installed. It writes the code; you review it as always.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">3. Commit — the handle is not optional</h3>
            <div className="flex items-start gap-2">
              <div className="mockup-code w-fit text-xs">
                <pre data-prefix="$">
                  <code>git commit -m "STACK-106 export the quarterly spend report"</code>
                </pre>
                <pre data-prefix="✗">
                  <code>git commit -m "export the report"</code>
                </pre>
                <pre data-prefix="">
                  <code>commit-msg: no handle matching STACK-\d+ in message</code>
                </pre>
              </div>
              <CopyButton text='git commit -m "STACK-106 export the quarterly spend report"' />
            </div>
            <p className="text-xs text-base-content/50">
              The second commit never lands — the hook installed by{" "}
              <span className="stack-mono">stack harness install</span> rejects it locally, and the
              portal would reject the event again server-side.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">4. Push and open the PR</h3>
            <p className="text-sm text-base-content/70">
              Push the branch and open a pull request titled{" "}
              <span className="stack-mono">STACK-106 Export the quarterly spend report</span>. The
              handle in the title is what the webhook reads.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">5. Watch the card move</h3>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>The card</th>
                    <th>Evidence recorded</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>you claim it</td>
                    <td className="stack-mono">IN PROGRESS</td>
                    <td className="text-base-content/70">claim, actor: you</td>
                  </tr>
                  <tr>
                    <td>the PR opens</td>
                    <td className="stack-mono">IN REVIEW</td>
                    <td className="text-base-content/70">PR_OPENED, actor: github-app</td>
                  </tr>
                  <tr>
                    <td>commits land on the branch</td>
                    <td className="stack-mono">IN REVIEW</td>
                    <td className="text-base-content/70">COMMIT, one per handle-bearing commit</td>
                  </tr>
                  <tr>
                    <td>the PR merges</td>
                    <td className="stack-mono">AWAITING VALIDATION</td>
                    <td className="text-base-content/70">PR_MERGED, actor: github-app</td>
                  </tr>
                  <tr>
                    <td>your lead validates</td>
                    <td className="stack-mono">DONE</td>
                    <td className="text-base-content/70">validation, actor: the lead</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-base-content/50">
              Nothing moves on a claim. Every step after yours is a git event your lead can open on
              the project&apos;s evidence page.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link href="/docs" className="btn btn-ghost btn-sm">All documentation</Link>
        <Link href="/docs/planner" className="btn btn-ghost btn-sm">Planner guide</Link>
        <Link href="/get-started" className="btn btn-ghost btn-sm">Get started</Link>
      </div>
    </div>
  );
}
