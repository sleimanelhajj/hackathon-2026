// Inventory facts for reply drafts (decision #57). The products an email mentions are matched against the store's
// catalogue (by SKU, or by the significant words of a product's name), and their live stock and list price go to the
// reply drafter, so a request for 10 solar panels with 9 in stock gets a reply that says how many are available.
// Matching is plain code, not AI: the drafter only ever sees products that really exist, with numbers from Postgres.
import { DEFAULT_SCHEMA, getPool, postgresConfigured } from "../sales/db.js";

const STOP = new Set(["kit", "set", "pack", "of", "with", "the", "and", "for", "in", "x", "mm", "cm", "m", "pcs", "piece", "pieces", "box", "new"]);
const MAX = 5;

/** "Panels," → "panel"; "batteries" → "battery". Enough for product names, without a stemming library. */
const stem = (w) => w.replace(/ies$/, "y").replace(/(ss)$/, "$1").replace(/(?<!s)s$/, "");
const words = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9/.-]+/g, " ").split(/[\s/]+/).map((w) => w.replace(/^[-.]+|[-.]+$/g, "")).filter(Boolean).map(stem);
/** The words that identify a product: letters only (sizes like 450W or 20V are optional), no filler words. */
const keyWords = (name) => [...new Set(words(name).filter((w) => /[a-z]{3,}/.test(w) && !/\d/.test(w) && !STOP.has(w)))];

/**
 * Products the text mentions: an exact SKU, or a name whose key words mostly appear (at least two of them, or the
 * only one). Best matches first, at most five.
 */
export function matchProducts(text, products) {
  const hay = new Set(words(text));
  const raw = String(text ?? "").toUpperCase();
  const scored = [];
  for (const p of products) {
    if (p.sku && new RegExp(`\\b${p.sku.replace(/[-]/g, "\\-")}\\b`).test(raw)) { scored.push({ p, score: 100 }); continue; }
    const key = keyWords(p.name);
    if (!key.length) continue;
    const hits = key.filter((w) => hay.has(w)).length;
    const enough = key.length === 1 ? hits === 1 && key[0].length >= 5 : hits >= 2 && hits / key.length >= 0.5;
    if (enough) scored.push({ p, score: hits / key.length + hits / 100 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX).map((s) => s.p);
}

/** What the drafter is told per product: stock, unit, list price, and a plain status. */
export function inventoryFacts(products) {
  return products.map((p) => {
    const stock = p.stock === null || p.stock === undefined ? null : Number(p.stock);
    const status = stock === null ? "unknown" : stock <= 0 ? "out of stock" : stock <= Number(p.reorder_level ?? 0) ? "low" : "in stock";
    return { sku: p.sku, name: p.name, inStock: stock, unit: p.unit ?? null, listPriceUSD: Number(p.unit_price), status };
  });
}

/** Live facts for the products the text mentions; [] when Postgres isn't set up or nothing matches. */
export async function inventoryFor(text, { pool = postgresConfigured() ? getPool() : null, schema = DEFAULT_SCHEMA } = {}) {
  if (!pool || !text) return [];
  const { rows } = await pool.query(`SELECT sku, name, unit_price, stock, unit, reorder_level FROM "${schema}".products`);
  return inventoryFacts(matchProducts(text, rows));
}
