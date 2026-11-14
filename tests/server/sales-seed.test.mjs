// Demo sales data (server/sales/seed.js): fictional, deterministic, internally consistent, and shaped like a real
// business (growth, seasonality, a live pipeline) so the sales dashboard has something honest to show.
import assert from "node:assert/strict";
import test from "node:test";
import { generateSalesData, REGIONS, CATEGORIES, STAGES } from "../../server/sales/seed.js";

const now = new Date("2026-11-14T12:00:00Z");
const data = generateSalesData({ seed: 7, months: 24, now });
const byId = (list) => new Map(list.map((x) => [x.id, x]));

test("has a realistic amount of everything", () => {
  assert.equal(data.reps.length, 12);
  assert.ok(data.customers.length >= 400, `${data.customers.length} customers`);
  assert.ok(data.products.length >= 55, `${data.products.length} products`);
  assert.ok(data.orders.length >= 7000, `${data.orders.length} orders`);
  assert.ok(data.orderItems.length >= data.orders.length, "every order has at least one line");
  assert.ok(data.deals.length >= 800, `${data.deals.length} deals`);
});

test("the same seed gives the same data; another seed gives different data", () => {
  assert.deepEqual(generateSalesData({ seed: 7, months: 24, now }), data);
  assert.notDeepEqual(generateSalesData({ seed: 8, months: 24, now }).orders.slice(0, 5), data.orders.slice(0, 5));
});

test("every reference points at something that exists", () => {
  const customers = byId(data.customers), reps = byId(data.reps), products = byId(data.products), orders = byId(data.orders);
  for (const o of data.orders) {
    assert.ok(customers.has(o.customerId) && reps.has(o.repId), `order ${o.number}`);
    assert.equal(reps.get(o.repId).region, customers.get(o.customerId).region, "a rep sells in their own region");
  }
  for (const it of data.orderItems) assert.ok(orders.has(it.orderId) && products.has(it.productId));
  for (const d of data.deals) assert.ok(customers.has(d.customerId) && reps.has(d.repId));
});

test("dates stay inside the window and nobody orders before they were a customer", () => {
  const from = new Date(now); from.setUTCMonth(from.getUTCMonth() - 24);
  const customers = byId(data.customers);
  for (const o of data.orders) {
    assert.ok(o.orderedAt >= from && o.orderedAt <= now, `order ${o.number} at ${o.orderedAt.toISOString()}`);
    assert.ok(o.orderedAt >= customers.get(o.customerId).createdAt, `order ${o.number} before its customer existed`);
  }
});

test("values are sane: prices above cost, positive quantities, known labels", () => {
  for (const p of data.products) {
    assert.ok(p.unitPrice > p.unitCost && p.unitCost > 0, p.sku);
    assert.ok(CATEGORIES.includes(p.category));
  }
  for (const it of data.orderItems) assert.ok(it.quantity > 0 && it.unitPrice > 0 && it.discountPct >= 0 && it.discountPct <= 20);
  for (const c of data.customers) assert.ok(REGIONS.includes(c.region));
  for (const o of data.orders) assert.ok(["paid", "pending", "refunded"].includes(o.status));
});

test("the business grows: the last 12 months sell more than the 12 before", () => {
  const items = new Map();
  for (const it of data.orderItems) items.set(it.orderId, (items.get(it.orderId) ?? 0) + it.quantity * it.unitPrice * (1 - it.discountPct / 100));
  const cut = new Date(now); cut.setUTCMonth(cut.getUTCMonth() - 12);
  let recent = 0, before = 0;
  for (const o of data.orders) if (o.status !== "refunded") (o.orderedAt >= cut ? (recent += items.get(o.id)) : (before += items.get(o.id)));
  assert.ok(recent > before * 1.1, `last 12 months ${Math.round(recent)} vs ${Math.round(before)}`);
});

test("deals: closed ones have a close date and an outcome, open ones are recent and in an open stage", () => {
  assert.deepEqual(STAGES, ["lead", "qualified", "proposal", "negotiation", "won", "lost"]);
  const open = data.deals.filter((d) => !["won", "lost"].includes(d.stage));
  const closed = data.deals.filter((d) => ["won", "lost"].includes(d.stage));
  assert.ok(open.length >= 40 && closed.length >= 150, `${open.length} open, ${closed.length} closed`);
  for (const d of closed) assert.ok(d.closedAt && d.closedAt >= d.createdAt && d.closedAt <= now);
  for (const d of open) assert.equal(d.closedAt, null);
  for (const d of data.deals) assert.ok(d.amount > 0 && STAGES.includes(d.stage));
  const winRate = closed.filter((d) => d.stage === "won").length / closed.length;
  assert.ok(winRate > 0.2 && winRate < 0.6, `win rate ${winRate.toFixed(2)}`);
});

test("all names are clearly fictional (no real domains)", () => {
  for (const c of data.customers) assert.match(c.name, /\S/);
  for (const r of data.reps) assert.ok(!/@/.test(r.name));
  assert.ok(data.customers.every((c) => !c.email || c.email.endsWith(".example")));
});
