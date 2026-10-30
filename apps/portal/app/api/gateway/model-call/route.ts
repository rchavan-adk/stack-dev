import { prisma } from "@stack/db";
import { authenticate, jsonError } from "@/lib/api-auth";
import { costOf, MODEL_ALLOWLIST, priceFor } from "@/lib/gateway";
import { projectSpend } from "@/lib/queries";

export async function POST(request: Request) {
  try {
    const ctx = await authenticate(request);
    const body = (await request.json().catch(() => ({}))) as {
      project?: string;
      handle?: string;
      model?: string;
      tokensIn?: number;
      tokensOut?: number;
    };

    if (!body.project || !body.model) {
      return Response.json({ error: "project and model are required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { key: body.project.toUpperCase() },
    });
    if (!project) return Response.json({ error: `Unknown project ${body.project}` }, { status: 404 });

    const issue = body.handle
      ? await prisma.issue.findUnique({ where: { handle: body.handle.toUpperCase() } })
      : null;

    const tokensIn = Number(body.tokensIn ?? 0);
    const tokensOut = Number(body.tokensOut ?? 0);
    const price = priceFor(body.model);
    const spendBefore = await projectSpend(project.id);

    const deny = async (reason: string) => {
      await prisma.modelCall.create({
        data: {
          projectId: project.id,
          issueId: issue?.id ?? null,
          userId: ctx.user.id,
          model: body.model!,
          tokensIn,
          tokensOut,
          costUsd: 0,
          allowed: false,
          reason,
        },
      });
      await prisma.event.create({
        data: {
          projectId: project.id,
          issueId: issue?.id ?? null,
          kind: "MODEL_CALL",
          actor: ctx.user.name,
          summary: `denied: ${body.model} — ${reason}`,
        },
      });
      return Response.json(
        {
          allowed: false,
          reason,
          allowlist: MODEL_ALLOWLIST.map((entry) => entry.model),
          spend: {
            usedUsd: spendBefore.usedUsd,
            budgetUsd: project.budgetUsd,
            remainingUsd: Number((project.budgetUsd - spendBefore.usedUsd).toFixed(2)),
          },
        },
        { status: 403 },
      );
    };

    if (!price) {
      return deny(`${body.model} is not on the engagement allowlist`);
    }
    if (!body.handle) {
      return deny("every model call must carry an item handle for per-item cost");
    }
    if (!issue) {
      return deny(`unknown item ${body.handle}`);
    }

    const cost = costOf(price, tokensIn, tokensOut);
    if (spendBefore.usedUsd + cost > project.budgetUsd) {
      return deny(
        `engagement budget exhausted (${spendBefore.usedUsd.toFixed(2)} of ${project.budgetUsd} USD used)`,
      );
    }

    await prisma.modelCall.create({
      data: {
        projectId: project.id,
        issueId: issue.id,
        userId: ctx.user.id,
        model: body.model,
        tokensIn,
        tokensOut,
        costUsd: cost,
        allowed: true,
      },
    });

    const spendAfter = await projectSpend(project.id);
    const remaining = Number((project.budgetUsd - spendAfter.usedUsd).toFixed(2));

    return Response.json({
      allowed: true,
      model: body.model,
      handle: issue.handle,
      costUsd: cost,
      spend: { usedUsd: spendAfter.usedUsd, budgetUsd: project.budgetUsd, remainingUsd: remaining },
      warning: remaining < project.budgetUsd * 0.2 ? "under 20 percent of budget remaining" : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
