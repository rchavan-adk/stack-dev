import { parseTemplateDefinition, renderTemplateSkeleton, TEMPLATE_KINDS } from "@stack/core";
import { authenticate, jsonError } from "@/lib/api-auth";
import { activeTemplate } from "@/lib/queries";

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    await authenticate(request);
    const { kind } = await params;
    const upper = kind.toUpperCase() as (typeof TEMPLATE_KINDS)[number];

    if (!TEMPLATE_KINDS.includes(upper)) {
      return Response.json(
        { error: `kind must be one of ${TEMPLATE_KINDS.join(", ")}` },
        { status: 400 },
      );
    }

    const template = await activeTemplate(upper);
    if (!template) return Response.json({ error: `No active ${upper} template` }, { status: 404 });

    const definition = parseTemplateDefinition(template.definition);

    return Response.json({
      template: {
        kind: template.kind,
        name: template.name,
        version: template.version,
        definition,
      },
      skeleton: renderTemplateSkeleton(definition),
    });
  } catch (error) {
    return jsonError(error);
  }
}
