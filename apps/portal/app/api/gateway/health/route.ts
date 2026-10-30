import { MODEL_ALLOWLIST } from "@/lib/gateway";

export async function GET() {
  return Response.json({
    ok: true,
    gateway: "stack-gateway",
    note: "Engagement policy and prices live in packages/core/src/gateway.ts; real calls are metered by the gateway service.",
    allowlist: MODEL_ALLOWLIST.map((entry) => entry.model),
  });
}
