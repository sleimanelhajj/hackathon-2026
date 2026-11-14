// The assistant's read-only sales tools (server/agent/sales-tools.js), checked against real Postgres with the demo
// hardware-store data in a throwaway schema. Needs POSTGRES_URL (in .env); skipped without it.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { generateSalesData, STORE_PROFILE } from "../../server/sales/seed.js";

const url = process.env.POSTGRES_URL;
const skip = url ? false : "POSTGRES_URL is not set";
const now = new Date("2026-11-14T12:00:00Z");
const schema = `test_tools_${process.pid}`;
const data = generateSalesData({ seed: 5, months: 24, now });

let pool, tools;
before(async () => {
  if (skip) return;
  const db = await import("../../server/sales/db.js");
  const { createSalesTools } = await import("../../server/agent/sales-tools.js");
  pool = db.createPool(url);
  await db.createSchema(pool, schema);
  await db.loadData(pool, schema, data);
  tools = createSalesTools({ pool, schema, now: () => now });
});
after(async () => {
  if (!pool) return;
  const db = await import("../../server/sales/db.js");
  await db.dropSchema(pool, schema);
  await pool.end();
});

test("finds products for a situation, by what they're for", { skip }, async () => {
  const { products } = await tools.run("find_products", { query: "leaking pipe under the sink" });
  assert.ok(products.length > 0 && products.length <= 8);
  assert.ok(products.some((p) => p.category === "Plumbing"), products.map((p) => p.name).join(", "));
  for (const p of products) assert.ok(p.sku && p.price > 0 && typeof p.stock === "number" && p.description);
});

test("respects a budget and a category", { skip }, async () => {
  const { products } = await tools.run("find_products", { query: "drill", category: "Power tools", maxPrice: 100 });
  assert.ok(products.length > 0);
  for (const p of products) assert.ok(p.price <= 100 && p.category === "Power tools", `${p.name} $${p.price}`);
});

test("breakdowns add up to the summary total", { skip }, async () => {
  const summary = await tools.run("sales_summary", { months: 6 });
  const { rows } = await tools.run("sales_breakdown", { by: "category", months: 6, limit: 50 });
  const sum = rows.reduce((s, r) => s + r.revenue, 0);
  assert.ok(Math.abs(sum - summary.revenue) < 1, `${sum} vs ${summary.revenue}`);
  assert.ok(summary.orders > 0 && summary.period.from && summary.period.to);
});

test("breakdowns compare each row with the previous period, so 'what grew most' is answerable", { skip }, async () => {
  const summary = await tools.run("sales_summary", { months: 1 });
  const { rows, previousPeriod } = await tools.run("sales_breakdown", { by: "category", months: 1, limit: 50 });
  assert.ok(previousPeriod.from && previousPeriod.to);
  const prev = rows.reduce((s, r) => s + r.previousRevenue, 0);
  assert.ok(Math.abs(prev - summary.previousRevenue) < 1, `${prev} vs ${summary.previousRevenue}`);
  for (const r of rows) {
    if (r.previousRevenue > 0) assert.equal(r.changePct, Math.round(((r.revenue - r.previousRevenue) / r.previousRevenue) * 1000) / 10);
  }
});

test("breaks sales down by any allowed dimension, and refuses others", { skip }, async () => {
  for (const by of ["product", "customer", "branch", "staff", "month", "channel", "segment"]) {
    const { rows } = await tools.run("sales_breakdown", { by, months: 3, limit: 5 });
    assert.ok(rows.length > 0 && rows.length <= 5, by);
  }
  await assert.rejects(tools.run("sales_breakdown", { by: "password; drop table", months: 3 }));
});

test("finds customers by part of their name and shows their history", { skip }, async () => {
  const target = data.customers.find((c) => c.segment === "Trade account");
  const { customers } = await tools.run("find_customers", { query: target.name.split(" ").slice(-1)[0] });
  const hit = customers.find((c) => c.id === target.id);
  assert.ok(hit, `found ${target.name}`);
  assert.equal(hit.email, target.email);
  const history = await tools.run("customer_history", { customerId: target.id });
  assert.equal(history.customer.name, target.name);
  assert.ok(Array.isArray(history.recentOrders) && Array.isArray(history.topProducts));
});

test("lists items that need reordering", { skip }, async () => {
  const { products } = await tools.run("low_stock", {});
  assert.ok(products.length > 0);
  for (const p of products) assert.ok(p.stock <= p.reorderLevel);
});

test("an invoice draft takes prices, discounts, tax and terms from the database, never from the model", { skip }, async () => {
  const customer = data.customers.find((c) => c.segment === "Trade account");
  const [a, b] = data.products;
  const draft = await tools.draftInvoice({ customerId: customer.id, items: [{ sku: a.sku, quantity: 3 }, { sku: b.sku, quantity: 1 }], notes: "Job 42" });
  assert.equal(draft.customer.name, customer.name);
  assert.equal(draft.customer.email, customer.email);
  assert.equal(draft.from.name, STORE_PROFILE.name);
  assert.equal(draft.currency, "USD");
  assert.equal(draft.taxRateBps, STORE_PROFILE.taxRateBps);
  assert.equal(draft.issueDate, "2026-11-14");
  assert.equal(draft.dueDate, "2026-12-14");
  const line = draft.lineItems[0];
  assert.equal(line.unitPriceMinor, Math.round(a.unitPrice * 0.95 * 100), "trade accounts get 5% off list");
  assert.equal(line.quantity, 3);
  assert.equal(draft.subtotalMinor, draft.lineItems.reduce((s, l) => s + l.totalMinor, 0));
  assert.equal(draft.totalMinor, draft.subtotalMinor + Math.round(draft.subtotalMinor * STORE_PROFILE.taxRateBps / 10000));
  assert.ok(draft.readiness.ready);
});

test("an invoice draft refuses unknown customers, unknown products and silly quantities", { skip }, async () => {
  const sku = data.products[0].sku;
  await assert.rejects(tools.draftInvoice({ customerId: 999999, items: [{ sku, quantity: 1 }] }), /customer/i);
  await assert.rejects(tools.draftInvoice({ customerId: 1, items: [{ sku: "NOPE-1", quantity: 1 }] }), /NOPE-1/);
  await assert.rejects(tools.draftInvoice({ customerId: 1, items: [{ sku, quantity: 0 }] }));
  await assert.rejects(tools.draftInvoice({ customerId: 1, items: [] }));
});

test("every tool has a declaration the model can call, and nothing that writes", () => {
  return import("../../server/agent/sales-tools.js").then(({ TOOL_DECLARATIONS }) => {
    const names = TOOL_DECLARATIONS.map((d) => d.name);
    for (const n of ["sales_summary", "sales_breakdown", "find_products", "find_customers", "customer_history", "low_stock", "store_profile", "propose_invoice"]) assert.ok(names.includes(n), n);
    for (const d of TOOL_DECLARATIONS) {
      assert.ok(d.description.length > 20 && d.parameters?.type === "OBJECT", d.name);
      assert.doesNotMatch(d.name, /delete|update|insert|send|sql|query/i);
    }
  });
});
