// What a Gemini call costs (decision #67). Google's list prices for the paid tier, in USD per 1M tokens, copied from
// the official pricing page with the date they were checked. Output prices include the model's thinking tokens, as
// Google bills them. A model not listed here is shown as "price unknown", never guessed (AGENTS.md rule 2).
// On the free tier Google charges nothing; these are what the same calls cost on a paid key.

export const PRICE_SOURCE = { url: "https://ai.google.dev/gemini-api/docs/pricing", checked: "2026-11-15" };

/** [model, from (inclusive) or null, until (exclusive) or null, input per 1M, output per 1M, note] */
export const PRICES = [
  ["gemini-3.8-flash", null, "2027-01-01", 0.75, 3.75, "introductory price until 31 Dec 2026"],
  ["gemini-3.8-flash", "2027-01-01", null, 1.5, 7.5, "standard price"],
  ["gemini-3.5-flash-lite", null, null, 0.3, 2.5, "standard price"],
].map(([model, from, until, input, output, note]) => ({ model, from: from ? new Date(from) : null, until: until ? new Date(until) : null, input, output, note }));

/** "models/gemini-3.5-flash-lite-001" → "gemini-3.5-flash-lite" (longest listed name it starts with). */
const listedName = (model) => {
  const name = String(model ?? "").replace(/^models\//, "");
  return [...new Set(PRICES.map((p) => p.model))].sort((a, b) => b.length - a.length).find((m) => name === m || name.startsWith(`${m}-`)) ?? null;
};

/** The price in force for `model` at `at`, or null when the model isn't listed. */
export function priceFor(model, at = new Date()) {
  const name = listedName(model);
  if (!name) return null;
  return PRICES.find((p) => p.model === name && (!p.from || at >= p.from) && (!p.until || at < p.until)) ?? null;
}

/** Tokens from Gemini's usageMetadata. Output = the answer plus the thinking, which is billed as output. */
export function tokensOf(usage) {
  const inputTokens = Number(usage?.promptTokenCount ?? 0);
  const thinkingTokens = Number(usage?.thoughtsTokenCount ?? 0);
  const outputTokens = Number(usage?.candidatesTokenCount ?? 0) + thinkingTokens;
  return { inputTokens, outputTokens, thinkingTokens };
}

/** USD for one call, rounded to a billionth of a dollar; `priced` false when the model has no listed price. */
export function costOf({ model, inputTokens = 0, outputTokens = 0, at = new Date() }) {
  const price = priceFor(model, at);
  if (!price) return { costUsd: 0, priced: false };
  const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return { costUsd: Math.round(usd * 1e9) / 1e9, priced: true };
}

/** The price list as the Logs page shows it. */
export const priceList = () => ({
  source: PRICE_SOURCE.url,
  checked: PRICE_SOURCE.checked,
  models: PRICES.map((p) => ({ model: p.model, from: p.from, until: p.until, inputPerMillion: p.input, outputPerMillion: p.output, note: p.note })),
});
