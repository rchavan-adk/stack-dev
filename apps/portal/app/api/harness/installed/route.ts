import { prisma } from "@stack/db";
import { authenticate, jsonError } from "@/lib/api-auth";

/** The CLI reports a completed install so the portal can show who runs which pack version. */
export async function POST(request: Request) {
  try {
    const ctx = await authenticate(request);
    const body = (await request.json().catch(() => ({}))) as {
      project?: string;
      version?: string;
      repo?: string;
    };

    if (!body.project || !body.version) {
      return Response.json({ error: "project and version are required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { key: body.project.toUpperCase() },
    });
    if (!project) return Response.json({ error: `Unknown project ${body.project}` }, { status: 404 });

    await prisma.event.create({
      data: {
        projectId: project.id,
        kind: "HARNESS_INSTALLED",
        actor: ctx.user.name,
        summary: `harness ${body.version} installed${body.repo ? ` in ${body.repo}` : ""}`,
        payload: JSON.stringify({ version: body.version, repo: body.repo ?? null }),
      },
    });

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
