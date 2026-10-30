/** `stack status <HANDLE> <STATUS> [--note ...]` — propose a status change. */

import { requirePositional } from "../args.mjs";
import { ApiError } from "../errors.mjs";
import * as ui from "../ui.mjs";
import { issueSummary } from "../render.mjs";

export const meta = {
  name: "status",
  summary: "Propose a status change on an item",
  usage: "stack status <HANDLE> <STATUS> [--note TEXT]",
  detail:
    "Calls POST /api/issues/:handle/status with { status, note? }. When a person has\n" +
    "to make the change the portal answers 409 and its message is printed verbatim.",
};

export async function run(ctx) {
  const handle = requirePositional(ctx, 0, "<HANDLE>", meta.usage).toUpperCase();
  const status = requirePositional(ctx, 1, "<STATUS>", meta.usage).toUpperCase();
  const note = ctx.flags.note ? String(ctx.flags.note) : "";
  const { key } = await ctx.project();
  const api = await ctx.api();

  let response;
  try {
    response = await api.setStatus(handle, { status, note });
  } catch (error) {
    if (error instanceof ApiError && error.portalMessage) {
      ctx.emit(
        { ok: false, handle, status, httpStatus: error.status, portalMessage: error.portalMessage },
        () => {
          ui.heading(`The portal refused the change on ${handle}`);
          ui.blank();
          ui.info(`  ${error.portalMessage}`);
          ui.blank();
          ui.hint(error.status === 409 ? suggestedFix(error, key) : "stack status <HANDLE> <STATUS> --note \"...\"");
        },
      );
      return 1;
    }
    throw error;
  }

  const issue = response?.issue ?? response ?? {};
  ctx.emit({ ok: true, handle, status: issue.status ?? status, issue }, () => {
    ui.heading(`${handle} \u00b7 status change accepted`);
    issueSummary(issue);
    if (note) ui.kv([["note", note]]);
    if (issue.status && String(issue.status).toUpperCase() !== status) {
      ui.blank();
      ui.warn(`the portal recorded ${issue.status}, not the ${status} you asked for`);
    }
  });
  return 0;
}

function suggestedFix(error, key) {
  const body = error?.body && typeof error.body === "object" ? error.body : {};
  for (const candidate of [body.fix, body.next, body.action]) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return `ask a reviewer to move it in the portal: /projects/${key}/board`;
}
