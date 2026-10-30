/**
 * The proxy core: token auth → item attribution → engagement policy →
 * Anthropic → spend metering. This is the real counterpart of the portal's
 * policy endpoint (apps/portal/app/api/gateway/model-call): same allowlist,
 * same prices, same budget math, same evidence ledger — but the call is
 * actually forwarded to https://api.anthropic.com/v1/messages and metered
 * from real usage, not self-reported token counts.
 */
// tsx loads @stack/core as CommonJS, so import concrete source files (like apps/mcp does).
import { costOf, MODEL_ALLOWLIST, priceFor, providerFor } from "@stack/core/src/gateway";
import { prisma } from "@stack/db";
import type { Issue, Project, User } from "@stack/db";
import type { Request, Response } from "express";
import { AuthError, resolveProject, resolveToken } from "./auth";
import type { TokenContext } from "./auth";
import { anthropicMessagesUrl, requireItem } from "./env";
import { upstreamModel } from "./models";

const BUDGET_WARN_FRACTION = 0.2;
const ITEM_REQUIRED =
  "every model call must carry an item handle (X-Stack-Item header or metadata.user_id)";

interface CallBody {
  model?: unknown;
  stream?: unknown;
  metadata?: { user_id?: unknown } | null;
  [key: string]: unknown;
}

/** Anthropic-shaped error so SDK clients parse denials natively. */
function errorPayload(type: string, message: string) {
  return { type: "error", error: { type, message } };
}

function denyRaw(res: Response, status: number, type: string, message: string): void {
  res.status(status).json(errorPayload(type, message));
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.toLowerCase().startsWith("bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
}

export function health(): Record<string, unknown> {
  const allowlist = MODEL_ALLOWLIST.map((entry) => entry.model);
  const routed = MODEL_ALLOWLIST.filter((entry) => providerFor(entry.model)).map(
    (entry) => entry.model,
  );
  return {
    ok: true,
    gateway: "stack-gateway",
    provider: "anthropic",
    providerConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    allowlist,
    routed,
    requireItem: requireItem(),
  };
}

interface CallContext {
  project: Project;
  user: User;
  issue: Issue | null;
  model: string;
}

/** Mirror the portal mock: a denial is a ledger row (ModelCall) plus an Event. */
async function recordDeny(ctx: CallContext, reason: string): Promise<void> {
  await prisma.modelCall.create({
    data: {
      projectId: ctx.project.id,
      issueId: ctx.issue?.id ?? null,
      userId: ctx.user.id,
      model: ctx.model,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      allowed: false,
      reason,
    },
  });
  await prisma.event.create({
    data: {
      projectId: ctx.project.id,
      issueId: ctx.issue?.id ?? null,
      kind: "MODEL_CALL",
      actor: ctx.user.name,
      summary: `denied: ${ctx.model} — ${reason}`,
    },
  });
}

async function spendUsd(projectId: string): Promise<number> {
  const spend = await prisma.modelCall.aggregate({
    _sum: { costUsd: true },
    where: { projectId, allowed: true },
  });
  return spend._sum.costUsd ?? 0;
}

/**
 * The portal mock trusts self-reported tokens and denies up front. A real
 * proxy cannot know the cost before the call, so the budget check is: refuse
 * to start a call when the engagement is already at budget, meter the call
 * honestly afterwards, and let the ledger show any overage — the next call
 * is then refused. Documented in README.md.
 */
async function handleMessages(req: Request, res: Response): Promise<void> {
  let auth: TokenContext;
  try {
    auth = await resolveToken(req.header("x-api-key") || bearerToken(req.header("authorization")));
  } catch (error) {
    if (error instanceof AuthError) {
      denyRaw(res, 401, "authentication_error", error.message);
      return;
    }
    throw error;
  }

  const body = (req.body ?? {}) as CallBody;
  const model = typeof body.model === "string" ? body.model : "";
  if (!model) {
    denyRaw(res, 400, "invalid_request_error", "body must include a model string");
    return;
  }

  // Item attribution: the header agents should send, with metadata.user_id as
  // the standards-shaped fallback for clients that cannot set custom headers.
  const metadataHandle =
    body.metadata && typeof body.metadata.user_id === "string"
      ? body.metadata.user_id.toUpperCase()
      : "";
  const item = (req.header("x-stack-item") ?? metadataHandle).toUpperCase();

  let issue: Issue | null = null;
  if (item) {
    issue = await prisma.issue.findUnique({ where: { handle: item } });
  }

  // Which engagement pays for this call: the token's scope, an explicit
  // header, or — the normal agent case — the project that owns the item.
  let project: Project;
  try {
    project = await resolveProject(auth, req.header("x-stack-project"), issue);
  } catch (error) {
    if (error instanceof AuthError) {
      // Nothing is ledgered here: without an engagement there is no ledger to
      // write to. An unknown handle is the likeliest cause when the call
      // named nothing else.
      if (item && !issue) {
        denyRaw(res, 400, "invalid_request_error", `unknown item ${item}`);
        return;
      }
      if (!item && requireItem()) {
        denyRaw(res, 400, "invalid_request_error", ITEM_REQUIRED);
        return;
      }
      denyRaw(res, 403, "permission_error", error.message);
      return;
    }
    throw error;
  }

  const ctx: CallContext = { project, user: auth.user, issue, model };

  // 1. Engagement allowlist (the plan).
  const price = priceFor(model);
  if (!price) {
    const reason = `${model} is not on the engagement allowlist`;
    await recordDeny(ctx, reason);
    denyRaw(res, 403, "permission_error", reason);
    return;
  }

  // 2. Provider routing (the facts): allowlisted models this gateway holds
  //    no credentials for are refused with a clear reason.
  const provider = providerFor(model);
  if (!provider) {
    const reason =
      `${model} is allowlisted but not routed through this gateway (no provider credentials); ` +
      `use a ${model.startsWith("gpt") ? "claude-*" : "routed"} model or ask the lead to add a provider`;
    await recordDeny(ctx, reason);
    denyRaw(res, 403, "permission_error", reason);
    return;
  }

  // 3. Item attribution (the point of the system).
  if (!item && requireItem()) {
    await recordDeny(ctx, ITEM_REQUIRED);
    denyRaw(res, 400, "invalid_request_error", ITEM_REQUIRED);
    return;
  }
  if (item && !issue) {
    const reason = `unknown item ${item}`;
    await recordDeny(ctx, reason);
    denyRaw(res, 400, "invalid_request_error", reason);
    return;
  }
  if (issue && issue.projectId !== ctx.project.id) {
    const reason = `item ${issue.handle} does not belong to project ${ctx.project.key}`;
    await recordDeny(ctx, reason);
    denyRaw(res, 400, "invalid_request_error", reason);
    return;
  }

  // 4. Budget.
  const usedBefore = await spendUsd(ctx.project.id);
  if (usedBefore >= ctx.project.budgetUsd) {
    const reason = `engagement budget exhausted (${usedBefore.toFixed(2)} of ${ctx.project.budgetUsd} USD used)`;
    await recordDeny(ctx, reason);
    denyRaw(res, 403, "permission_error", reason);
    return;
  }

  // 5. Forward to the provider.
  const providerKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!providerKey) {
    console.error("[gateway] ANTHROPIC_API_KEY missing; refusing to forward");
    denyRaw(res, 503, "api_error", "gateway has no provider credentials configured; call not forwarded");
    return;
  }

  const upstream = await fetch(anthropicMessagesUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": providerKey,
      authorization: `Bearer ${providerKey}`,
      "anthropic-version": req.header("anthropic-version") ?? "2023-06-01",
      ...(req.header("anthropic-beta")
        ? { "anthropic-beta": req.header("anthropic-beta") as string }
        : {}),
    },
    // The ledger keeps the engagement model name; the provider gets its own ID.
    body: JSON.stringify({ ...body, model: upstreamModel(model) }),
  });

  if (!upstream.ok) {
    // Operational failure (or a 4xx the client caused): pass Anthropic's
    // error through verbatim so SDKs see it, and ledger the attempt.
    const text = await upstream.text();
    let upstreamMessage = `provider responded ${upstream.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) upstreamMessage += `: ${parsed.error.message}`;
    } catch {
      /* non-JSON error body; keep the status-only reason */
    }
    console.warn(`[gateway] provider error for ${model}: ${upstream.status} ${upstreamMessage}`);
    await prisma.modelCall.create({
      data: {
        projectId: ctx.project.id,
        issueId: issue?.id ?? null,
        userId: ctx.user.id,
        model,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        allowed: false,
        reason: upstreamMessage,
      },
    });
    res
      .status(upstream.status)
      .set("content-type", upstream.headers.get("content-type") ?? "application/json")
      .send(text);
    return;
  }

  // A streamed response has already sent its headers by the time the cost is
  // known, so the x-stack-* receipt is only available on non-streaming calls.
  // The ledger row is written either way; that is the record that counts.
  const finish = async (tokensIn: number, tokensOut: number, canSetHeaders = true): Promise<void> => {
    const cost = costOf(price, tokensIn, tokensOut);
    await prisma.modelCall.create({
      data: {
        projectId: ctx.project.id,
        issueId: issue?.id ?? null,
        userId: ctx.user.id,
        model,
        tokensIn,
        tokensOut,
        costUsd: cost,
        allowed: true,
      },
    });
    const remaining = ctx.project.budgetUsd - (usedBefore + cost);
    if (canSetHeaders && !res.headersSent) {
      res.set("x-stack-item", issue?.handle ?? "");
      res.set("x-stack-cost-usd", cost.toFixed(6));
      res.set("x-stack-spend-usd", (usedBefore + cost).toFixed(6));
      if (remaining < ctx.project.budgetUsd * BUDGET_WARN_FRACTION) {
        res.set("x-stack-budget-warning", "under 20 percent of budget remaining");
      }
    }
    console.log(
      `[gateway] ${model} ${issue?.handle ?? "unattributed"} in=${tokensIn} out=${tokensOut} $${cost.toFixed(6)} spend=$${(usedBefore + cost).toFixed(4)}/${ctx.project.budgetUsd}`,
    );
  };

  if (body.stream === true) {
    // Stream: pipe SSE through untouched, parse usage out of the events,
    // meter when the stream ends. Meter even if the client disconnects.
    res
      .status(200)
      .set("content-type", upstream.headers.get("content-type") ?? "text/event-stream")
      .set("cache-control", "no-cache");
    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    let sse = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          sse += decoder.decode(value, { stream: true });
          try {
            res.write(Buffer.from(value));
          } catch {
            break; // client went away; upstream reader is cancelled in finally
          }
        }
      }
    } finally {
      try {
        reader.cancel();
      } catch {
        /* upstream already done */
      }
      try {
        res.end();
      } catch {
        /* client gone */
      }
      const usage = parseStreamUsage(sse);
      try {
        await finish(usage.tokensIn, usage.tokensOut, false);
      } catch (error) {
        // The client already has its answer; a metering failure must be loud
        // in the log rather than a 500 written onto a finished response.
        console.error("[gateway] failed to meter a streamed call:", error);
      }
    }
    return;
  }

  const payload = (await upstream.json()) as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  const usage = payload.usage ?? {};
  // Cache tokens are metered at the plain input rate (writes actually cost
  // 1.25x, reads 0.1x); keeping the shared formula matters more here than
  // the rounding. Noted in README.
  const tokensIn =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  const tokensOut = usage.output_tokens ?? 0;
  await finish(tokensIn, tokensOut);
  res.status(200).json(payload);
}

/** Pull final usage out of an Anthropic SSE transcript. */
export function parseStreamUsage(sse: string): { tokensIn: number; tokensOut: number } {
  let tokensIn = 0;
  let tokensOut = 0;
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const event = JSON.parse(raw) as {
        type?: string;
        message?: { usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };
        usage?: { output_tokens?: number };
      };
      if (event.type === "message_start" && event.message?.usage) {
        tokensIn =
          (event.message.usage.input_tokens ?? 0) +
          (event.message.usage.cache_creation_input_tokens ?? 0) +
          (event.message.usage.cache_read_input_tokens ?? 0);
      }
      if (event.type === "message_delta" && event.usage) {
        tokensOut = event.usage.output_tokens ?? 0;
      }
    } catch {
      /* skip events that are not JSON */
    }
  }
  return { tokensIn, tokensOut };
}

export { handleMessages };
