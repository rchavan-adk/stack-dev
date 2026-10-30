export const ROLES = ["ADMIN", "LEAD", "DEVELOPER", "CLIENT"] as const;
export type Role = (typeof ROLES)[number];

export const ISSUE_STATUSES = [
  "BACKLOG",
  "APPROVED",
  "IN_PROGRESS",
  "IN_REVIEW",
  "AWAITING_VALIDATION",
  "DONE",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  BACKLOG: "Backlog",
  APPROVED: "Approved",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  AWAITING_VALIDATION: "Awaiting validation",
  DONE: "Done",
};

/**
 * Only these transitions are legal, and the ones a human must drive are marked.
 * Agents and the CLI can claim work and report progress; evidence from git moves
 * a card into review, and only a person can validate.
 */
export const ISSUE_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  BACKLOG: ["APPROVED"],
  APPROVED: ["IN_PROGRESS"],
  IN_PROGRESS: ["IN_REVIEW", "APPROVED"],
  IN_REVIEW: ["AWAITING_VALIDATION", "IN_PROGRESS"],
  AWAITING_VALIDATION: ["DONE", "IN_PROGRESS"],
  DONE: [],
};

export const HUMAN_ONLY_TRANSITIONS: Array<{ from: IssueStatus; to: IssueStatus }> = [
  { from: "BACKLOG", to: "APPROVED" },
  { from: "AWAITING_VALIDATION", to: "DONE" },
];

export const WAVE_STATUSES = ["PLANNED", "ACTIVE", "DONE"] as const;
export const SPEC_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;
export const TEMPLATE_KINDS = ["ISSUE", "SPEC", "WAVE"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const EVENT_KINDS = [
  "COMMIT",
  "PR_OPENED",
  "PR_MERGED",
  "VALIDATED",
  "CLAIMED",
  "STATUS_REPORTED",
  "HARNESS_INSTALLED",
  "MODEL_CALL",
  "TEMPLATE_REJECTED",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** The eight Harness components, and where each one lands inside an extracted pack. */
export const HARNESS_COMPONENTS = [
  {
    kind: "SYSTEM_PROMPT",
    label: "System prompt",
    path: "components/system-prompt.md",
    role: "Context",
    blocking: false,
  },
  {
    kind: "GUARDRAILS",
    label: "Guardrails",
    path: "components/guardrails.md",
    role: "Context",
    blocking: false,
  },
  { kind: "MEMORY", label: "Memory", path: "components/memory.md", role: "Context", blocking: false },
  {
    kind: "TOOL_GUIDANCE",
    label: "Tool guidance",
    path: "components/tool-guidance.md",
    role: "Tool interface",
    blocking: false,
  },
  {
    kind: "SUBAGENTS",
    label: "Subagents",
    path: "components/subagents.md",
    role: "Orchestration",
    blocking: false,
  },
  { kind: "SKILLS", label: "Skills", path: "components/skills.md", role: "Context", blocking: false },
  {
    kind: "SCRIPTS",
    label: "Scripts",
    path: "components/scripts/commit-msg",
    role: "Tool interface",
    blocking: true,
  },
  {
    kind: "PLUGINS",
    label: "Plugins",
    path: "components/plugins/gateway-only.js",
    role: "Middleware",
    blocking: true,
  },
] as const;

export type HarnessComponentKind = (typeof HARNESS_COMPONENTS)[number]["kind"];

export const MIRACLE_PALETTE = {
  primary: "#00aae7",
  secondary: "#0d416b",
  accent: "#2368a0",
  error: "#ef4048",
  neutral: "#232527",
  base100: "#ffffff",
  base200: "#f7f9fb",
  base300: "#e4e4e6",
  muted: "#8c8c8c",
} as const;
