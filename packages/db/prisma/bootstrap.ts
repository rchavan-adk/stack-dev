/**
 * Installs the product defaults into a deployment.
 *
 * The seed script is for development: it wipes the database and fills it with
 * demo users, projects and API tokens whose values are published in this
 * repository. Running it against a live deployment would create working
 * credentials that anyone with the source could use, so a deployment gets this
 * script instead.
 *
 * It installs only what the product genuinely ships with:
 *
 *   - the issue, spec and wave templates every project starts from
 *   - the org-level default harness pack, which is what `stack harness install`
 *     fetches before a project has published its own
 *
 * It is safe to run more than once: anything already present is left alone.
 *
 * Run it after creating the first administrator at /setup, because a published
 * harness version records who published it.
 *
 *   npm -w @stack/db run bootstrap
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_TEMPLATES, loadPackFromDisk, packChecksum } from "./defaults";

const prisma = new PrismaClient();

const DEFAULT_PACK_NAME = "miracle-default";

async function main(): Promise<void> {
  const templateCount = await prisma.template.count();
  if (templateCount === 0) {
    await prisma.template.createMany({
      data: DEFAULT_TEMPLATES.map((template) => ({
        kind: template.kind,
        name: template.name,
        version: template.version,
        definition: JSON.stringify(template.definition),
        active: true,
      })),
    });
    console.log(`templates  ${DEFAULT_TEMPLATES.length} created`);
  } else {
    console.log(`templates  ${templateCount} already present, left alone`);
  }

  // A published version records its publisher, so there has to be an
  // administrator first. /setup creates exactly one and then closes itself.
  const publisher = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
  });
  if (!publisher) {
    throw new Error(
      "No administrator exists yet. Open /setup in the portal, create the first " +
        "admin, then run this again.",
    );
  }

  const existing = await prisma.harnessPack.findFirst({
    where: { projectId: null, name: DEFAULT_PACK_NAME },
  });
  if (existing) {
    const versions = await prisma.harnessVersion.count({ where: { packId: existing.id } });
    console.log(`pack       ${DEFAULT_PACK_NAME} already present (${versions} version(s)), left alone`);
    return;
  }

  const { manifest, files } = loadPackFromDisk();
  const pack = await prisma.harnessPack.create({
    data: {
      projectId: null,
      name: DEFAULT_PACK_NAME,
      description:
        "The Miracle default harness every developer starts with before joining a project.",
    },
  });
  const version = await prisma.harnessVersion.create({
    data: {
      packId: pack.id,
      version: manifest.version,
      status: "PUBLISHED",
      notes:
        "Default harness: item-handle commits and gateway-only model calls before a project pack exists.",
      checksum: packChecksum(files),
      publishedAt: new Date(),
      publishedById: publisher.id,
      components: {
        create: files.map((file) => ({
          kind: file.kind,
          path: file.path,
          content: file.content,
          mode: file.mode,
        })),
      },
    },
  });

  console.log(`pack       ${DEFAULT_PACK_NAME} ${version.version} published (${files.length} files)`);
  console.log(`publisher  ${publisher.name} <${publisher.email}>`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
