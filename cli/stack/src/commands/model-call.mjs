/**
 * `stack model-call --model M [--item HANDLE] [--tokens-in N] [--tokens-out N]`
 *
 * Proves the two gateway rules of the engagement: only allowlisted models, and
 * only while the project still has budget. Calls POST /api/gateway/model-call.
 */

import { intFlag } from "../args.mjs";
import { UsageError } from "../errors.mjs";
import * as ui from "../ui.mjs";

export const meta = {
  name: "model-call",
  summary: "Ask the gateway whether a model call is allowed",
  usage: "stack model-call --model M [--item HANDLE] [--tokens-in N] [--tokens-out N]",
  detail:
    "Calls POST /api/gateway/model-call and prints allowed/denied, the reason and\n" +
    "the remaining budget. Exit code 1 when the gateway denies the call.",
};

export async function run(ctx) {
  const { key } = await ctx.project();
  const model = ctx.flags.model ? String(ctx.flags.model) : "";
  if (!model) {
    throw new UsageError("missing --model", { fix: meta.usage });
  }
  const tokensIn = intFlag(ctx.flags, "tokens-in", 1200);
  const tokensOut = intFlag(ctx.flags, "tokens-out", 400);
  const session = await ctx.session();
  const handle = ctx.flags.item ? String(ctx.flags.item).toUpperCase() : session?.handle ?? "";

  const api = await ctx.api();
  let response;
  try {
    response = await api.modelCall({
      project: key,
      handle: handle || undefined,
      model,
      tokensIn,
      tokensOut,
    });
  } catch (error) {
    // The portal answers gateway denials over HTTP 403 with { allowed: false, reason }.
    // That is a policy answer, not a transport failure: render it through the
    // normal block below. Anything else stays an error.
    if (error && typeof error === "object" && error.body && error.body.allowed === false) {
      response = error.body;
    } else {
      throw error;
    }
  }

  const allowed = response?.allowed !== false;
  const spend = response?.spend ?? {};

  ctx.emit(
    { project: key, handle: handle || null, model, tokensIn, tokensOut, allowed, response },
    () => {
      ui.heading(`Model call \u00b7 ${key}${handle ? ` \u00b7 ${handle}` : ""}`);
      ui.kv([
        ["model", model, ui.strong],
        ["tokens", `${tokensIn} in / ${tokensOut} out (${tokensIn + tokensOut} total)`],
        ["decision", allowed ? ui.style.green("ALLOWED") : ui.style.red("DENIED")],
        ["reason", response?.reason ?? undefined],
      ]);
      if (spend && Object.keys(spend).length) {
        ui.section("Budget");
        ui.kv([
          ["used", ui.formatUsd(spend.usedUsd)],
          ["budget", ui.formatUsd(spend.budgetUsd)],
          ["remaining", ui.formatUsd(spend.remainingUsd)],
        ]);
      }
      if (!allowed) {
        ui.blank();
        ui.info(`  the gateway refused this call; ask a lead if the budget or the allowlist is wrong`);
      }
    },
  );

  return allowed ? 0 : 1;
}
