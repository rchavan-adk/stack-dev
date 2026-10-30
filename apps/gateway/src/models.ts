/**
 * Engagement model names are plan-level labels (what the contract allows and
 * what it is priced at). Providers have their own IDs, and they change on
 * their own schedule. This map is the seam between the two: the allowlist and
 * the ledger keep the engagement name, the upstream call uses the provider ID.
 *
 * Override per deployment with STACK_MODEL_MAP, e.g.
 *   STACK_MODEL_MAP="claude-sonnet-5=claude-sonnet-4-5,claude-haiku-4.5=claude-haiku-4-5"
 */
const DEFAULT_MAP: Record<string, string> = {
  "claude-sonnet-5": "claude-sonnet-4-5",
  "claude-haiku-4.5": "claude-haiku-4-5",
};

function overrides(): Record<string, string> {
  const raw = process.env.STACK_MODEL_MAP ?? "";
  const map: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [from, to] = pair.split("=").map((part) => part.trim());
    if (from && to) map[from] = to;
  }
  return map;
}

/** Provider-side model ID for an engagement model name. */
export function upstreamModel(model: string): string {
  return overrides()[model] ?? DEFAULT_MAP[model] ?? model;
}
