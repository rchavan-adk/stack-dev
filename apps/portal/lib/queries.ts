import { prisma } from "@stack/db";
import { ISSUE_STATUSES, type IssueStatus } from "@stack/core";

export function parseAcceptance(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function projectByKey(key: string) {
  return prisma.project.findUnique({
    where: { key: key.toUpperCase() },
    include: {
      repos: true,
      waves: { orderBy: { number: "asc" } },
      issues: { select: { id: true, status: true } },
      memberships: { include: { user: true } },
      packs: {
        include: {
          versions: {
            orderBy: { createdAt: "desc" },
            include: { components: { select: { id: true, path: true, kind: true, mode: true } } },
          },
        },
      },
    },
  });
}

export async function statusCounts(projectId: string): Promise<Record<IssueStatus, number>> {
  const grouped = await prisma.issue.groupBy({
    by: ["status"],
    where: { projectId },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(ISSUE_STATUSES.map((status) => [status, 0])) as Record<
    IssueStatus,
    number
  >;
  for (const row of grouped) {
    if (row.status in counts) counts[row.status as IssueStatus] = row._count._all;
  }
  return counts;
}

export async function publishedPack(projectId: string) {
  const pack = await prisma.harnessPack.findFirst({
    where: { projectId },
    include: {
      versions: {
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 1,
        include: { components: true, publishedBy: true },
      },
    },
  });
  if (!pack || pack.versions.length === 0) return null;
  return { pack, version: pack.versions[0] };
}

export async function activeTemplate(kind: "ISSUE" | "SPEC" | "WAVE") {
  return prisma.template.findFirst({
    where: { kind, active: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function recentEvents(projectId: string, take = 25) {
  return prisma.event.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take,
    include: { issue: { select: { handle: true, title: true } } },
  });
}
