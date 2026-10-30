"use client";

import { useActionState, useMemo, useState } from "react";
import { FlaskConical, ListChecks, Plus, Save, Trash2 } from "lucide-react";
// Deep import: the @stack/core barrel re-exports tokens.ts, which pulls node:crypto
// into the client bundle. The templates module is pure zod and browser-safe.
import { renderTemplateSkeleton, type TemplateDefinition } from "@stack/core/src/templates";

export interface DraftSectionInput {
  title: string;
  required: boolean;
  minWords: string;
  hint: string;
}

export interface DraftFieldInput {
  label: string;
  type: "text" | "textarea" | "select" | "number";
  required: boolean;
  options: string;
  pattern: string;
}

export interface DraftRulesInput {
  minAcceptanceCriteria: string;
  requireWave: boolean;
  requireLinkedSpec: boolean;
  maxTitleLength: string;
}

export type SaveState =
  | { status: "idle" }
  | { status: "saved"; version: string }
  | { status: "error"; errors: Array<{ path: string; message: string }> };

export const IDLE_SAVE_STATE: SaveState = { status: "idle" };

export type TryState =
  | { status: "idle" }
  | { status: "checked"; ok: boolean; violations: Array<{ path: string; message: string }> }
  | { status: "error"; message: string };

export const IDLE_TRY_STATE: TryState = { status: "idle" };

const FIELD_TYPES: DraftFieldInput["type"][] = ["text", "textarea", "select", "number"];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The editor speaks rows; the wire format is the zod-validated definition. */
function buildDefinition(
  sections: DraftSectionInput[],
  fields: DraftFieldInput[],
  rules: DraftRulesInput,
): TemplateDefinition {
  const usedIds = new Set<string>();
  const idFor = (base: string, fallback: string): string => {
    const slug = slugify(base) || fallback;
    let candidate = slug;
    let suffix = 2;
    while (usedIds.has(candidate)) {
      candidate = `${slug}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
  };

  const minAcceptance = Number.parseInt(rules.minAcceptanceCriteria, 10);
  const maxTitle = Number.parseInt(rules.maxTitleLength, 10);

  return {
    sections: sections.map((section, index) => {
      const minWords = Number.parseInt(section.minWords, 10);
      return {
        id: idFor(section.title, `section-${index + 1}`),
        title: section.title,
        required: section.required,
        ...(Number.isFinite(minWords) ? { minWords } : {}),
        ...(section.hint.trim() ? { hint: section.hint.trim() } : {}),
      };
    }),
    fields: fields.map((field, index) => ({
      id: idFor(field.label, `field-${index + 1}`),
      label: field.label,
      type: field.type,
      required: field.required,
      ...(field.options.trim()
        ? { options: field.options.split(",").map((option) => option.trim()).filter(Boolean) }
        : {}),
      ...(field.pattern.trim() ? { pattern: field.pattern.trim() } : {}),
    })),
    rules: {
      minAcceptanceCriteria: Number.isFinite(minAcceptance) ? minAcceptance : 0,
      requireWave: rules.requireWave,
      requireLinkedSpec: rules.requireLinkedSpec,
      maxTitleLength: Number.isFinite(maxTitle) ? maxTitle : 120,
    },
  };
}

function errorsFor(
  errors: Array<{ path: string; message: string }>,
  prefix: string,
): string[] {
  return errors
    .filter((error) => error.path === prefix || error.path.startsWith(`${prefix}.`))
    .map((error) => `${error.path ? `${error.path}: ` : ""}${error.message}`);
}

export function TemplateEditor({
  kindLabel,
  activeVersion,
  name: initialName,
  sections: initialSections,
  fields: initialFields,
  rules: initialRules,
  saveAction,
  tryAction,
}: {
  kindLabel: string;
  activeVersion: string;
  name: string;
  sections: DraftSectionInput[];
  fields: DraftFieldInput[];
  rules: DraftRulesInput;
  saveAction: (state: SaveState, formData: FormData) => Promise<SaveState>;
  tryAction: (state: TryState, formData: FormData) => Promise<TryState>;
}) {
  const [name, setName] = useState(initialName);
  const [sections, setSections] = useState(initialSections);
  const [fields, setFields] = useState(initialFields);
  const [rules, setRules] = useState(initialRules);
  const [tab, setTab] = useState<"sections" | "fields" | "rules">("sections");
  const [tryTitle, setTryTitle] = useState("");
  const [tryBody, setTryBody] = useState("");
  const [tryAcceptance, setTryAcceptance] = useState("");
  const [tryFieldValues, setTryFieldValues] = useState<Record<string, string>>({});

  const [saveState, save, saving] = useActionState(saveAction, IDLE_SAVE_STATE);
  const [tryState, check, checking] = useActionState(tryAction, IDLE_TRY_STATE);

  const definition = useMemo(
    () => buildDefinition(sections, fields, rules),
    [sections, fields, rules],
  );
  const definitionJson = useMemo(() => JSON.stringify(definition), [definition]);
  const skeleton = useMemo(() => renderTemplateSkeleton(definition).trim(), [definition]);

  const updateSection = (index: number, patch: Partial<DraftSectionInput>) => {
    setSections((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const updateField = (index: number, patch: Partial<DraftFieldInput>) => {
    setFields((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <form action={save} className="card border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                name="name"
                className="input input-sm min-w-0 flex-1"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={`${kindLabel} template name`}
              />
              <span className="badge badge-ghost whitespace-nowrap">
                active {activeVersion}
              </span>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                <Save size={16} />
                {saving ? "Saving…" : "Save as new version"}
              </button>
            </div>
            {errorsFor(saveState.status === "error" ? saveState.errors : [], "name").length > 0 && (
              <p className="text-xs text-error">
                {errorsFor(saveState.status === "error" ? saveState.errors : [], "name").join(" ")}
              </p>
            )}
            <p className="text-xs text-base-content/60">
              Saving bumps the patch version and makes it the active template. Earlier versions stay
              in history untouched.
            </p>

            <div role="tablist" className="tabs tabs-box w-fit">
              {(
                [
                  ["sections", `Sections (${sections.length})`],
                  ["fields", `Fields (${fields.length})`],
                  ["rules", "Rules"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  className={`tab ${tab === value ? "tab-active" : ""}`}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "sections" && (
              <div className="space-y-2">
                {sections.map((section, index) => {
                  const errors = errorsFor(
                    saveState.status === "error" ? saveState.errors : [],
                    `sections.${index}`,
                  );
                  return (
                    <div
                      key={index}
                      className="grid items-center gap-2 rounded-box border border-base-300 bg-base-200 p-3 md:grid-cols-[minmax(10rem,1fr)_auto_6rem_minmax(10rem,1.4fr)_auto]"
                    >
                      <input
                        className="input input-sm w-full"
                        value={section.title}
                        onChange={(event) => updateSection(index, { title: event.target.value })}
                        placeholder="Section title (a ## heading)"
                      />
                      <label className="label cursor-pointer gap-2 whitespace-nowrap">
                        <input
                          type="checkbox"
                          className="toggle toggle-xs"
                          checked={section.required}
                          onChange={(event) => updateSection(index, { required: event.target.checked })}
                        />
                        required
                      </label>
                      <input
                        type="number"
                        min={1}
                        className="input input-sm w-full"
                        value={section.minWords}
                        onChange={(event) => updateSection(index, { minWords: event.target.value })}
                        placeholder="min words"
                      />
                      <input
                        className="input input-sm w-full"
                        value={section.hint}
                        onChange={(event) => updateSection(index, { hint: event.target.value })}
                        placeholder="hint shown in the skeleton"
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSections((current) => current.filter((_, i) => i !== index))}
                        aria-label="Remove section"
                      >
                        <Trash2 size={16} />
                      </button>
                      {errors.length > 0 && (
                        <p className="text-xs text-error md:col-span-5">{errors.join(" ")}</p>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm gap-1"
                  onClick={() =>
                    setSections((current) => [
                      ...current,
                      { title: "", required: true, minWords: "", hint: "" },
                    ])
                  }
                >
                  <Plus size={14} /> Add section
                </button>
              </div>
            )}

            {tab === "fields" && (
              <div className="space-y-2">
                {fields.map((field, index) => {
                  const errors = errorsFor(
                    saveState.status === "error" ? saveState.errors : [],
                    `fields.${index}`,
                  );
                  return (
                    <div
                      key={index}
                      className="grid items-center gap-2 rounded-box border border-base-300 bg-base-200 p-3 md:grid-cols-[minmax(8rem,1fr)_7rem_auto_minmax(8rem,1fr)_minmax(8rem,1fr)_auto]"
                    >
                      <input
                        className="input input-sm w-full"
                        value={field.label}
                        onChange={(event) => updateField(index, { label: event.target.value })}
                        placeholder="Field label"
                      />
                      <select
                        className="select select-sm w-full"
                        value={field.type}
                        onChange={(event) =>
                          updateField(index, {
                            type: event.target.value as DraftFieldInput["type"],
                          })
                        }
                      >
                        {FIELD_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                      <label className="label cursor-pointer gap-2 whitespace-nowrap">
                        <input
                          type="checkbox"
                          className="toggle toggle-xs"
                          checked={field.required}
                          onChange={(event) => updateField(index, { required: event.target.checked })}
                        />
                        required
                      </label>
                      <input
                        className="input input-sm w-full"
                        value={field.options}
                        onChange={(event) => updateField(index, { options: event.target.value })}
                        placeholder="options, comma separated"
                      />
                      <input
                        className="input input-sm w-full stack-mono"
                        value={field.pattern}
                        onChange={(event) => updateField(index, { pattern: event.target.value })}
                        placeholder="regex pattern"
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setFields((current) => current.filter((_, i) => i !== index))}
                        aria-label="Remove field"
                      >
                        <Trash2 size={16} />
                      </button>
                      {errors.length > 0 && (
                        <p className="text-xs text-error md:col-span-6">{errors.join(" ")}</p>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm gap-1"
                  onClick={() =>
                    setFields((current) => [
                      ...current,
                      { label: "", type: "text", required: true, options: "", pattern: "" },
                    ])
                  }
                >
                  <Plus size={14} /> Add field
                </button>
              </div>
            )}

            {tab === "rules" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Min acceptance criteria</legend>
                  <input
                    type="number"
                    min={0}
                    className="input input-sm w-full"
                    value={rules.minAcceptanceCriteria}
                    onChange={(event) =>
                      setRules((current) => ({
                        ...current,
                        minAcceptanceCriteria: event.target.value,
                      }))
                    }
                  />
                  {errorsFor(saveState.status === "error" ? saveState.errors : [], "rules.minAcceptanceCriteria").length > 0 && (
                    <p className="text-xs text-error">
                      {errorsFor(saveState.status === "error" ? saveState.errors : [], "rules.minAcceptanceCriteria").join(" ")}
                    </p>
                  )}
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Max title length</legend>
                  <input
                    type="number"
                    min={1}
                    className="input input-sm w-full"
                    value={rules.maxTitleLength}
                    onChange={(event) =>
                      setRules((current) => ({ ...current, maxTitleLength: event.target.value }))
                    }
                  />
                  {errorsFor(saveState.status === "error" ? saveState.errors : [], "rules.maxTitleLength").length > 0 && (
                    <p className="text-xs text-error">
                      {errorsFor(saveState.status === "error" ? saveState.errors : [], "rules.maxTitleLength").join(" ")}
                    </p>
                  )}
                </fieldset>
                <label className="label cursor-pointer gap-3 rounded-box border border-base-300 bg-base-200 p-3">
                  <input
                    type="checkbox"
                    className="toggle toggle-sm"
                    checked={rules.requireWave}
                    onChange={(event) =>
                      setRules((current) => ({ ...current, requireWave: event.target.checked }))
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium">Require a wave</span>
                    <span className="block text-xs text-base-content/60">
                      submissions must be assigned to a wave
                    </span>
                  </span>
                </label>
                <label className="label cursor-pointer gap-3 rounded-box border border-base-300 bg-base-200 p-3">
                  <input
                    type="checkbox"
                    className="toggle toggle-sm"
                    checked={rules.requireLinkedSpec}
                    onChange={(event) =>
                      setRules((current) => ({ ...current, requireLinkedSpec: event.target.checked }))
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium">Require a linked spec</span>
                    <span className="block text-xs text-base-content/60">
                      submissions must link an approved spec
                    </span>
                  </span>
                </label>
              </div>
            )}

            <input type="hidden" name="definition" value={definitionJson} />

            {saveState.status === "saved" && (
              <div className="alert alert-success text-sm">
                <span>
                  Saved as version <span className="stack-mono">{saveState.version}</span>. It is
                  now the active {kindLabel.toLowerCase()} template; previous versions are inactive
                  but kept in history.
                </span>
              </div>
            )}
            {saveState.status === "error" && (
              <div className="alert alert-error items-start text-sm">
                <div>
                  <span className="font-semibold">The template did not validate:</span>
                  <ul className="mt-1 list-inside list-disc">
                    {saveState.errors.map((error, index) => (
                      <li key={`${index}:${error.path}:${error.message}`}>
                        <span className="stack-mono">{error.path}</span> — {error.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </form>

        <form action={check} className="card border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <h3 className="card-title flex items-center gap-2 text-base">
              <FlaskConical size={18} /> Try a submission
            </h3>
            <p className="text-xs text-base-content/60">
              Paste a draft the way a planner agent would submit it. This runs the same{" "}
              <code className="stack-mono">checkAgainstTemplate</code> the MCP runs, against the
              draft above (saved or not).
            </p>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="space-y-4">
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Draft body (markdown)</legend>
                  <textarea
                    name="body"
                    rows={10}
                    className="textarea w-full stack-mono text-xs leading-relaxed"
                    value={tryBody}
                    onChange={(event) => setTryBody(event.target.value)}
                    placeholder={"## Context\n…\n\n## Acceptance criteria\n- [ ] …"}
                  />
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Acceptance criteria (one per line)</legend>
                  <textarea
                    name="acceptance"
                    rows={4}
                    className="textarea w-full text-sm"
                    value={tryAcceptance}
                    onChange={(event) => setTryAcceptance(event.target.value)}
                    placeholder={"- Total rounds half up to two decimals\n- Existing tests pass"}
                  />
                </fieldset>
              </div>

              <div className="space-y-4">
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Title (optional)</legend>
                  <input
                    name="title"
                    className="input input-sm w-full"
                    value={tryTitle}
                    onChange={(event) => setTryTitle(event.target.value)}
                    placeholder="Checked only when provided"
                  />
                </fieldset>
                {definition.fields.map((field) => (
                  <fieldset className="fieldset" key={field.id}>
                    <legend className="fieldset-legend">
                      {field.label}
                      {field.required ? " *" : ""}
                    </legend>
                    {field.type === "select" && field.options?.length ? (
                      <select
                        className="select select-sm w-full"
                        value={tryFieldValues[field.id] ?? ""}
                        onChange={(event) =>
                          setTryFieldValues((current) => ({
                            ...current,
                            [field.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">—</option>
                        {field.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="input input-sm w-full"
                        value={tryFieldValues[field.id] ?? ""}
                        onChange={(event) =>
                          setTryFieldValues((current) => ({
                            ...current,
                            [field.id]: event.target.value,
                          }))
                        }
                        placeholder={field.pattern ? `must match ${field.pattern}` : undefined}
                      />
                    )}
                  </fieldset>
                ))}
              </div>
            </div>

            <input type="hidden" name="definition" value={definitionJson} />
            <input
              type="hidden"
              name="fieldsJson"
              value={JSON.stringify(
                Object.fromEntries(
                  definition.fields.map((field) => [field.id, tryFieldValues[field.id] ?? ""]),
                ),
              )}
            />
            <div>
              <button type="submit" className="btn btn-sm btn-secondary" disabled={checking}>
                <ListChecks size={16} />
                {checking ? "Checking…" : "Check against template"}
              </button>
            </div>

            {tryState.status === "checked" && tryState.ok && (
              <div className="alert alert-success text-sm">
                <span>
                  This submission passes the template — the MCP would accept it as-is.
                </span>
              </div>
            )}
            {tryState.status === "checked" && !tryState.ok && (
              <div className="space-y-2">
                {tryState.violations.map((violation, index) => (
                  <div key={`${index}:${violation.path}:${violation.message}`} className="alert alert-error text-sm">
                    <kbd className="kbd kbd-sm stack-mono">{violation.path}</kbd>
                    <span>{violation.message}</span>
                  </div>
                ))}
              </div>
            )}
            {tryState.status === "error" && (
              <div className="alert alert-error text-sm">
                <span>{tryState.message}</span>
              </div>
            )}
          </div>
        </form>
      </div>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body gap-3">
            <h3 className="card-title text-base">Skeleton preview</h3>
            <p className="text-xs text-base-content/60">
              Live. This is the markdown skeleton the portal and the MCP hand out so a submission
              passes on the first try.
            </p>
            <div className="mockup-code max-h-96 overflow-auto text-xs">
              <pre>
                <code>{skeleton || "(no sections yet)"}</code>
              </pre>
            </div>
            <div className="stats stats-vertical stats-shadow font-mono text-xs">
              <div className="stat">
                <div className="stat-title">Sections</div>
                <div className="stat-value text-2xl">{definition.sections.length}</div>
                <div className="stat-desc">
                  {definition.sections.filter((section) => section.required).length} required
                </div>
              </div>
              <div className="stat">
                <div className="stat-title">Fields</div>
                <div className="stat-value text-2xl">{definition.fields.length}</div>
                <div className="stat-desc">
                  {definition.fields.filter((field) => field.required).length} required
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
