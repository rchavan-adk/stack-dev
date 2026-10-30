import { MODEL_ALLOWLIST } from "@/lib/gateway";

export async function GET() {
  return Response.json({
    ok: true,
    gateway: "mock-litellm",
    note: "Swap this for a real LiteLLM base URL; the policy shape is the same.",
    allowlist: MODEL_ALLOWLIST.map((entry) => entry.model),
  });
}
