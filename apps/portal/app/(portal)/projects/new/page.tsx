import Link from "next/link";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { RepoSourceFields } from "@/components/repo-source-fields";
import { gatewayBaseUrl } from "@/lib/urls";
import { registerProject } from "../actions";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const user = await requireSessionUser();
  const { repo } = await searchParams;

  if (!canAdminister(user.role)) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="alert alert-warning">
          <span>
            Registering a project is a lead or admin action. Ask your engagement lead to register{" "}
            {repo ? <span className="stack-mono">{repo}</span> : "the repository"}.
          </span>
        </div>
      </div>
    );
  }

  const suggestedKey = repo
    ? repo.split("/").pop()?.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() ?? ""
    : "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Register a project</h1>
        <p className="text-sm text-base-content/60">
          This is where an unregistered repository lands. The CLI sends developers here when{" "}
          <span className="stack-mono">stack project detect</span> finds no match.
        </p>
      </header>

      {repo && (
        <div className="alert alert-info alert-soft">
          <span>
            A developer tried to use <span className="stack-mono">{repo}</span>. Registering it here
            links the repository to an engagement.
          </span>
        </div>
      )}

      <form action={registerProject} className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Project key</legend>
              <input
                name="key"
                defaultValue={suggestedKey}
                required
                placeholder="ACME"
                className="input input-bordered w-full stack-mono uppercase"
              />
              <p className="label text-xs">Short, uppercase, used in URLs</p>
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset-legend">Client</legend>
              <input
                name="client"
                required
                placeholder="Acme Retail"
                className="input input-bordered w-full"
              />
            </fieldset>
          </div>

          <fieldset className="fieldset">
            <legend className="fieldset-legend">Project name</legend>
            <input
              name="name"
              required
              placeholder="Acme Checkout Modernisation"
              className="input input-bordered w-full"
            />
          </fieldset>

          <fieldset className="fieldset">
            <legend className="fieldset-legend">Summary</legend>
            <textarea
              name="summary"
              rows={3}
              placeholder="What this engagement delivers, and the commercial shape."
              className="textarea textarea-bordered w-full"
            />
          </fieldset>

          <div className="divider my-0 text-xs">Repository</div>

          <RepoSourceFields
            defaultRepoUrl={repo ? `https://github.com/${repo}.git` : ""}
            defaultBranch="main"
          />

          <div className="divider my-0 text-xs">Enforcement and cost</div>

          <div className="grid gap-4 sm:grid-cols-3">
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Item handle pattern</legend>
              <input
                name="handlePattern"
                defaultValue="STACK-[0-9]+"
                className="input input-bordered w-full stack-mono"
              />
            </fieldset>
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Gateway URL</legend>
              <input
                name="gatewayUrl"
                defaultValue={gatewayBaseUrl()}
                className="input input-bordered w-full stack-mono text-sm"
              />
            </fieldset>
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Budget (USD)</legend>
              <input
                name="budgetUsd"
                type="number"
                min={0}
                step={10}
                defaultValue={250}
                className="input input-bordered w-full"
              />
            </fieldset>
          </div>

          <div className="card-actions justify-end">
            <Link href="/projects" className="btn btn-ghost btn-sm">
              Cancel
            </Link>
            <button type="submit" className="btn btn-primary btn-sm">
              Register project
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
