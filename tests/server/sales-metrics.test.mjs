// Sales dashboard numbers (server/sales/metrics.js), checked against real Postgres: the demo data is loaded into a
// throwaway schema and every figure the SQL returns is recomputed by hand from the same rows.
// Needs POSTGRES_URL (in .env); skipped without it so the suite still runs anywhere.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { generateSalesData } from "../../server/sales/seed.js";

const url = process.env.POSTGRES_URL;
const skip = url ? false : "POSTGRES_URL is not set";
const now = new Date("2026-11-14T12:00:00Z");
const months = 12;
const schema = `test_sales_${process.pid}`;
const data = generateSalesData({ seed: 11, months: 24, now });

let pool, salesDashboard;
before(async () => {
  if (skip) return;
  const db = await import("../../server/sales/db.js");
  ({ salesDashboard } = await import("../../server/sales/metrics.js"));
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
// The period is calendar months: this month so far plus the months before it. It's compared with the same calendar
// months one period earlier, up to the same day, so a part-month is never compared with a whole one.
const monthStart = (n) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
const from = monthStart(months - 1), prevFrom = monthStart(2 * months - 1);
const prevEnd = (() => { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - months); return d; })();
const lineTotal = (it) => it.quantity * it.unitPrice * (1 - it.discountPct / 100);
const orderTotal = new Map(), orderCost = new Map();
for (const it of data.orderItems) {
  orderTotal.set(it.orderId, (orderTotal.get(it.orderId) ?? 0) + lineTotal(it));
  orderCost.set(it.orderId, (orderCost.get(it.orderId) ?? 0) + it.quantity * data.products.find((p) => p.id === it.productId).unitCost);
}
const counted = (a, b) => data.orders.filter((o) => o.status !== "refunded" && o.orderedAt >= a && o.orderedAt < b);
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.01 * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);
const thisPeriod = counted(from, new Date(now.getTime() + 1));
const lastPeriod = counted(prevFrom, prevEnd);

test("headline numbers match the rows", { skip }, async () => {
  const d = await salesDashboard(pool, { schema, months, now });
  close(d.kpis.revenue, sum(thisPeriod, (o) => orderTotal.get(o.id)), "revenue");
  close(d.kpis.revenuePrev, sum(lastPeriod, (o) => orderTotal.get(o.id)), "previous revenue");
  assert.equal(d.kpis.orders, thisPeriod.length);
  assert.equal(d.kpis.ordersPrev, lastPeriod.length);
  close(d.kpis.aov, d.kpis.revenue / d.kpis.orders, "average order");
  const cost = sum(thisPeriod, (o) => orderCost.get(o.id));
  close(d.kpis.marginPct, ((d.kpis.revenue - cost) / d.kpis.revenue) * 100, "margin %");
  assert.equal(d.kpis.newCustomers, data.customers.filter((c) => c.createdAt >= from && c.createdAt <= now).length);
  assert.equal(d.range.from, from.toISOString());
});

test("pipeline: open deals by stage, and the win rate of deals closed in the period", { skip }, async () => {
  const d = await salesDashboard(pool, { schema, months, now });
  const open = data.deals.filter((x) => !["won", "lost"].includes(x.stage));
  close(d.kpis.openPipeline, sum(open, (x) => x.amount), "open pipeline");
  assert.equal(d.kpis.openDeals, open.length);
  const closed = data.deals.filter((x) => ["won", "lost"].includes(x.stage) && x.closedAt >= from);
  close(d.kpis.winRate, (closed.filter((x) => x.stage === "won").length / closed.length) * 100, "win rate");
  for (const stage of ["lead", "qualified", "proposal", "negotiation"]) {
    const row = d.pipeline.find((p) => p.stage === stage);
    assert.equal(row.count, open.filter((x) => x.stage === stage).length, stage);
  }
});

test("monthly trend: one point per month with last year's figure beside it", { skip }, async () => {
  const d = await salesDashboard(pool, { schema, months, now });
  assert.equal(d.monthly.length, months);
  close(sum(d.monthly, (m) => m.revenue), d.kpis.revenue, "months add up to the total");
  close(sum(d.monthly, (m) => m.revenueLastYear), d.kpis.revenuePrev, "last year's months add up too");
  assert.ok(d.monthly.every((m, i) => i === 0 || m.month > d.monthly[i - 1].month), "in order");
  assert.equal(d.monthly.at(-1).month, "2026-11");
  assert.equal(d.monthly[0].month, "2025-12");
});

test("breakdowns add up and are sorted biggest first", { skip }, async () => {
  const d = await salesDashboard(pool, { schema, months, now });
  for (const key of ["byCategory", "byRegion"]) {
    close(sum(d[key], (x) => x.revenue), d.kpis.revenue, `${key} total`);
    assert.ok(d[key].every((x, i) => i === 0 || x.revenue <= d[key][i - 1].revenue), `${key} sorted`);
  }
  assert.equal(d.topProducts.length, 10);
  assert.equal(d.topCustomers.length, 10);
  assert.ok(d.topCustomers[0].revenue >= d.topCustomers[9].revenue);
  assert.equal(d.reps.length, data.reps.length);
  for (const r of d.reps) assert.ok(r.target > 0 && r.revenue >= 0);
  close(sum(d.reps, (r) => r.revenue), d.kpis.revenue, "reps add up");
  assert.equal(d.recentOrders.length, 10);
});

test("a shorter range gives smaller numbers", { skip }, async () => {
  const quarter = await salesDashboard(pool, { schema, months: 3, now });
  const year = await salesDashboard(pool, { schema, months, now });
  assert.equal(quarter.monthly.length, 3);
  assert.ok(quarter.kpis.revenue < year.kpis.revenue);
});
