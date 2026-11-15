// Sales data (server/sales/seed.js): a small Lebanese solar shop at a realistic size (about $10K of sales a month,
// $120K a year), whose numbers tell clear stories. Deterministic, internally consistent, and small enough to read.
// Each scenario the dashboard and the assistant can talk about is pinned below.
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SEED, generateSalesData, REGIONS, CATEGORIES, STAGES, STORE_PROFILE } from "../../server/sales/seed.js";

const now = new Date("2026-11-14T12:00:00Z");
// The seed the app loads, so these stories are the ones on screen.
const data = generateSalesData({ seed: DEFAULT_SEED, months: 24, now });
const byId = (list) => new Map(list.map((x) => [x.id, x]));
const orders = byId(data.orders);
const products = byId(data.products);
const customers = byId(data.customers);
const line = (it) => it.quantity * it.unitPrice * (1 - it.discountPct / 100);
const monthsAgo = (d) => (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + now.getUTCMonth() - d.getUTCMonth();
const product = (name) => data.products.find((p) => p.name.toLowerCase().includes(name));
const customer = (name) => data.customers.find((c) => c.name === name);

/** Revenue / units for lines matching `keep`, from orders `from`..`to` months ago (inclusive, 0 = this month). */
function sum(keep, from, to, field = "revenue") {
  let total = 0;
  for (const it of data.orderItems) {
    const o = orders.get(it.orderId);
    const ago = monthsAgo(o.orderedAt);
    if (o.status === "refunded" || ago < to || ago > from || !keep(it, o)) continue;
    total += field === "units" ? it.quantity : line(it);
  }
  return total;
}
const orderTotals = () => {
  const totals = new Map();
  for (const it of data.orderItems) totals.set(it.orderId, (totals.get(it.orderId) ?? 0) + line(it));
  return totals;
};

// ---- size and shape ----
test("a niche solar shop: 10 solar products, a couple of dozen customers, a few hundred orders, 4 staff", () => {
  assert.equal(data.products.length, 10);
  assert.ok(data.customers.length >= 20 && data.customers.length <= 35, `${data.customers.length} customers`);
  assert.ok(data.orders.length >= 200 && data.orders.length <= 450, `${data.orders.length} orders`);
  assert.equal(data.reps.length, 4);
  assert.ok(data.deals.length >= 15 && data.deals.length <= 40, `${data.deals.length} quotes`);
  assert.ok(data.orderItems.length >= data.orders.length, "every order has at least one line");
  for (const p of data.products) assert.match(`${p.name} ${p.category}`, /solar|inverter|battery|panel|pv|mount|surge|breaker|power station|pump/i, p.name);
});

test("realistic money: about $10K a month and $120K over the last 12 months", () => {
  const year = sum(() => true, 11, 0);
  assert.ok(year > 95_000 && year < 150_000, `last 12 months $${year.toFixed(0)}`);
  for (let ago = 1; ago <= 12; ago++) {
    const month = sum(() => true, ago, ago);
    assert.ok(month > 3_000 && month < 25_000, `${ago} months ago: $${month.toFixed(0)}`);
  }
  const perMonth = data.orders.filter((o) => monthsAgo(o.orderedAt) >= 1 && monthsAgo(o.orderedAt) <= 12).length / 12;
  assert.ok(perMonth >= 8 && perMonth <= 18, `${perMonth.toFixed(1)} orders a month`);
});

test("no customer is outsized: the biggest buys under $40K a year, a typical one a few thousand", () => {
  const byCustomer = new Map();
  for (const it of data.orderItems) {
    const o = orders.get(it.orderId);
    if (o.status !== "refunded" && monthsAgo(o.orderedAt) <= 11) byCustomer.set(o.customerId, (byCustomer.get(o.customerId) ?? 0) + line(it));
  }
  const values = [...byCustomer.values()].sort((a, b) => b - a);
  assert.ok(values[0] < 40_000, `top customer $${values[0].toFixed(0)}`);
  const median = values[Math.floor(values.length / 2)];
  assert.ok(median > 500 && median < 8_000, `median customer $${median.toFixed(0)}`);
});

test("baskets: small add-ons, home systems of a few thousand, nothing absurd", () => {
  const sorted = [...orderTotals().values()].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  assert.ok(median > 80 && median < 1_500, `median order $${median.toFixed(0)}`);
  assert.ok(sorted.filter((v) => v >= 2_000).length >= 20, "about one complete system a month or more");
  assert.ok(sorted.at(-1) < 15_000, `largest order $${sorted.at(-1).toFixed(0)}`);
});

test("the same seed gives the same data; another seed gives different data", () => {
  assert.deepEqual(generateSalesData({ seed: DEFAULT_SEED, months: 24, now }), data);
  assert.notDeepEqual(generateSalesData({ seed: DEFAULT_SEED + 1, months: 24, now }).orders.slice(0, 5), data.orders.slice(0, 5));
});

test("every reference points at something that exists", () => {
  const reps = byId(data.reps);
  for (const o of data.orders) {
    assert.ok(customers.has(o.customerId) && reps.has(o.repId), `order ${o.number}`);
    assert.equal(reps.get(o.repId).region, customers.get(o.customerId).region, "staff sell in their own branch");
  }
  for (const it of data.orderItems) assert.ok(orders.has(it.orderId) && products.has(it.productId));
  for (const d of data.deals) assert.ok(customers.has(d.customerId) && reps.has(d.repId));
});

test("dates stay inside the window and nobody orders before they were a customer", () => {
  const from = new Date(now); from.setUTCMonth(from.getUTCMonth() - 24);
  for (const o of data.orders) {
    assert.ok(o.orderedAt >= from && o.orderedAt <= now, `order ${o.number}`);
    assert.ok(o.orderedAt >= customers.get(o.customerId).createdAt, `order ${o.number} before its customer existed`);
  }
});

test("values are sane: prices above cost, positive quantities, known labels", () => {
  for (const p of data.products) {
    assert.ok(p.unitPrice > p.unitCost && p.unitCost > 0, p.sku);
    assert.ok(CATEGORIES.includes(p.category), p.category);
    assert.match(p.description, /\w{3,}.{20,}/, `${p.sku} has a description`);
    assert.ok(Array.isArray(p.uses) && p.uses.length >= 2, `${p.sku} lists what it's for`);
    assert.ok(p.brand && p.unit && Number.isInteger(p.stock) && p.stock >= 0, p.sku);
  }
  for (const it of data.orderItems) assert.ok(it.quantity > 0 && it.unitPrice > 0 && it.discountPct >= 0 && it.discountPct <= 20);
  for (const c of data.customers) assert.ok(REGIONS.includes(c.region));
  for (const o of data.orders) assert.ok(["paid", "pending", "refunded"].includes(o.status));
  assert.ok(data.orders.some((o) => o.status === "refunded") && data.orders.some((o) => o.status === "pending"), "some refunds and unpaid orders");
});

// ---- Lebanon ----
test("a Lebanese shop: Lebanese branches, customers and staff; USD with 11% VAT", () => {
  assert.deepEqual(REGIONS, ["Beirut store", "Jounieh store", "Online"]);
  assert.match(STORE_PROFILE.name, /solar/i);
  assert.match(STORE_PROFILE.address, /Lebanon/);
  assert.equal(STORE_PROFILE.currency, "USD");
  assert.equal(STORE_PROFILE.taxRateBps, 1100);
  assert.ok(/@.+\.example$/.test(STORE_PROFILE.email) && STORE_PROFILE.phone.startsWith("+961"));
  for (const c of data.customers) {
    assert.ok(c.phone.startsWith("+961") && /Lebanon$/.test(c.address), `${c.name}: ${c.phone}, ${c.address}`);
    assert.ok(!c.email || c.email.endsWith(".example"), "fictional addresses only");
  }
  assert.deepEqual([...new Set(data.customers.map((c) => c.segment))].sort(), ["Commercial account", "Retail customer", "Trade account"]);
});

// ---- the stories in the data ----
test("battery boom: 5 kWh lithium batteries sell far more than a year ago, and they're out of stock", () => {
  const p = product("5kwh");
  const recent = sum((it) => it.productId === p.id, 5, 0), early = sum((it) => it.productId === p.id, 23, 18);
  assert.ok(recent > early * 2, `last 6 months ${recent.toFixed(0)} vs first 6 ${early.toFixed(0)}`);
  assert.equal(p.stock, 0);
});

test("bigger systems: 6 kW inverters take over from 3.6 kW, which are now overstocked", () => {
  const big = product("6kw"), small = product("3.6kw");
  const units = (p, from, to) => sum((it) => it.productId === p.id, from, to, "units");
  assert.ok(units(big, 5, 0) > units(big, 23, 18) * 1.5, "6 kW grows");
  assert.ok(units(small, 5, 0) < units(small, 23, 18) * 0.6, "3.6 kW declines");
  assert.ok(small.stock > small.reorderLevel * 4, "plenty of 3.6 kW left in the storeroom");
});

test("seasons: pump kits in summer (and running low), portable power stations in winter", () => {
  const share = (name, months) => {
    const p = product(name);
    let inSeason = 0, all = 0;
    for (const it of data.orderItems) {
      if (it.productId !== p.id) continue;
      all += it.quantity;
      if (months.includes(orders.get(it.orderId).orderedAt.getUTCMonth())) inSeason += it.quantity;
    }
    return inSeason / all;
  };
  assert.ok(share("pump", [5, 6, 7, 8]) > 0.55, "pumps: Jun–Sep");
  assert.ok(share("power station", [11, 0, 1]) > 0.5, "power stations: Dec–Feb");
  const pump = product("pump");
  assert.ok(pump.stock > 0 && pump.stock <= pump.reorderLevel, "pump kits: low, not out");
});

test("customer stories: a contractor who stopped ordering, a new building client, a solar installer climbing", () => {
  const of = (c) => data.orders.filter((o) => o.customerId === c.id);
  const churned = customer("Abi Nader Construction");
  assert.ok(of(churned).length >= 6, `used to order (${of(churned).length} orders)`);
  assert.equal(of(churned).filter((o) => monthsAgo(o.orderedAt) <= 5).length, 0, "nothing in the last 6 months");

  const fresh = customer("Byblos Bay Apartments");
  assert.ok(monthsAgo(fresh.createdAt) <= 4, "a new customer");
  assert.ok(of(fresh).length >= 3, `already ordering (${of(fresh).length} orders)`);

  const installer = customer("Khoury Solar Solutions");
  const recent = sum((it, o) => o.customerId === installer.id, 11, 0), early = sum((it, o) => o.customerId === installer.id, 23, 12);
  assert.ok(recent > early * 1.5, `installer: ${recent.toFixed(0)} vs ${early.toFixed(0)}`);
});

test("branches: Online grows its share, Jounieh loses its share", () => {
  const share = (region, from, to) => sum((it, o) => customers.get(o.customerId).region === region, from, to) / sum(() => true, from, to);
  assert.ok(share("Online", 11, 0) > share("Online", 23, 12) * 1.3, "online grows");
  assert.ok(share("Jounieh store", 11, 0) < share("Jounieh store", 23, 12) * 0.85, "Jounieh shrinks");
});

test("the business grows: the last 12 months sell more than the 12 before", () => {
  assert.ok(sum(() => true, 11, 0) > sum(() => true, 23, 12) * 1.15);
});

test("staff: one above target, one below, the rest near it; targets in the low thousands", () => {
  const recent = new Map();
  const cut = new Date(now); cut.setUTCMonth(cut.getUTCMonth() - 6);
  const value = orderTotals();
  for (const o of data.orders) if (o.orderedAt >= cut && o.status !== "refunded") recent.set(o.repId, (recent.get(o.repId) ?? 0) + value.get(o.id));
  const attain = data.reps.map((r) => (recent.get(r.id) ?? 0) / 6 / r.monthlyTarget);
  assert.ok(attain.some((a) => a >= 1.15), "someone beats their target");
  assert.ok(attain.some((a) => a <= 0.85), "someone misses theirs");
  for (const a of attain) assert.ok(a > 0.5 && a < 1.6, `attainment ${(a * 100).toFixed(0)}%`);
  for (const r of data.reps) assert.ok(r.monthlyTarget >= 500 && r.monthlyTarget <= 8_000, `${r.name}: $${r.monthlyTarget} a month`);
});

test("quotes: closed ones have a close date and an outcome, open ones are still open, amounts of real jobs", () => {
  assert.deepEqual(STAGES, ["lead", "qualified", "proposal", "negotiation", "won", "lost"]);
  const open = data.deals.filter((d) => !["won", "lost"].includes(d.stage));
  const closed = data.deals.filter((d) => ["won", "lost"].includes(d.stage));
  assert.ok(open.length >= 4 && closed.length >= 10, `${open.length} open, ${closed.length} closed`);
  for (const d of closed) assert.ok(d.closedAt && d.closedAt >= d.createdAt && d.closedAt <= now);
  for (const d of open) assert.equal(d.closedAt, null);
  const winRate = closed.filter((d) => d.stage === "won").length / closed.length;
  assert.ok(winRate > 0.2 && winRate < 0.75, `win rate ${winRate.toFixed(2)}`);
  for (const d of data.deals) {
    assert.ok(customers.get(d.customerId).segment !== "Retail customer", "quotes are for trade and commercial accounts");
    assert.ok(d.amount >= 1_500 && d.amount <= 20_000, `${d.name}: $${d.amount}`);
  }
});
