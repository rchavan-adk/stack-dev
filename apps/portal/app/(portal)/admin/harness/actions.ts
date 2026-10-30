"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@stack/db";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { packChecksum } from "@/lib/harness";
import { nextDraftVersion } from "@/lib/version";

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * Publishing stamps the version PUBLISHED, freezes who published it and when,
 * computes the checksum (see lib/harness.ts — the seed and the CLI depend on
 * that exact formula) and records an event a dashboard can show.
 */
export async function publishVersion(versionId: string): Promise<void> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) {
    redirect(`/admin/harness?error=${encodeURIComponent("Publishing needs lead or admin rights.")}`);
  }

  const version = await prisma.harnessVersion.findUnique({
    where: { id: versionId },
    include: { pack: true, components: true },
  });
  if (!version) {
    redirect(`/admin/harness?error=${encodeURIComponent("That harness version no longer exists.")}`);
  }
  if (version.status !== "DRAFT") {
    redirect(
      `/admin/harness/${versionId}?error=${encodeURIComponent("Only drafts can be published.")}`,
    );
  }
  if (version.components.length === 0) {
    redirect(
      `/admin/harness/${versionId}?error=${encodeURIComponent(
        "This draft has no components; add files before publishing.",
      )}`,
    );
  }

  const checksum = packChecksum(
    version.components.map((component) => ({
      path: component.path,
      content: component.content,
      mode: component.mode,
    })),
  );

  await prisma.$transaction([
    prisma.harnessVersion.update({
      where: { id: versionId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        publishedById: user.id,
        checksum,
      },
    }),
    // Org-level packs have no project, so there is no project event to write.
    ...(version.pack.projectId
      ? [
          prisma.event.create({
            data: {
              projectId: version.pack.projectId,
              kind: "STATUS_REPORTED",
              actor: user.name,
              summary: `published harness ${version.pack.name} ${version.version}`,
            },
          }),
        ]
      : []),
  ]);

  revalidatePath("/admin/harness");
  revalidatePath(`/admin/harness/${versionId}`);
  redirect(
    `/admin/harness?published=${encodeURIComponent(`${version.pack.name} ${version.version}`)}`,
  );
}

/** One-click clone from a row; the next free minor version is derived server-side. */
export async function cloneVersion(versionId: string): Promise<void> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) {
    redirect(`/admin/harness?error=${encodeURIComponent("Cloning needs lead or admin rights.")}`);
  }

  const source = await prisma.harnessVersion.findUnique({
    where: { id: versionId },
    include: { components: true },
  });
  if (!source) {
    redirect(`/admin/harness?error=${encodeURIComponent("That harness version no longer exists.")}`);
  }

  const siblings = await prisma.harnessVersion.findMany({
    where: { packId: source.packId },
    select: { version: true },
  });
  const nextVersion = nextDraftVersion(
    source.version,
    siblings.map((row) => row.version),
  );

  const draft = await prisma.harnessVersion.create({
    data: {
      packId: source.packId,
      version: nextVersion,
      status: "DRAFT",
      notes: `Cloned from ${source.version}`,
      components: {
        create: source.components.map((component) => ({
          kind: component.kind,
          path: component.path,
          content: component.content,
          mode: component.mode,
        })),
      },
    },
  });

  revalidatePath("/admin/harness");
  redirect(`/admin/harness/${draft.id}?created=${encodeURIComponent(nextVersion)}`);
}

/** The pack-level "New draft" flow: chosen source version plus an explicit version. */
export async function createDraft(packId: string, formData: FormData): Promise<void> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) {
    redirect(`/admin/harness?error=${encodeURIComponent("Creating drafts needs lead or admin rights.")}`);
  }

  const sourceVersionId = String(formData.get("sourceVersionId") ?? "");
  const requested = String(formData.get("version") ?? "").trim();

  const source = await prisma.harnessVersion.findUnique({
    where: { id: sourceVersionId },
    include: { components: true },
  });
  if (!source || source.packId !== packId) {
    redirect(
      `/admin/harness?error=${encodeURIComponent("Choose a source version of this pack.")}`,
    );
  }
  if (!VERSION_RE.test(requested)) {
    redirect(
      `/admin/harness?error=${encodeURIComponent(`"${requested}" is not a version like 0.3.0.`)}`,
    );
  }

  const clash = await prisma.harnessVersion.findUnique({
    where: { packId_version: { packId, version: requested } },
  });
  if (clash) {
    redirect(
      `/admin/harness?error=${encodeURIComponent(
        `Version ${requested} already exists on this pack.`,
      )}`,
    );
  }

  const draft = await prisma.harnessVersion.create({
    data: {
      packId,
      version: requested,
      status: "DRAFT",
      notes: `Cloned from ${source.version}`,
      components: {
        create: source.components.map((component) => ({
          kind: component.kind,
          path: component.path,
          content: component.content,
          mode: component.mode,
        })),
      },
    },
  });

  revalidatePath("/admin/harness");
  redirect(`/admin/harness/${draft.id}?created=${encodeURIComponent(requested)}`);
}

/** Draft-only edit of one file's content; the path is the component identity. */
export async function saveComponent(versionId: string, formData: FormData): Promise<void> {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) {
    redirect(`/admin/harness?error=${encodeURIComponent("Editing packs needs lead or admin rights.")}`);
  }

  const path = String(formData.get("path") ?? "");
  const content = String(formData.get("content") ?? "");
  const version = await prisma.harnessVersion.findUnique({
    where: { id: versionId },
    select: { status: true },
  });
  if (!version) {
    redirect(`/admin/harness?error=${encodeURIComponent("That harness version no longer exists.")}`);
  }
  if (version.status !== "DRAFT") {
    redirect(
      `/admin/harness/${versionId}?file=${encodeURIComponent(path)}&error=${encodeURIComponent(
        "Published versions are immutable. Clone this version to a new draft first.",
      )}`,
    );
  }

  const updated = await prisma.harnessComponent.updateMany({
    where: { versionId, path },
    data: { content },
  });
  if (updated.count === 0) {
    redirect(
      `/admin/harness/${versionId}?error=${encodeURIComponent(`Unknown component "${path}".`)}`,
    );
  }

  revalidatePath(`/admin/harness/${versionId}`);
  revalidatePath("/admin/harness");
  redirect(`/admin/harness/${versionId}?file=${encodeURIComponent(path)}&saved=1`);
}
