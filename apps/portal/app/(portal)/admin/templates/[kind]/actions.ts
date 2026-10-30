"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@stack/db";
import { checkAgainstTemplate, templateDefinitionSchema, TEMPLATE_KINDS } from "@stack/core";
import type { TemplateDefinition } from "@stack/core";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { nextPatchVersion } from "@/lib/version";
import type { SaveState, TryState } from "@/components/template-editor";

type Kind = (typeof TEMPLATE_KINDS)[number];

function isKind(value: string): value is Kind {
  return (TEMPLATE_KINDS as readonly string[]).includes(value);
}

type DraftParse =
  | { ok: true; data: TemplateDefinition }
  | { ok: false; errors: Array<{ path: string; message: string }> };

function parseDraftDefinition(raw: string): DraftParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      errors: [
        { path: "definition", message: "The draft could not be read. Reload the page and retry." },
      ],
    };
  }
  const result = templateDefinitionSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  return { ok: true, data: result.data };
}

/**
 * Saving never mutates history: the current active row is switched off and a
 * bumped patch version is written, both in one transaction.
 */
export async function saveTemplate(
  kind: string,
  _previous: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) {
    return {
      status: "error",
      errors: [{ path: "", message: "Editing templates needs lead or admin rights." }],
    };
  }
  if (!isKind(kind)) {
    return {
      status: "error",
      errors: [{ path: "kind", message: `Unknown template kind "${kind}".` }],
    };
  }

  const name = String(formData.get("name") ?? "").trim();
  const nameErrors: Array<{ path: string; message: string }> = [];
  if (!name) nameErrors.push({ path: "name", message: "Give the template a name." });

  const draft = parseDraftDefinition(String(formData.get("definition") ?? "null"));
  if (!draft.ok) return { status: "error", errors: [...nameErrors, ...draft.errors] };
  if (nameErrors.length > 0) return { status: "error", errors: nameErrors };

  const [active, latest, history] = await Promise.all([
    prisma.template.findFirst({ where: { kind, active: true }, orderBy: { createdAt: "desc" } }),
    prisma.template.findFirst({ where: { kind }, orderBy: { createdAt: "desc" } }),
    prisma.template.findMany({ where: { kind }, select: { version: true } }),
  ]);

  const taken = history.map((row) => row.version);
  const version =
    active || latest ? nextPatchVersion((active ?? latest)!.version, taken) : "1.0.0";
  if (!version) {
    return {
      status: "error",
      errors: [
        {
          path: "version",
          message: `Could not derive a next version from "${(active ?? latest)?.version}".`,
        },
      ],
    };
  }

  await prisma.$transaction([
    prisma.template.updateMany({ where: { kind, active: true }, data: { active: false } }),
    prisma.template.create({
      data: { kind, name, version, definition: JSON.stringify(draft.data), active: true },
    }),
  ]);

  revalidatePath("/admin/templates");
  revalidatePath(`/admin/templates/${kind}`);
  return { status: "saved", version };
}

/** Runs the exact check the MCP runs, against the (possibly unsaved) draft. */
export async function trySubmission(
  kind: string,
  _previous: TryState,
  formData: FormData,
): Promise<TryState> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) {
    return { status: "error", message: "Testing templates needs lead or admin rights." };
  }
  if (!isKind(kind)) {
    return { status: "error", message: `Unknown template kind "${kind}".` };
  }

  const draft = parseDraftDefinition(String(formData.get("definition") ?? "null"));
  if (!draft.ok) {
    return {
      status: "error",
      message: `The draft template does not validate yet: ${draft.errors
        .map((error) => `${error.path || "definition"} ${error.message}`)
        .join("; ")}`,
    };
  }

  let fieldValues: Record<string, string> = {};
  try {
    const rawFields: unknown = JSON.parse(String(formData.get("fieldsJson") ?? "{}"));
    if (rawFields && typeof rawFields === "object" && !Array.isArray(rawFields)) {
      fieldValues = Object.fromEntries(
        Object.entries(rawFields as Record<string, unknown>).map(([key, value]) => [
          key,
          String(value ?? ""),
        ]),
      );
    }
  } catch {
    /* empty field values are fine, the required-field rules fire instead */
  }

  const titleRaw = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  const acceptance = String(formData.get("acceptance") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const result = checkAgainstTemplate(draft.data, {
    ...(titleRaw ? { title: titleRaw } : {}),
    body,
    fields: fieldValues,
    acceptance,
  });
  return { status: "checked", ok: result.ok, violations: result.violations };
}
