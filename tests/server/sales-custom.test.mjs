// Custom sales widgets (the assistant's dashboard layer): a typed query (metric, grouping, period, filters) that
// server/sales/custom.js turns into fixed, parameterized SQL. Checked against real Postgres with hand-computed answers.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { generateSalesData } from "../../server/sales/seed.js";
import { CustomQuery, customWidgetProblems, Widget, SALES_CATALOG } from "../../shared/spec.js";

const url = process.env.POSTGRES_URL;
const skip = url ? false : "POSTGRES_URL is not set";
const now = new Date("2026-11-14T12:00:00Z");
const schema = `test_custom_${process.pid}`;
const data = generateSalesData({ seed: 9, months: 24, now });

let pool, runCustomQuery;
before(async () => {
  if (skip) return;
  const db = await import("../../server/sales/db.js");
  ({ runCustomQuery } = await import("../../server/sales/custom.js"));
  pool = db.createPool(url);
  await db.createSchema(pool, schema);
  await db.loadData(pool, schema, data);
});
after(async () => {
  if (!pool) return;
  const db = await import("../../server/sales/db.js");
  await db.dropSchema(pool, schema);
  await pool.end();
});

// ---- the same numbers, by hand ----
const monthStart = (back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
const orders = new Map(data.orders.map((o) => [o.id, o]));
const products = new Map(data.products.map((p) => [p.id, p]));
const customers = new Map(data.customers.map((c) => [c.id, c]));
const line = (it) => it.quantity * it.unitPrice * (1 - it.discountPct / 100);
function byHand({ months, sku, branch }) {
  const from = monthStart(months - 1);
  const buckets = new Map();
  let total = 0, units = 0;
  const orderIds = new Set();
  for (const it of data.orderItems) {
    const o = orders.get(it.orderId);
    if (o.status === "refunded" || o.orderedAt < from || o.orderedAt > now) continue;
    if (sku && products.get(it.productId).sku !== sku) continue;
    if (branch && customers.get(o.customerId).region !== branch) continue;
    const key = o.orderedAt.toISOString().slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) + line(it));
    total += line(it); units += it.quantity; orderIds.add(o.id);
  }
  return { buckets, total, units, orders: orderIds.size };
}

test("revenue of one product by month matches a hand count, with every month present", { skip }, async () => {
  const sku = data.products[9].sku;
  const res = await runCustomQuery(pool, { metric: "revenue", groupBy: "month", months: 6, filters: { products: [sku] } }, { schema, now });
  const hand = byHand({ months: 6, sku });
  assert.equal(res.rows.length, 6, "six months, empty ones included");
  assert.equal(res.rows[0].key, monthStart(5).toISOString().slice(0, 7));
  for (const r of res.rows) assert.ok(Math.abs(r.value - (hand.buckets.get(r.key) ?? 0)) < 0.01, r.key);
  assert.ok(Math.abs(res.total - hand.total) < 0.01);
  assert.equal(res.unit, "USD");
  assert.deepEqual(res.filters, [`Product: ${data.products[9].name}`]);
});

test("a single number comes with the previous period for comparison", { skip }, async () => {
  const res = await runCustomQuery(pool, { metric: "units", groupBy: "none", months: 3, filters: { branches: ["Beirut store"] } }, { schema, now });
  assert.equal(res.total, byHand({ months: 3, branch: "Beirut store" }).units);
  assert.equal(typeof res.previousTotal, "number");
  assert.equal(res.unit, "count");
});

test("groupings rank by value, respect the limit and the filter", { skip }, async () => {
  const res = await runCustomQuery(pool, { metric: "orders", groupBy: "product", months: 3, limit: 5, filters: { categories: ["Batteries"] } }, { schema, now });
  assert.ok(res.rows.length >= 1 && res.rows.length <= 5, `${res.rows.length} rows`);
  for (let i = 1; i < res.rows.length; i++) assert.ok(res.rows[i - 1].value >= res.rows[i].value);
  const plumbing = new Set(data.products.filter((p) => p.category === "Batteries").map((p) => p.name));
  for (const r of res.rows) assert.ok(plumbing.has(r.key), r.key);
});

test("every metric and grouping runs", { skip }, async () => {
  for (const metric of ["revenue", "orders", "units", "aov", "marginPct", "customers"]) {
    for (const groupBy of ["none", "week", "category", "branch", "staff", "channel", "segment", "customer"]) {
      const res = await runCustomQuery(pool, { metric, groupBy, months: 2 }, { schema, now });
      assert.ok(Array.isArray(res.rows), `${metric} by ${groupBy}`);
    }
  }
});

test("queries are validated: unknown metrics, groupings and silly sizes are refused", () => {
  assert.equal(CustomQuery.safeParse({ metric: "salary", groupBy: "month" }).success, false);
  assert.equal(CustomQuery.safeParse({ metric: "revenue", groupBy: "password" }).success, false);
  assert.equal(CustomQuery.safeParse({ metric: "revenue", months: 99 }).success, false);
  assert.equal(CustomQuery.safeParse({ metric: "revenue", filters: { products: Array(20).fill("x") } }).success, false);
  const ok = CustomQuery.parse({ metric: "revenue" });
  assert.equal(ok.groupBy, "none");
  assert.equal(ok.months, 12);
});

test("a chart must suit its data", () => {
  const w = (chart, groupBy, months = 12) => ({ id: "c1", type: "sales-custom", title: "T", chart, query: CustomQuery.parse({ metric: "revenue", groupBy, months }) });
  assert.deepEqual(customWidgetProblems(w("number", "none")), []);
  assert.deepEqual(customWidgetProblems(w("line", "month")), []);
  assert.deepEqual(customWidgetProblems(w("bar", "category")), []);
  assert.match(customWidgetProblems(w("number", "month"))[0], /single number/i);
  assert.match(customWidgetProblems(w("line", "category"))[0], /over time/i);
  assert.match(customWidgetProblems(w("bar", "none"))[0], /group/i);
  assert.match(customWidgetProblems(w("line", "day", 12))[0], /3 months/i);
});

test("custom widgets are valid sales-board widgets, hidden from the manual widget panel", () => {
  const parsed = Widget.safeParse({ id: "c1", type: "sales-custom", title: "Drill sales", chart: "line", query: { metric: "revenue", groupBy: "month" } });
  assert.ok(parsed.success);
  assert.ok(SALES_CATALOG["sales-custom"]);
  assert.equal(SALES_CATALOG["sales-custom"].hidden, true);
});

// ---- costs (decision #62): cost of goods sold, gross profit, and supplier purchases ----
function costByHand(key) {
  const from = monthStart(11);
  const cost = new Map(), revenue = new Map();
  for (const it of data.orderItems) {
    const o = orders.get(it.orderId);
    if (o.status === "refunded" || o.orderedAt < from || o.orderedAt > now) continue;
    const p = products.get(it.productId);
    const k = key(p);
    cost.set(k, (cost.get(k) ?? 0) + it.quantity * p.unitCost);
    revenue.set(k, (revenue.get(k) ?? 0) + line(it));
  }
  return { cost, revenue };
}

test("cost by category and by product: what the goods sold cost, matching a hand count", { skip }, async () => {
  for (const [groupBy, key] of [["category", (p) => p.category], ["product", (p) => p.name]]) {
    const res = await runCustomQuery(pool, { metric: "cost", groupBy, months: 12, limit: 20 }, { schema, now });
    const { cost } = costByHand(key);
    assert.equal(res.unit, "USD");
    for (const r of res.rows) assert.ok(Math.abs(r.value - cost.get(r.key)) < 0.02, `${groupBy} ${r.key}: ${r.value} vs ${cost.get(r.key)}`);
    assert.ok(res.rows.every((r, i) => i === 0 || r.value <= res.rows[i - 1].value), "biggest first");
  }
});

test("gross profit is revenue minus the cost of the goods sold", { skip }, async () => {
  const res = await runCustomQuery(pool, { metric: "profit", groupBy: "category", months: 12, limit: 20 }, { schema, now });
  const { cost, revenue } = costByHand((p) => p.category);
  for (const r of res.rows) assert.ok(Math.abs(r.value - (revenue.get(r.key) - cost.get(r.key))) < 0.05, r.key);
});

test("purchases: what supplier invoices cost, by product, category or supplier", { skip }, async () => {
  const p = data.products[1];
  const { rows: [{ id }] } = await pool.query(`INSERT INTO "${schema}".purchases (number, supplier, purchased_at, total, currency) VALUES ('NS-1', 'Northstar', $1, 999, 'USD') RETURNING id`, [new Date("2026-11-10T10:00:00Z")]);
  await pool.query(`INSERT INTO "${schema}".purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES ($1, $2, 10, 50)`, [id, p.id]);
  const byProduct = await runCustomQuery(pool, { metric: "purchases", groupBy: "product", months: 1 }, { schema, now });
  assert.deepEqual(byProduct.rows, [{ key: p.name, value: 500 }]);
  assert.equal(byProduct.total, 500);
  const bySupplier = await runCustomQuery(pool, { metric: "purchases", groupBy: "supplier", months: 1 }, { schema, now });
  assert.deepEqual(bySupplier.rows, [{ key: "Northstar", value: 500 }]);
  const byCategory = await runCustomQuery(pool, { metric: "purchases", groupBy: "category", months: 1, filters: { categories: [p.category] } }, { schema, now });
  assert.equal(byCategory.total, 500);
});

test("purchases can't be grouped by things a supplier invoice doesn't have; supplier only goes with purchases", () => {
  const w = (metric, groupBy) => ({ chart: "bar", query: CustomQuery.parse({ metric, groupBy }) });
  assert.match(customWidgetProblems(w("purchases", "branch")).join(), /supplier invoices/);
  assert.match(customWidgetProblems(w("purchases", "customer")).join(), /supplier invoices/);
  assert.deepEqual(customWidgetProblems(w("purchases", "supplier")), []);
  assert.deepEqual(customWidgetProblems(w("cost", "category")), []);
  assert.match(customWidgetProblems(w("revenue", "supplier")).join(), /only with purchases/);
});
