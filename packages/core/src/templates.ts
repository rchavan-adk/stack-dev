import { z } from "zod";

export const templateSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  required: z.boolean().default(true),
  hint: z.string().optional(),
  minWords: z.number().int().positive().optional(),
});

export const templateFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "textarea", "select", "number"]).default("text"),
  required: z.boolean().default(true),
  options: z.array(z.string()).optional(),
  pattern: z.string().optional(),
});

export const templateRulesSchema = z.object({
  minAcceptanceCriteria: z.number().int().nonnegative().default(0),
  requireLinkedSpec: z.boolean().default(false),
  requireWave: z.boolean().default(false),
  maxTitleLength: z.number().int().positive().default(120),
});

export const templateDefinitionSchema = z.object({
  sections: z.array(templateSectionSchema).default([]),
  fields: z.array(templateFieldSchema).default([]),
  rules: templateRulesSchema.default({
    minAcceptanceCriteria: 0,
    requireLinkedSpec: false,
    requireWave: false,
    maxTitleLength: 120,
  }),
});

export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;
export type TemplateSection = z.infer<typeof templateSectionSchema>;
export type TemplateField = z.infer<typeof templateFieldSchema>;

export interface TemplateSubmission {
  title?: string;
  body: string;
  fields?: Record<string, string | number | null | undefined>;
  acceptance?: string[];
  waveId?: string | null;
  specId?: string | null;
}

export interface TemplateViolation {
  path: string;
  message: string;
}

export interface TemplateCheckResult {
  ok: boolean;
  violations: TemplateViolation[];
}

const headingRegex = (title: string) =>
  new RegExp(`^#{1,4}\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");

function sectionBody(body: string, title: string): string {
  const match = headingRegex(title).exec(body);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const nextHeading = /^#{1,4}\s+\S/m.exec(rest);
  return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
}

/**
 * The portal accepts an issue or spec only when it matches the active template.
 * Anything that does not fit comes back with the reason, which is what the
 * MCP server returns to a planner agent and what the admin UI previews.
 */
export function checkAgainstTemplate(
  definition: TemplateDefinition,
  submission: TemplateSubmission,
): TemplateCheckResult {
  const violations: TemplateViolation[] = [];
  const rules = definition.rules;

  if (submission.title !== undefined) {
    if (!submission.title.trim()) {
      violations.push({ path: "title", message: "Title is required." });
    } else if (submission.title.length > rules.maxTitleLength) {
      violations.push({
        path: "title",
        message: `Title must be ${rules.maxTitleLength} characters or fewer.`,
      });
    }
  }

  for (const section of definition.sections) {
    const content = sectionBody(submission.body ?? "", section.title);
    if (!content) {
      if (section.required) {
        violations.push({
          path: `sections.${section.id}`,
          message: `Missing required section "## ${section.title}".`,
        });
      }
      continue;
    }
    if (section.minWords && content.split(/\s+/).filter(Boolean).length < section.minWords) {
      violations.push({
        path: `sections.${section.id}`,
        message: `Section "${section.title}" needs at least ${section.minWords} words.`,
      });
    }
  }

  for (const field of definition.fields) {
    const raw = submission.fields?.[field.id];
    const value = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!value) {
      if (field.required) {
        violations.push({ path: `fields.${field.id}`, message: `${field.label} is required.` });
      }
      continue;
    }
    if (field.type === "number" && Number.isNaN(Number(value))) {
      violations.push({ path: `fields.${field.id}`, message: `${field.label} must be a number.` });
    }
    if (field.options?.length && !field.options.includes(value)) {
      violations.push({
        path: `fields.${field.id}`,
        message: `${field.label} must be one of: ${field.options.join(", ")}.`,
      });
    }
    if (field.pattern && !new RegExp(field.pattern).test(value)) {
      violations.push({
        path: `fields.${field.id}`,
        message: `${field.label} must match ${field.pattern}.`,
      });
    }
  }

  const acceptance = (submission.acceptance ?? []).filter((item) => item.trim().length > 0);
  if (acceptance.length < rules.minAcceptanceCriteria) {
    violations.push({
      path: "acceptance",
      message: `At least ${rules.minAcceptanceCriteria} acceptance criteria are required.`,
    });
  }
  if (rules.requireWave && !submission.waveId) {
    violations.push({ path: "waveId", message: "Issue must be assigned to a wave." });
  }
  if (rules.requireLinkedSpec && !submission.specId) {
    violations.push({ path: "specId", message: "Issue must link an approved spec." });
  }

  return { ok: violations.length === 0, violations };
}

/** Markdown skeleton the portal and MCP hand out so submissions pass first try. */
export function renderTemplateSkeleton(definition: TemplateDefinition): string {
  const lines: string[] = [];
  for (const section of definition.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(section.hint ? `<!-- ${section.hint} -->` : "<!-- -->");
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

export function parseTemplateDefinition(raw: string): TemplateDefinition {
  return templateDefinitionSchema.parse(JSON.parse(raw));
}
