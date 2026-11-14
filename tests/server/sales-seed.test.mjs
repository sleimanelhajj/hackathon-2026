// Demo sales data (server/sales/seed.js): a small, fictional Lebanese hardware store whose numbers tell clear stories.
// Deterministic, internally consistent, and small enough to read: 10 products, ~40 customers, ~1,700 orders in
// 24 months. Each scenario the dashboard and the assistant can talk about is pinned below.
import assert from "node:assert/strict";
import test from "node:test";
import { generateSalesData, REGIONS, CATEGORIES, STAGES, STORE_PROFILE } from "../../server/sales/seed.js";

const now = new Date("2026-11-14T12:00:00Z");
const data = generateSalesData({ seed: 7, months: 24, now });
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

// ---- size and shape ----
test("small enough to read: 10 products, about 40 customers, under 2,500 orders", () => {
  assert.equal(data.products.length, 10);
  assert.ok(data.customers.length >= 30 && data.customers.length <= 50, `${data.customers.length} customers`);
  assert.ok(data.orders.length >= 800 && data.orders.length <= 2500, `${data.orders.length} orders`);
  assert.ok(data.reps.length >= 5 && data.reps.length <= 8, `${data.reps.length} staff`);
  assert.ok(data.deals.length >= 25 && data.deals.length <= 80, `${data.deals.length} trade quotes`);
  assert.ok(data.orderItems.length >= data.orders.length, "every order has at least one line");
});

test("the same seed gives the same data; another seed gives different data", () => {
  assert.deepEqual(generateSalesData({ seed: 7, months: 24, now }), data);
  assert.notDeepEqual(generateSalesData({ seed: 8, months: 24, now }).orders.slice(0, 5), data.orders.slice(0, 5));
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
test("a Lebanese store: Lebanese branches, customers and staff; USD with 11% VAT", () => {
  assert.deepEqual(REGIONS, ["Beirut store", "Jounieh store", "Byblos store", "Saida store", "Online"]);
  assert.match(STORE_PROFILE.address, /Lebanon/);
  assert.equal(STORE_PROFILE.currency, "USD");
  assert.equal(STORE_PROFILE.taxRateBps, 1100);
  assert.ok(STORE_PROFILE.name && /@.+\.example$/.test(STORE_PROFILE.email) && STORE_PROFILE.phone.startsWith("+961"));
  for (const c of data.customers) {
    assert.ok(c.phone.startsWith("+961") && /Lebanon$/.test(c.address), `${c.name}: ${c.phone}, ${c.address}`);
    assert.ok(!c.email || c.email.endsWith(".example"), "fictional addresses only");
  }
  assert.deepEqual([...new Set(data.customers.map((c) => c.segment))].sort(), ["Commercial account", "Retail customer", "Trade account"]);
});

// ---- the stories in the data ----
test("solar boom: inverter batteries and panels sell far more than a year ago, and batteries are out of stock", () => {
  for (const name of ["inverter battery", "solar panel"]) {
    const p = product(name);
    const recent = sum((it) => it.productId === p.id, 5, 0), early = sum((it) => it.productId === p.id, 23, 18);
    assert.ok(recent > early * 2, `${p.name}: last 6 months ${recent.toFixed(0)} vs first 6 ${early.toFixed(0)}`);
  }
  assert.equal(product("inverter battery").stock, 0);
});

test("generators decline as solar takes over, and they're overstocked", () => {
  const p = product("generator");
  const recent = sum((it) => it.productId === p.id, 5, 0), early = sum((it) => it.productId === p.id, 23, 18);
  assert.ok(recent < early * 0.6, `last 6 months ${recent.toFixed(0)} vs first 6 ${early.toFixed(0)}`);
  assert.ok(p.stock > p.reorderLevel * 4, "plenty left in the storeroom");
});

test("seasons: heaters in winter, water pumps in summer, tool sets at Christmas", () => {
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
  assert.ok(share("heater", [11, 0, 1]) > 0.6, "heaters: Dec–Feb");
  assert.ok(share("water pump", [5, 6, 7, 8]) > 0.55, "pumps: Jun–Sep");
  assert.ok(share("tool set", [11]) > 0.3, "tool sets: a December gift spike");
});

test("the cordless drill is a steady grower running low on stock", () => {
  const p = product("cordless drill");
  assert.ok(sum((it) => it.productId === p.id, 11, 0) > sum((it) => it.productId === p.id, 23, 12));
  assert.ok(p.stock > 0 && p.stock <= p.reorderLevel, "low, not out");
});

test("customer stories: a contractor who stopped ordering, a new client growing fast, a solar installer climbing", () => {
  const churned = customer("Abi Nader Construction");
  const of = (c) => data.orders.filter((o) => o.customerId === c.id);
  assert.ok(of(churned).length >= 15, "used to order often");
  assert.equal(of(churned).filter((o) => monthsAgo(o.orderedAt) <= 5).length, 0, "nothing in the last 6 months");

  const fresh = customer("Byblos Bay Apartments");
  assert.ok(monthsAgo(fresh.createdAt) <= 4, "a new customer");
  assert.ok(of(fresh).length >= 5, "already ordering regularly");

  const solar = customer("Khoury Solar Solutions");
  const recent = sum((it, o) => o.customerId === solar.id, 5, 0), early = sum((it, o) => o.customerId === solar.id, 23, 18);
  assert.ok(recent > early * 2, `installer: ${recent.toFixed(0)} vs ${early.toFixed(0)}`);
});

test("branches: Online grows its share, Saida loses its share", () => {
  const share = (region, from, to) => sum((it, o) => customers.get(o.customerId).region === region, from, to) / sum(() => true, from, to);
  assert.ok(share("Online", 5, 0) > share("Online", 23, 18) * 1.4, "online grows");
  assert.ok(share("Saida store", 5, 0) < share("Saida store", 23, 18) * 0.8, "Saida shrinks");
});

test("the business grows: the last 12 months sell more than the 12 before", () => {
  assert.ok(sum(() => true, 11, 0) > sum(() => true, 23, 12) * 1.1);
});

test("staff: one above target, one below, the rest near it", () => {
  const recent = new Map();
  const cut = new Date(now); cut.setUTCMonth(cut.getUTCMonth() - 6);
  const value = new Map();
  for (const it of data.orderItems) value.set(it.orderId, (value.get(it.orderId) ?? 0) + line(it));
  for (const o of data.orders) if (o.orderedAt >= cut && o.status !== "refunded") recent.set(o.repId, (recent.get(o.repId) ?? 0) + value.get(o.id));
  const attain = data.reps.map((r) => (recent.get(r.id) ?? 0) / 6 / r.monthlyTarget);
  assert.ok(attain.some((a) => a >= 1.15), "someone beats their target");
  assert.ok(attain.some((a) => a <= 0.85), "someone misses theirs");
  for (const a of attain) assert.ok(a > 0.5 && a < 1.6, `attainment ${(a * 100).toFixed(0)}%`);
});

test("trade quotes: closed ones have a close date and an outcome, open ones are still open", () => {
  assert.deepEqual(STAGES, ["lead", "qualified", "proposal", "negotiation", "won", "lost"]);
  const open = data.deals.filter((d) => !["won", "lost"].includes(d.stage));
  const closed = data.deals.filter((d) => ["won", "lost"].includes(d.stage));
  assert.ok(open.length >= 5 && closed.length >= 15, `${open.length} open, ${closed.length} closed`);
  for (const d of closed) assert.ok(d.closedAt && d.closedAt >= d.createdAt && d.closedAt <= now);
  for (const d of open) assert.equal(d.closedAt, null);
  const winRate = closed.filter((d) => d.stage === "won").length / closed.length;
  assert.ok(winRate > 0.2 && winRate < 0.7, `win rate ${winRate.toFixed(2)}`);
  for (const d of data.deals) assert.ok(customers.get(d.customerId).segment !== "Retail customer", "quotes are for trade and commercial accounts");
});

test("baskets: mostly small walk-in purchases, some big trade orders", () => {
  const totals = new Map();
  for (const it of data.orderItems) totals.set(it.orderId, (totals.get(it.orderId) ?? 0) + it.quantity * it.unitPrice);
  const sorted = [...totals.values()].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  assert.ok(median > 15 && median < 400, `median basket $${median.toFixed(0)}`);
  assert.ok(sorted.at(-1) > 1500, "some big trade orders");
});
