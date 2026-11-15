// Updating the business records through the assistant (server/sales/changes.js, decision #68). Every change is
// proposed first (exactly what will change, before → after, with warnings), saved only when the user confirms, logged,
// and can be undone. New sales and supplier purchases go through the same invoice log as emailed invoices, so stock,
// revenue and the Sales page's Undo stay consistent. Checked against real Postgres in a throwaway schema.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { generateSalesData } from "../../server/sales/seed.js";
import { CHANGE_DECLARATIONS } from "../../server/sales/changes.js";

const url = process.env.POSTGRES_URL;
const skip = url ? false : "POSTGRES_URL is not set";
const now = new Date("2026-11-15T12:00:00Z");
const schema = `test_changes_${process.pid}`;
const data = generateSalesData({ months: 24, now });

let pool, desk, q;
before(async () => {
  if (skip) return;
  const db = await import("../../server/sales/db.js");
  const { createChangeDesk } = await import("../../server/sales/changes.js");
  pool = db.createPool(url);
  await db.createSchema(pool, schema);
  await db.loadData(pool, schema, data);
  desk = createChangeDesk({ pool, schema, now: () => now });
  q = async (sql, params) => (await pool.query(sql.replaceAll("$S", `"${schema}"`), params)).rows;
});
after(async () => {
  if (!pool) return;
  const db = await import("../../server/sales/db.js");
  await db.dropSchema(pool, schema);
  await pool.end();
});

const field = (draft, label) => draft.fields.find((f) => f.label === label);

test("every change tool is declared for the model, and each says it only proposes", () => {
  const names = CHANGE_DECLARATIONS.map((d) => d.name);
  for (const n of ["propose_new_customer", "propose_customer_update", "propose_new_product", "propose_product_update", "propose_sale",
    "propose_purchase", "propose_expense", "propose_order_status", "propose_quote", "propose_staff_target", "propose_store_settings"]) assert.ok(names.includes(n), n);
  for (const d of CHANGE_DECLARATIONS) assert.match(d.description, /confirm/i, `${d.name} says the user confirms`);
});

test("a new customer: proposed with every field, saved on apply, removed again by undo", { skip }, async () => {
  const draft = await desk.propose("propose_new_customer", { name: "Zahle Green Farms", segment: "commercial", branch: "Online", industry: "Agriculture", email: "accounts@zahlegreen.example", phone: "+961 8 555 210" });
  assert.equal(draft.kind, "new_customer");
  assert.equal(draft.target, "Zahle Green Farms");
  assert.equal(field(draft, "Segment").after, "Commercial account");
  assert.equal(field(draft, "Segment").before, null, "a new record has no before");
  assert.equal((await q(`SELECT count(*)::int AS n FROM $S.customers WHERE name = 'Zahle Green Farms'`))[0].n, 0, "proposing saves nothing");

  const done = await desk.apply(draft);
  assert.equal(done.applied, true);
  const [row] = await q(`SELECT id, segment, region FROM $S.customers WHERE name = 'Zahle Green Farms'`);
  assert.deepEqual([row.segment, row.region], ["Commercial account", "Online"]);
  assert.ok(row.id > data.customers.length);

  await desk.undo(done.id);
  assert.equal((await q(`SELECT count(*)::int AS n FROM $S.customers WHERE name = 'Zahle Green Farms'`))[0].n, 0);
  await assert.rejects(desk.undo(done.id), /already undone/i);
});

test("updating a customer shows only what changes, before and after; asking for no change is refused", { skip }, async () => {
  const draft = await desk.propose("propose_customer_update", { customer: "Karim Haddad", phone: "+961 3 111 222", email: "karim.h@mail.example" });
  assert.deepEqual(draft.fields.map((f) => f.label).sort(), ["Email", "Phone"]);
  assert.ok(field(draft, "Phone").before && field(draft, "Phone").after === "+961 3 111 222");
  const done = await desk.apply(draft);
  assert.equal((await q(`SELECT phone FROM $S.customers WHERE name = 'Karim Haddad'`))[0].phone, "+961 3 111 222");
  await desk.undo(done.id);
  assert.notEqual((await q(`SELECT phone FROM $S.customers WHERE name = 'Karim Haddad'`))[0].phone, "+961 3 111 222", "undo puts the old phone back");
  await assert.rejects(desk.propose("propose_customer_update", { customer: "Karim Haddad" }), /nothing to change/i);
  await assert.rejects(desk.propose("propose_customer_update", { customer: "Nobody Such", phone: "1" }), /no customer/i);
});

test("a new product gets the next SKU; prices are checked; cost above price is a warning", { skip }, async () => {
  await assert.rejects(desk.propose("propose_new_product", { name: "Bad", category: "Batteries", unitPrice: -5, unitCost: 2 }), /price/i);
  const draft = await desk.propose("propose_new_product", { name: "Lithium battery 10kWh (LiFePO4)", category: "Batteries", unitPrice: 1750, unitCost: 1900, stock: 4, reorderLevel: 2, brand: "VoltCedar" });
  assert.equal(field(draft, "SKU").after, "CH-0011");
  assert.ok(draft.warnings.some((w) => /cost is above the price/i.test(w)));
  const done = await desk.apply(draft);
  const [p] = await q(`SELECT sku, unit_price::float AS price, stock FROM $S.products WHERE name = 'Lithium battery 10kWh (LiFePO4)'`);
  assert.deepEqual([p.sku, p.price, p.stock], ["CH-0011", 1750, 4]);
  await desk.undo(done.id);
});

test("updating a product: new price and a stock count, found by SKU or by name", { skip }, async () => {
  const draft = await desk.propose("propose_product_update", { product: "550W", unitPrice: 115, stock: 60 });
  assert.equal(draft.target, "Solar panel 550W (mono)");
  assert.deepEqual([field(draft, "Price").before, field(draft, "Price").after], [110, 115]);
  const done = await desk.apply(draft);
  assert.equal((await q(`SELECT unit_price::float AS p FROM $S.products WHERE sku = 'CH-0001'`))[0].p, 115);
  await desk.undo(done.id);
  assert.equal((await q(`SELECT unit_price::float AS p FROM $S.products WHERE sku = 'CH-0001'`))[0].p, 110);
  await assert.rejects(desk.propose("propose_product_update", { product: "inverter", unitPrice: 500 }), /more than one product/i);
});

test("a new sale (invoice): revenue recorded as an order, stock goes down, and undo reverses both", { skip }, async () => {
  const before = (await q(`SELECT stock FROM $S.products WHERE sku = 'CH-0001'`))[0].stock;
  const draft = await desk.propose("propose_sale", { customer: "Khoury Solar Solutions", lines: [{ product: "CH-0001", quantity: 10 }, { product: "Roof mounting kit", quantity: 3 }], paid: true });
  assert.equal(draft.kind, "sale");
  assert.equal(draft.lines.length, 2);
  assert.equal(draft.lines[0].unitPrice, 104.5, "trade accounts get 5% off the $110 list price, as on invoices");
  assert.equal(draft.total, 10 * 104.5 + 3 * 71.25);
  const done = await desk.apply(draft);
  assert.equal(done.applied, true);
  const [order] = await q(`SELECT o.status, sum(oi.quantity * oi.unit_price)::float AS total FROM $S.orders o JOIN $S.order_items oi ON oi.order_id = o.id WHERE o.number = $1 GROUP BY o.status`, [draft.number]);
  assert.deepEqual([order.status, order.total], ["paid", draft.total]);
  assert.equal((await q(`SELECT stock FROM $S.products WHERE sku = 'CH-0001'`))[0].stock, before - 10);
  await desk.undo(done.id);
  assert.equal((await q(`SELECT stock FROM $S.products WHERE sku = 'CH-0001'`))[0].stock, before);
  assert.equal((await q(`SELECT count(*)::int AS n FROM $S.orders WHERE number = $1`, [draft.number]))[0].n, 0);
});

test("selling more than is in stock is allowed but warned about; an unknown product is refused", { skip }, async () => {
  const draft = await desk.propose("propose_sale", { customer: "Karim Haddad", lines: [{ product: "CH-0004", quantity: 2 }] });
  assert.ok(draft.warnings.some((w) => /stock/i.test(w)), "the 5 kWh battery is out of stock");
  await assert.rejects(desk.propose("propose_sale", { customer: "Karim Haddad", lines: [{ product: "flux capacitor", quantity: 1 }] }), /no product/i);
  await assert.rejects(desk.propose("propose_sale", { customer: "Karim Haddad", lines: [] }), /at least one/i);
});

test("a supplier purchase (a cost): stock goes up and the purchase is recorded at its cost", { skip }, async () => {
  const before = (await q(`SELECT stock FROM $S.products WHERE sku = 'CH-0004'`))[0].stock;
  const draft = await desk.propose("propose_purchase", { supplier: "VoltCedar Trading", number: "VC-2231", lines: [{ product: "CH-0004", quantity: 8, unitCost: 720 }] });
  assert.equal(draft.total, 5760);
  const done = await desk.apply(draft);
  assert.equal((await q(`SELECT stock FROM $S.products WHERE sku = 'CH-0004'`))[0].stock, before + 8);
  assert.equal((await q(`SELECT total::float AS t FROM $S.purchases WHERE supplier = 'VoltCedar Trading'`))[0].t, 5760);
  await desk.undo(done.id);
  assert.equal((await q(`SELECT stock FROM $S.products WHERE sku = 'CH-0004'`))[0].stock, before);
});

test("an expense (rent, salaries…) is recorded with its category and date, and shows in the expenses summary", { skip }, async () => {
  await assert.rejects(desk.propose("propose_expense", { category: "Rent", amount: 0 }), /amount/i);
  const draft = await desk.propose("propose_expense", { category: "rent", amount: 1200, date: "2026-11-01", description: "Beirut store rent, November" });
  assert.equal(field(draft, "Category").after, "Rent");
  const done = await desk.apply(draft);
  const summary = await desk.expensesSummary({ months: 1 });
  assert.equal(summary.total, 1200);
  assert.deepEqual(summary.byCategory, [{ category: "Rent", amount: 1200 }]);
  await desk.undo(done.id);
  assert.equal((await desk.expensesSummary({ months: 1 })).total, 0);
});

test("order status, quotes, staff targets and shop settings can be changed, each with its before and after", { skip }, async () => {
  const [pending] = await q(`SELECT number FROM $S.orders WHERE status = 'pending' ORDER BY id LIMIT 1`);
  const paid = await desk.propose("propose_order_status", { order: pending.number, status: "paid" });
  assert.deepEqual([field(paid, "Status").before, field(paid, "Status").after], ["pending", "paid"]);
  const p = await desk.apply(paid);
  assert.equal((await q(`SELECT status FROM $S.orders WHERE number = $1`, [pending.number]))[0].status, "paid");
  await desk.undo(p.id);

  const quote = await desk.propose("propose_quote", { customer: "Bekaa Valley Farms", name: "Irrigation pump, east field", amount: 3400, stage: "proposal" });
  const qd = await desk.apply(quote);
  const [deal] = await q(`SELECT id, stage FROM $S.deals WHERE name = 'Bekaa Valley Farms – Irrigation pump, east field'`); // "Customer – job", like every quote
  assert.equal(deal.stage, "proposal");
  const won = await desk.propose("propose_quote", { quote: String(deal.id), stage: "won" });
  assert.equal(field(won, "Stage").after, "won");
  const w = await desk.apply(won);
  assert.ok((await q(`SELECT closed_at FROM $S.deals WHERE id = $1`, [deal.id]))[0].closed_at, "winning a quote closes it");
  await desk.undo(w.id);
  await desk.undo(qd.id);

  const target = await desk.propose("propose_staff_target", { staff: "Hiba", monthlyTarget: 2500 });
  assert.equal(target.target, "Hiba Saleh");
  const t = await desk.apply(target);
  await desk.undo(t.id);

  const settings = await desk.propose("propose_store_settings", { taxRatePct: 11, paymentTermsDays: 45 });
  assert.deepEqual(settings.fields.map((f) => f.label), ["Payment terms (days)"], "an unchanged tax rate isn't listed");
  const s = await desk.apply(settings);
  assert.equal((await q(`SELECT payment_terms_days FROM $S.store_profile`))[0].payment_terms_days, 45);
  await desk.undo(s.id);
  assert.equal((await q(`SELECT payment_terms_days FROM $S.store_profile`))[0].payment_terms_days, 30);
});

test("undo refuses when the record changed again since, instead of overwriting the newer value", { skip }, async () => {
  const first = await desk.apply(await desk.propose("propose_product_update", { product: "CH-0007", reorderLevel: 20 }));
  await desk.apply(await desk.propose("propose_product_update", { product: "CH-0007", reorderLevel: 25 }));
  await assert.rejects(desk.undo(first.id), /changed again/i);
});

test("the log lists recent changes, newest first, with whether each can still be undone", { skip }, async () => {
  const log = await desk.recent({ limit: 5 });
  assert.ok(log.length >= 1);
  assert.ok(log.every((c) => c.title && c.appliedAt));
  assert.ok(new Date(log[0].appliedAt) >= new Date(log.at(-1).appliedAt));
});
