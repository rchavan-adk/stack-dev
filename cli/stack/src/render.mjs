/** Shared renderers so tables look the same everywhere. */

import * as ui from "./ui.mjs";

const STATUS_COLOURS = {
  BACKLOG: ui.style.gray,
  READY: ui.style.blue,
  TODO: ui.style.gray,
  IN_PROGRESS: ui.style.yellow,
  IN_REVIEW: ui.style.cyan,
  AWAITING_VALIDATION: ui.style.magenta,
  BLOCKED: ui.style.red,
  DONE: ui.style.green,
};

export function statusColour(status) {
  const colour = STATUS_COLOURS[String(status ?? "").toUpperCase()];
  return colour ?? ui.style.gray;
}

export function maskToken(token) {
  const value = String(token ?? "");
  if (!value) return "(none)";
  if (value.length <= 8) return "****";
  const prefix = value.split("_").slice(0, 2).join("_");
  return `${prefix}_\u2026${value.slice(-4)}`;
}

export function projectRow(project) {
  return {
    key: project?.key ?? "",
    name: project?.name ?? "",
    role: project?.role ?? "",
    client: project?.client ?? "",
    status: project?.status ?? "",
    waves: project?.waves ?? "",
    open: project?.openIssues ?? "",
    mine: project?.assignedToMe ?? "",
  };
}

export function projectsTable(projects, { showRole = true, showClient = false } = {}) {
  const rows = (projects ?? []).map(projectRow);
  const columns = [
    { header: "KEY", key: "key", width: 22 },
    { header: "NAME", key: "name", width: 30 },
  ];
  if (showClient) columns.push({ header: "CLIENT", key: "client", width: 18 });
  if (showRole) columns.push({ header: "ROLE", key: "role", width: 12 });
  columns.push(
    { header: "STATUS", key: "status", width: 14 },
    { header: "WAVES", key: "waves", width: 6, align: "right" },
    { header: "OPEN", key: "open", width: 5, align: "right" },
    { header: "MINE", key: "mine", width: 5, align: "right" },
  );
  ui.table(columns, rows);
}

export function issueRow(issue) {
  return {
    handle: issue?.handle ?? "",
    status: issue?.status ?? "",
    title: issue?.title ?? "",
    wave: issue?.wave ?? "",
    estimate: issue?.estimate ?? "",
    type: issue?.type ?? "",
    assignee: issue?.assignee ?? "",
  };
}

export function issuesTable(issues) {
  ui.table(
    [
      { header: "HANDLE", key: "handle", width: 14 },
      { header: "STATUS", key: "status", width: 20, colour: (text) => statusColour(text)(text) },
      { header: "TITLE", key: "title", width: 46 },
      { header: "WAVE", key: "wave", width: 6 },
      { header: "EST", key: "estimate", width: 6, align: "right" },
    ],
    (issues ?? []).map(issueRow),
  );
}

/** One-line summary used by claim/status output. */
export function issueSummary(issue) {
  if (!issue) return;
  ui.kv([
    ["handle", issue.handle, ui.strong],
    ["title", issue.title],
    ["status", issue.status, (text) => statusColour(text)(text)],
    ["wave", issue.wave],
    ["estimate", issue.estimate],
    ["assignee", issue.assignee],
  ]);
}
