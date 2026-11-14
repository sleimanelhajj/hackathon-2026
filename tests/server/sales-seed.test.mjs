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

// ---- the business is a hardware & convenience store (2026-11-14) ----
test("the products are a hardware store's, with what the assistant needs to recommend them", () => {
  for (const c of ["Hand tools", "Power tools", "Fasteners", "Plumbing", "Electrical", "Paint & supplies", "Garden & outdoor", "Safety gear"]) {
    assert.ok(CATEGORIES.includes(c), `category ${c}`);
    assert.ok(data.products.some((p) => p.category === c), `a product in ${c}`);
  }
  for (const p of data.products) {
    assert.match(p.description, /\w{3,}.{20,}/, `${p.sku} has a description`);
    assert.ok(Array.isArray(p.uses) && p.uses.length >= 2, `${p.sku} lists what it's for`);
    assert.ok(p.brand && p.unit, `${p.sku} has a brand and a selling unit`);
    assert.ok(Number.isInteger(p.stock) && p.stock >= 0, `${p.sku} stock`);
  }
  assert.ok(data.products.some((p) => p.stock <= p.reorderLevel), "some items are low on stock");
});

test("customers are trade accounts and walk-in shoppers, served from the store's branches", () => {
  const segments = new Set(data.customers.map((c) => c.segment));
  assert.deepEqual([...segments].sort(), ["Commercial account", "Retail customer", "Trade account"]);
  assert.ok(data.customers.some((c) => /Plumb|Electric|Build|Construct|Paint|Landscap/.test(c.industry)));
  for (const c of data.customers) assert.ok(c.address && c.phone, `${c.name} has an address and phone for invoices`);
  assert.ok(REGIONS.every((r) => / store|Online/i.test(r)), REGIONS.join(", "));
});

test("the store profile is complete enough to issue an invoice", () => {
  const p = data.profile;
  assert.ok(p.name && /@.+\.example$/.test(p.email) && p.address && p.phone);
  assert.equal(p.currency, "USD");
  assert.ok(Number.isInteger(p.taxRateBps) && p.taxRateBps > 0 && p.taxRateBps < 2000);
  assert.ok(Number.isInteger(p.paymentTermsDays) && p.paymentTermsDays > 0);
});

test("baskets look like a hardware store: mostly small, a few large trade orders", () => {
  const totals = new Map();
  for (const it of data.orderItems) totals.set(it.orderId, (totals.get(it.orderId) ?? 0) + it.quantity * it.unitPrice);
  const sorted = [...totals.values()].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  assert.ok(median > 15 && median < 400, `median basket $${median.toFixed(0)}`);
  assert.ok(sorted.at(-1) > 1500, "some big trade orders");
});

test("staff targets are reachable: the team lands near its targets", () => {
  const rev = new Map();
  const cut = new Date(now); cut.setUTCMonth(cut.getUTCMonth() - 6);
  const items = new Map();
  for (const it of data.orderItems) items.set(it.orderId, (items.get(it.orderId) ?? 0) + it.quantity * it.unitPrice * (1 - it.discountPct / 100));
  for (const o of data.orders) if (o.orderedAt >= cut && o.status !== "refunded") rev.set(o.repId, (rev.get(o.repId) ?? 0) + items.get(o.id));
  for (const r of data.reps) {
    const attainment = (rev.get(r.id) ?? 0) / 6 / r.monthlyTarget;
    assert.ok(attainment > 0.6 && attainment < 1.5, `${r.name} at ${(attainment * 100).toFixed(0)}% of target`);
  }
});
