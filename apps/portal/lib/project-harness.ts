import { prisma } from "@stack/db";

interface DefaultHarnessVersion {
  version: string;
  pack: { name: string; description: string };
  components: Array<{ kind: string; path: string; content: string; mode: string }>;
}

async function defaultHarnessVersion(): Promise<DefaultHarnessVersion | null> {
  return prisma.harnessVersion.findFirst({
    where: {
      status: "PUBLISHED",
      pack: { projectId: null, name: "miracle-default" },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    include: {
      pack: { select: { name: true, description: true } },
      components: { orderBy: { path: "asc" } },
    },
  });
}

function projectPackMetadata(source: DefaultHarnessVersion): {
  name: string;
  description: string;
} {
  const manifestFile = source.components.find((component) => component.path === "pack.json");
  if (manifestFile) {
    try {
      const manifest = JSON.parse(manifestFile.content) as {
        name?: unknown;
        description?: unknown;
      };
      if (typeof manifest.name === "string" && typeof manifest.description === "string") {
        return { name: manifest.name, description: manifest.description };
      }
    } catch {
      // Fall back to the database metadata if the stored manifest is malformed.
    }
  }

  return { name: source.pack.name, description: source.pack.description };
}

/**
 * Give a new project an editable copy of the published org default.
 *
 * The project starts with a DRAFT rather than a published version: developers
 * continue using the org default until the lead has tailored and published the
 * project pack.
 */
export async function createInitialProjectHarness(projectId: string): Promise<{
  created: boolean;
  reason?: string;
}> {
  const existing = await prisma.harnessPack.findFirst({
    where: { projectId },
    select: { id: true },
  });
  if (existing) return { created: false, reason: "A project harness already exists." };

  const source = await defaultHarnessVersion();
  if (!source) {
    return {
      created: false,
      reason: "No published org default harness exists. Run product bootstrap first.",
    };
  }

  const metadata = projectPackMetadata(source);
  await prisma.harnessPack.create({
    data: {
      projectId,
      name: metadata.name,
      description: metadata.description,
      versions: {
        create: {
          version: source.version,
          status: "DRAFT",
          notes: `Initial project draft cloned from the org default ${source.version}.`,
          components: {
            create: source.components.map((component) => ({
              kind: component.kind,
              path: component.path,
              content: component.content,
              mode: component.mode,
            })),
          },
        },
      },
    },
  });

  return { created: true };
}
