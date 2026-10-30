import { ISSUE_STATUS_LABELS, type IssueStatus } from "@stack/core";

const STATUS_CLASS: Record<string, string> = {
  BACKLOG: "badge-ghost",
  APPROVED: "badge-info badge-outline",
  IN_PROGRESS: "badge-info",
  IN_REVIEW: "badge-warning",
  AWAITING_VALIDATION: "badge-secondary",
  DONE: "badge-success",
};

export function IssueStatusBadge({ status, size = "sm" }: { status: string; size?: "xs" | "sm" | "md" }) {
  const label = ISSUE_STATUS_LABELS[status as IssueStatus] ?? status;
  return (
    <span className={`badge badge-${size} ${STATUS_CLASS[status] ?? "badge-ghost"} whitespace-nowrap`}>
      {label}
    </span>
  );
}

const WAVE_CLASS: Record<string, string> = {
  PLANNED: "badge-ghost",
  ACTIVE: "badge-primary",
  DONE: "badge-success badge-outline",
};

export function WaveStatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-sm ${WAVE_CLASS[status] ?? "badge-ghost"}`}>{status.toLowerCase()}</span>;
}

const TYPE_CLASS: Record<string, string> = {
  FEATURE: "badge-primary badge-outline",
  BUG: "badge-error badge-outline",
  CHORE: "badge-ghost",
  SPIKE: "badge-accent badge-outline",
};

export function IssueTypeBadge({ type }: { type: string }) {
  return <span className={`badge badge-xs ${TYPE_CLASS[type] ?? "badge-ghost"}`}>{type.toLowerCase()}</span>;
}

export function RoleBadge({ role }: { role: string }) {
  const cls =
    role === "ADMIN"
      ? "badge-secondary"
      : role === "LEAD"
        ? "badge-primary"
        : role === "CLIENT"
          ? "badge-ghost"
          : "badge-accent";
  return <span className={`badge badge-sm ${cls}`}>{role.toLowerCase()}</span>;
}

export function EventKindBadge({ kind }: { kind: string }) {
  const cls: Record<string, string> = {
    COMMIT: "badge-ghost",
    PR_OPENED: "badge-warning badge-outline",
    PR_MERGED: "badge-secondary badge-outline",
    VALIDATED: "badge-success",
    CLAIMED: "badge-info badge-outline",
    STATUS_REPORTED: "badge-info badge-outline",
    HARNESS_INSTALLED: "badge-primary badge-outline",
    MODEL_CALL: "badge-ghost",
    TEMPLATE_REJECTED: "badge-error badge-outline",
  };
  return (
    <span className={`badge badge-xs ${cls[kind] ?? "badge-ghost"} stack-mono`}>
      {kind.toLowerCase().replace(/_/g, " ")}
    </span>
  );
}
