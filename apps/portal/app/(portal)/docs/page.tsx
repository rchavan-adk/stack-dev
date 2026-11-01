import Link from "next/link";
import { BookOpen, Code2, ClipboardList } from "lucide-react";
import { requireSessionUser } from "@/lib/session";

export default async function DocsPage() {
  await requireSessionUser();

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Documentation</h1>
        <p className="max-w-3xl text-sm text-base-content/60">
          How each role gets started, in full, with a worked example. The quick command-by-command
          setup lives on <Link href="/get-started" className="link link-hover">Get started</Link>.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body gap-3">
            <h2 className="card-title flex items-center gap-2 text-base">
              <Code2 size={18} /> Developer
            </h2>
            <p className="text-sm text-base-content/60">
              You write code in your own IDE with OpenCode, and Stack holds the record of what you
              were assigned and what you shipped.
            </p>
            <ul className="space-y-1 text-sm text-base-content/70">
              <li>Install the CLI from npm, log in with a token</li>
              <li>Link your repository, install the harness, wire the MCP server</li>
              <li>Claim an item, ship it on a branch, watch the card move on your PR</li>
            </ul>
            <div className="card-actions">
              <Link href="/docs/developer" className="btn btn-primary btn-sm">
                <BookOpen size={15} /> Developer guide
              </Link>
            </div>
          </div>
        </div>

        <div className="card border border-base-300 bg-base-100">
          <div className="card-body gap-3">
            <h2 className="card-title flex items-center gap-2 text-base">
              <ClipboardList size={18} /> Project planner
            </h2>
            <p className="text-sm text-base-content/60">
              You run the engagement in the portal: the project, its repository, the waves, the
              people, and the final validation of finished work.
            </p>
            <ul className="space-y-1 text-sm text-base-content/70">
              <li>Create the project, connect its GitHub repository</li>
              <li>Publish templates and harness packs</li>
              <li>Plan waves, invite developers, validate finished items on the evidence</li>
            </ul>
            <div className="card-actions">
              <Link href="/docs/planner" className="btn btn-primary btn-sm">
                <BookOpen size={15} /> Planner guide
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">How the pieces fit</h2>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Piece</th>
                  <th>Who uses it</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="stack-mono">Portal</td>
                  <td>Planners, leads, admins — in a browser</td>
                  <td className="text-base-content/70">
                    Projects, waves, issues, people, tokens, and the evidence ledger behind every
                    status.
                  </td>
                </tr>
                <tr>
                  <td className="stack-mono">stack CLI</td>
                  <td>Developers — once per machine</td>
                  <td className="text-base-content/70">
                    Login, repository link, harness install, MCP wiring, and{" "}
                    <span className="stack-mono">doctor</span> to check all of it.
                  </td>
                </tr>
                <tr>
                  <td className="stack-mono">MCP server</td>
                  <td>OpenCode, day to day</td>
                  <td className="text-base-content/70">
                    Exposes your project, issues and claim tools to the agent, authenticated by
                    your token.
                  </td>
                </tr>
                <tr>
                  <td className="stack-mono">Harness pack</td>
                  <td>Both — files in the repository</td>
                  <td className="text-base-content/70">
                    AGENTS.md, templates and git hooks that enforce the standards locally.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
