/**
 * The product defaults that ship with Stack AI.
 *
 * These are not demo data. They are the templates every project starts from and
 * the default harness every developer installs before joining a project, so both
 * a seeded development database and a freshly deployed one need them.
 *
 * They live here rather than inside seed.ts so that `bootstrap.ts` can install
 * them without also creating the demo users and the published demo API tokens
 * that the seed generates. Those tokens are fine in a mock and unacceptable in a
 * deployment.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const PACK_DIR = join(REPO_ROOT, "harness-packs", "miracle-standards");

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export interface PackManifest {
  name: string;
  version: string;
  description: string;
  components: Array<{ kind: string; path: string; mode: string }>;
}

export function loadPackFromDisk(): {
  manifest: PackManifest;
  files: Array<{ kind: string; path: string; mode: string; content: string }>;
} {
  const manifestPath = join(PACK_DIR, "pack.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`pack manifest not found at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackManifest;
  const files = manifest.components.map((component) => {
    const absolute = join(PACK_DIR, component.path);
    if (!existsSync(absolute)) {
      throw new Error(`pack component missing on disk: ${component.path}`);
    }
    return { ...component, content: readFileSync(absolute, "utf8") };
  });
  // pack.json itself travels with the tarball so the CLI can read the manifest.
  files.push({
    kind: "SYSTEM_PROMPT",
    path: "pack.json",
    mode: "644",
    content: readFileSync(manifestPath, "utf8"),
  });
  return { manifest, files };
}

/** Checksum over the pack contents, so a client can tell whether it changed. */
export function packChecksum(
  files: Array<{ path: string; content: string }>,
): string {
  return sha256(
    files
      .map((file) => `${file.path}:${sha256(file.content)}`)
      .sort()
      .join("\n"),
  );
}

export const ISSUE_TEMPLATE = {
  sections: [
    { id: "context", title: "Context", required: true, minWords: 10, hint: "Why this work exists" },
    { id: "scope", title: "Scope", required: true, hint: "Files, services or screens in scope" },
    {
      id: "acceptance",
      title: "Acceptance criteria",
      required: true,
      hint: "Checklist a person can validate",
    },
    { id: "out-of-scope", title: "Out of scope", required: true, hint: "What this item does not cover" },
    { id: "evidence", title: "Evidence", required: false, hint: "Commands, tests, screenshots" },
  ],
  fields: [
    {
      id: "type",
      label: "Type",
      type: "select",
      required: true,
      options: ["FEATURE", "BUG", "CHORE", "SPIKE"],
    },
    { id: "estimate", label: "Estimate (points)", type: "number", required: true },
    { id: "wave", label: "Wave", type: "text", required: true },
  ],
  rules: {
    minAcceptanceCriteria: 2,
    requireLinkedSpec: false,
    requireWave: true,
    maxTitleLength: 100,
  },
};

export const SPEC_TEMPLATE = {
  sections: [
    { id: "problem", title: "Problem", required: true, minWords: 15 },
    { id: "proposal", title: "Proposal", required: true, minWords: 20 },
    { id: "api", title: "Interfaces", required: false },
    { id: "risks", title: "Risks and rollback", required: true },
    { id: "acceptance", title: "Acceptance criteria", required: true },
  ],
  fields: [
    {
      id: "author_role",
      label: "Author role",
      type: "select",
      required: true,
      options: ["LEAD", "ARCHITECT", "PLANNER_AGENT"],
    },
  ],
  rules: {
    minAcceptanceCriteria: 3,
    requireLinkedSpec: false,
    requireWave: false,
    maxTitleLength: 120,
  },
};

export const WAVE_TEMPLATE = {
  sections: [
    { id: "goal", title: "Wave goal", required: true, minWords: 8 },
    { id: "slices", title: "Horizontal slices", required: true },
    { id: "exit", title: "Exit criteria", required: true },
    { id: "dependencies", title: "Dependencies", required: false },
  ],
  fields: [
    { id: "duration_weeks", label: "Duration (weeks)", type: "number", required: true },
    {
      id: "shape",
      label: "Slicing shape",
      type: "select",
      required: true,
      options: ["HORIZONTAL", "VERTICAL", "MIXED"],
    },
  ],
  rules: {
    minAcceptanceCriteria: 1,
    requireLinkedSpec: false,
    requireWave: false,
    maxTitleLength: 80,
  },
};

export const DEFAULT_TEMPLATES = [
  { kind: "ISSUE", name: "Miracle issue template", version: "1.2.0", definition: ISSUE_TEMPLATE },
  { kind: "SPEC", name: "Miracle spec template", version: "1.1.0", definition: SPEC_TEMPLATE },
  { kind: "WAVE", name: "Miracle wave template", version: "1.0.0", definition: WAVE_TEMPLATE },
] as const;
