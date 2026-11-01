import Link from "next/link";
import { CheckCircle2, Github, LayoutTemplate, Package, Users, Waves } from "lucide-react";
import { requireSessionUser } from "@/lib/session";

const ONBOARD_STEPS = [
  ["Create the project", "/projects/new", "key ONBOARD, repo https://github.com/acme/portal.git — a GitHub repo sends you to the GitHub App setup page"],
  ["Connect GitHub", "the project's GitHub setup page", "create the App with the prefilled manifest, install it on the repository, paste the App ID back"],
  ["Plan wave 1", "the project's Waves tab", "a plan and a wave named Discovery, with STACK-101…103 matching the issue template"],
  ["Invite the developer", "People (admin)", "invite by email with the DEVELOPER role — they set a password from the invite link"],
  ["Watch and validate", "the project's Evidence tab", "STACK-101 moves on git events; the final DONE is yours"],
];

export default async function PlannerGuidePage() {
  await requireSessionUser();

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Project planner guide</h1>
        <p className="max-w-3xl text-sm text-base-content/60">
          For engagement leads and platform admins. You stand the project up, connect its
          repository, plan the waves, bring the people in, and validate finished work on the
          evidence.
        </p>
      </header>

      <section className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">What you need</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-base-content/70">
            <li>
              <strong>A portal account with the LEAD or ADMIN role</strong> — an administrator
              invites you; you set your password from the invite link.
            </li>
            <li>
              <strong>The repository</strong> — a GitHub repository the project will track. The
              developers keep their push access exactly as it is today.
            </li>
          </ul>
        </div>
      </section>

      <section className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3">
          <h2 className="card-title flex items-center gap-2 text-base">
            <Github size={18} /> Stand the project up
          </h2>
          <ol className="list-inside list-decimal space-y-1 text-sm text-base-content/70">
            <li>
              Open <Link href="/projects/new" className="link link-hover">/projects/new</Link> and
              give the project a key, a name and the repository URL.
            </li>
            <li>
              A github.com repository makes the portal generate a per-repository webhook secret and
              send you to the project&apos;s GitHub App setup page.
            </li>
            <li>
              On that page: create the App with the prefilled manifest (one click on GitHub),
              install it on the repository, and paste the App ID back.
            </li>
            <li>
              GitHub says hello with a <span className="stack-mono">ping</span> the moment the App
              is installed — the portal answers and records nothing else.
            </li>
          </ol>
          <p className="text-xs text-base-content/50">
            From then on, pushes and pull requests on that repository move work in this portal. The
            App is read-only: contents, pull requests and metadata. No code is stored.
          </p>
        </div>
      </section>

      <section className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3">
          <h2 className="card-title flex items-center gap-2 text-base">
            <LayoutTemplate size={18} /> Templates and harness packs
          </h2>
          <ul className="space-y-2 text-sm text-base-content/70">
            <li>
              The Miracle templates ship installed — every issue and spec submitted to the portal
              must match them, or it comes back with the reason. Edit them under{" "}
              <Link href="/admin/templates" className="link link-hover">Templates</Link> (admin).
            </li>
            <li>
              The harness pack — AGENTS.md, the templates developers&apos; agents read, and the git
              hooks — is versioned under{" "}
              <Link href="/admin/harness" className="link link-hover">Harness packs</Link> (admin).
              The default pack is already published.
            </li>
            <li>
              Publish a new version and the developers&apos;{" "}
              <span className="stack-mono">stack doctor</span> flags the mismatch; they re-run{" "}
              <span className="stack-mono">stack harness install --force</span> and are on the new
              rules.
            </li>
          </ul>
        </div>
      </section>

      <section className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3">
          <h2 className="card-title flex items-center gap-2 text-base">
            <Waves size={18} /> Plan the work
          </h2>
          <ul className="space-y-2 text-sm text-base-content/70">
            <li>
              On the project page, submit the plan and its waves. Each wave holds the items that
              ship together.
            </li>
            <li>
              Issues must match the template — the handle pattern (like{" "}
              <span className="stack-mono">STACK-101</span>) comes from the project.
            </li>
            <li>
              Assign items to developers; they see them with{" "}
              <span className="stack-mono">stack issues --mine</span> and through their agent.
            </li>
          </ul>
        </div>
      </section>

      <section className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3">
          <h2 className="card-title flex items-center gap-2 text-base">
            <Users size={18} /> Bring the people in
          </h2>
          <ul className="space-y-2 text-sm text-base-content/70">
            <li>
              Invite by email with a role under{" "}
              <Link href="/admin/people" className="link link-hover">People</Link> (admin): LEAD to
              plan and validate, DEVELOPER to pull work, CLIENT to watch.
            </li>
            <li>
              They open the invite link to set a password — the portal sends no email, so the link
              is how they get in.
            </li>
            <li>
              Each developer creates their own token at /settings/tokens and follows the{" "}
              <Link href="/docs/developer" className="link link-hover">developer guide</Link>.
            </li>
          </ul>
        </div>
      </section>

      <section className="card border border-secondary/40 bg-base-100">
        <div className="card-body gap-4">
          <h2 className="card-title flex items-center gap-2 text-base">
            <CheckCircle2 size={18} /> Worked example: standing up ONBOARD
          </h2>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Where</th>
                  <th>What you do</th>
                </tr>
              </thead>
              <tbody>
                {ONBOARD_STEPS.map(([step, where, what]) => (
                  <tr key={step}>
                    <td className="font-medium">{step}</td>
                    <td className="text-base-content/60">{where}</td>
                    <td className="text-base-content/70">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">How STACK-101 plays out</h3>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>The card</th>
                    <th>Moved by</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="stack-mono">PLANNED</td>
                    <td>you — the wave submission</td>
                    <td className="text-base-content/70">the plan, the wave, the template-passing issue</td>
                  </tr>
                  <tr>
                    <td className="stack-mono">IN PROGRESS</td>
                    <td>the developer claims it</td>
                    <td className="text-base-content/70">claim, actor: the developer</td>
                  </tr>
                  <tr>
                    <td className="stack-mono">IN REVIEW</td>
                    <td>the PR opens</td>
                    <td className="text-base-content/70">PR_OPENED, actor: github-app</td>
                  </tr>
                  <tr>
                    <td className="stack-mono">AWAITING VALIDATION</td>
                    <td>the PR merges</td>
                    <td className="text-base-content/70">PR_MERGED, actor: github-app</td>
                  </tr>
                  <tr>
                    <td className="stack-mono">DONE</td>
                    <td>you validate it</td>
                    <td className="text-base-content/70">validation with the full evidence trail attached</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-base-content/50">
              You never move a card on trust — you open the evidence page and read the commits, the
              PR and the merge behind the status, then you validate.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link href="/docs" className="btn btn-ghost btn-sm">All documentation</Link>
        <Link href="/docs/developer" className="btn btn-ghost btn-sm">Developer guide</Link>
        <Link href="/get-started" className="btn btn-ghost btn-sm">Get started</Link>
      </div>
    </div>
  );
}
