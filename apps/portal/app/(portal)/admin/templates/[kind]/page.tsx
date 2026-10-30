import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { templateDefinitionSchema, TEMPLATE_KINDS } from "@stack/core";
import { activeTemplate } from "@/lib/queries";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { AdminDenied } from "@/components/admin-gate";
import {
  TemplateEditor,
  type DraftFieldInput,
  type DraftRulesInput,
  type DraftSectionInput,
} from "@/components/template-editor";
import { saveTemplate, trySubmission } from "./actions";

type Kind = (typeof TEMPLATE_KINDS)[number];

const KIND_LABEL: Record<Kind, string> = { ISSUE: "Issue", SPEC: "Spec", WAVE: "Wave" };

function parseDefinition(raw: string): { data: ReturnType<typeof templateDefinitionSchema.parse> | null; error: string | null } {
  try {
    return { data: templateDefinitionSchema.parse(JSON.parse(raw)), error: null };
  } catch {
    return { data: null, error: "stored definition does not match the schema" };
  }
}

export default async function TemplateKindPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) return <AdminDenied user={user} />;

  const { kind } = await params;
  if (!(TEMPLATE_KINDS as readonly string[]).includes(kind)) notFound();
  const typedKind = kind as Kind;

  const active = await activeTemplate(typedKind);
  const parsed = active
    ? parseDefinition(active.definition)
    : { data: templateDefinitionSchema.parse({}), error: null };

  // A corrupt stored definition is surfaced, and the editor below starts from
  // the schema defaults so saving writes a valid replacement.
  const base = parsed.data ?? templateDefinitionSchema.parse({});

  const sections: DraftSectionInput[] = base.sections.map((section) => ({
    title: section.title,
    required: section.required,
    minWords: section.minWords !== undefined ? String(section.minWords) : "",
    hint: section.hint ?? "",
  }));

  const fields: DraftFieldInput[] = base.fields.map((field) => ({
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options?.join(", ") ?? "",
    pattern: field.pattern ?? "",
  }));

  const rules: DraftRulesInput = {
    minAcceptanceCriteria: String(base.rules.minAcceptanceCriteria),
    requireWave: base.rules.requireWave,
    requireLinkedSpec: base.rules.requireLinkedSpec,
    maxTitleLength: String(base.rules.maxTitleLength),
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/admin/templates"
          className="inline-flex items-center gap-1 text-sm text-base-content/60 hover:text-primary"
        >
          <ArrowLeft size={14} /> All templates
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Edit the {KIND_LABEL[typedKind].toLowerCase()} template</h1>
          {active && (
            <span className="badge badge-secondary badge-sm">
              active {active.name} {active.version}
            </span>
          )}
        </div>
        <p className="max-w-3xl text-sm text-base-content/60">
          Structure it as rows, not JSON. Sections are markdown headings a submission must contain,
          fields are the metadata the issue form collects, rules decide when a submission is
          rejected. Test-drive it on the right of the editor before saving.
        </p>
      </header>

      {active && parsed.error && (
        <div className="alert alert-error text-sm">
          <span>
            The stored definition of {active.version} does not validate ({parsed.error}). Save the
            editor below to write a corrected, bumped version.
          </span>
        </div>
      )}

      <TemplateEditor
        kindLabel={KIND_LABEL[typedKind]}
        activeVersion={active?.version ?? "none yet"}
        name={active?.name ?? `Miracle ${KIND_LABEL[typedKind].toLowerCase()} template`}
        sections={sections}
        fields={fields}
        rules={rules}
        saveAction={saveTemplate.bind(null, typedKind)}
        tryAction={trySubmission.bind(null, typedKind)}
      />
    </div>
  );
}
