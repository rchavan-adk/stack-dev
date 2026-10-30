/**
 * Gateway policy shared by every Stack surface: the portal's policy endpoint
 * (the mock that tests and the README walkthrough use) and the real gateway
 * service (apps/gateway) that proxies Anthropic. One allowlist, one price
 * table, one cost formula — so a model call costs the same wherever it lands.
 */

export interface ModelPrice {
  model: string;
  inPerMillion: number;
  outPerMillion: number;
}

export const MODEL_ALLOWLIST: ModelPrice[] = [
  { model: "claude-sonnet-5", inPerMillion: 3, outPerMillion: 15 },
  { model: "claude-haiku-4.5", inPerMillion: 0.8, outPerMillion: 4 },
  { model: "gpt-5.2", inPerMillion: 2.5, outPerMillion: 10 },
  { model: "gpt-5.2-mini", inPerMillion: 0.4, outPerMillion: 1.6 },
];

export function priceFor(model: string): ModelPrice | undefined {
  return MODEL_ALLOWLIST.find((entry) => entry.model === model);
}

/**
 * Six decimals, not two: a real agent call can cost a few thousandths of a
 * cent, and rounding those to zero means a busy engagement meters nothing at
 * all. The ledger keeps the precision; display layers round for people.
 */
export function costOf(price: ModelPrice, tokensIn: number, tokensOut: number): number {
  const cost =
    (tokensIn / 1_000_000) * price.inPerMillion + (tokensOut / 1_000_000) * price.outPerMillion;
  return Number(cost.toFixed(6));
}

/**
 * Provider routing for the real gateway. The engagement allowlist is a plan
 * (which models the engagement pays for); routing is a fact (which providers
 * this deployment holds credentials for). An allowlisted model without
 * credentials is denied with a clear reason instead of failing obscurely
 * upstream.
 */
export function providerFor(model: string): "anthropic" | null {
  if (model.startsWith("claude-")) return "anthropic";
  return null;
}
