/**
 * Mock LiteLLM gateway policy. In the real system this lives in LiteLLM itself:
 * per-engagement allowlist, per-person budgets and a spend log. The portal only
 * records the evidence, which is why cost per item is available without extra tooling.
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

export function costOf(price: ModelPrice, tokensIn: number, tokensOut: number): number {
  const cost =
    (tokensIn / 1_000_000) * price.inPerMillion + (tokensOut / 1_000_000) * price.outPerMillion;
  return Number(cost.toFixed(4));
}
