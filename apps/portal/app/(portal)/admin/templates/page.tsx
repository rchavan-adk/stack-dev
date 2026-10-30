import Link from "next/link";
import { FileEdit } from "lucide-react";
import { prisma } from "@stack/db";
import { templateDefinitionSchema, TEMPLATE_KINDS } from "@stack/core";
import type { TemplateDefinition } from "@stack/core";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { AdminDenied } from "@/components/admin-gate";
import { formatDate } from "@/lib/format";

type Kind = (typeof TEMPLATE_KINDS)[number];

const KIND_LABEL: Record<Kind, string> = { ISSUE: "Issue", SPEC: "Spec", WAVE: "Wave" };

interface DefinitionParse {
  data: TemplateDefinition | null;
  error: string | null;
}

function parseDefinition(raw: string): DefinitionParse {
  try {
    const result = templateDefinitionSchema.safeParse(JSON.parse(raw));
    if (result.success) return { data: result.data, error: null };
    return {
      data: null,
      error: result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    };
  } catch {
    return { data: null, error: "definition is not valid JSON" };
  }
}

function RulesSummary({ rules }: { rules: TemplateDefinition["rules"] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="badge badge-ghost badge-sm whitespace-nowrap">
        ≥ {rules.minAcceptanceCriteria} acceptance criteria
      </span>
      <span
        className={`badge badge-sm whitespace-nowrap ${rules.requireWave ? "badge-primary" : "badge-ghost"}`}
      >
        {rules.requireWave ? "wave required" : "wave optional"}
      </span>
      <span
        className={`badge badge-sm whitespace-nowrap ${rules.requireLinkedSpec ? "badge-primary" : "badge-ghost"}`}
      >
        {rules.requireLinkedSpec ? "spec link required" : "spec link optional"}
      </span>
      <span className="badge badge-ghost badge-sm whitespace-nowrap">
        title ≤ {rules.maxTitleLength} chars
      </span>
    </div>
  );
}

export default async function TemplatesPage() {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) return <AdminDenied user={user} />;

  const templates = await prisma.template.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="text-sm text-base-content/60">
          The active template of each kind is enforced on every issue, spec and wave submission.
          Anything that does not fit comes back with the reason — the same check the planner MCP
          runs. Editing always writes a new version; history is never rewritten.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-3">
        {TEMPLATE_KINDS.map((kind) => {
          const active = templates.find((row) => row.kind === kind && row.active);
          const history = templates.filter((row) => row.kind === kind && !row.active);
          const parsed = active ? parseDefinition(active.definition) : { data: null, error: null };

          return (
            <div key={kind} className="card border border-base-300 bg-base-100">
              <div className="card-body gap-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="card-title text-base">{KIND_LABEL[kind]} template</h2>
                  {active && (
                    <span className="badge badge-secondary badge-sm whitespace-nowrap">
                      {active.version}
                    </span>
                  )}
                </div>

                {!active && (
                  <div className="alert alert-warning text-sm">
                    <span>
                      No active {KIND_LABEL[kind].toLowerCase()} template. Submissions of this kind
                      cannot be validated until one is saved.
                    </span>
                  </div>
                )}

                {active && (
                  <>
                    <p className="text-sm font-medium">{active.name}</p>
                    {parsed.data ? (
                      <>
                        <div className="stats stats-vertical w-full font-mono">
                          <div className="stat">
                            <div className="stat-title">Sections</div>
                            <div className="stat-value text-xl">{parsed.data.sections.length}</div>
                            <div className="stat-desc">
                              {parsed.data.sections.filter((section) => section.required).length}{" "}
                              required
                            </div>
                          </div>
                          <div className="stat">
                            <div className="stat-title">Fields</div>
                            <div className="stat-value text-xl">{parsed.data.fields.length}</div>
                            <div className="stat-desc">
                              {parsed.data.fields.filter((field) => field.required).length} required
                            </div>
                          </div>
                        </div>
                        <RulesSummary rules={parsed.data.rules} />
                      </>
                    ) : (
                      <div className="alert alert-error text-xs">
                        <span>
                          The stored definition fails validation ({parsed.error}). Open the editor
                          and save a corrected version.
                        </span>
                      </div>
                    )}
                  </>
                )}

                <Link href={`/admin/templates/${kind}`} className="btn btn-primary btn-sm w-fit">
                  <FileEdit size={16} />
                  {active ? "Edit template" : `Create ${KIND_LABEL[kind].toLowerCase()} template`}
                </Link>

                {history.length > 0 && (
                  <details className="collapse collapse-arrow bg-base-200">
                    <summary className="collapse-title py-2 text-sm">
                      History ({history.length} inactive {history.length === 1 ? "version" : "versions"})
                    </summary>
                    <div className="collapse-content">
                      <ul className="space-y-1 text-xs text-base-content/70">
                        {history.map((row) => (
                          <li key={row.id} className="flex items-center gap-2">
                            <span className="badge badge-ghost badge-xs stack-mono">
                              {row.version}
                            </span>
                            {row.name}
                            <span className="text-base-content/40">
                              {formatDate(row.createdAt, "—")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
