// Invoices move stock and Sales (server/inventory.js, decision #58). An invoice we send lowers stock and records a
// sales order; a supplier's invoice we receive raises stock and records a purchase. Each invoice counts once (by its
// number), automatically, and every change can be undone. The database part runs on a throwaway Postgres schema
// (needs POSTGRES_URL, like sales-metrics.test.mjs); the rules run anywhere.
import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { invoiceKind, invoiceKey, resolveLines } from "../../server/inventory.js";

const products = [
  { id: 1, sku: "CH-0001", name: "Solar panel 450W", unit_price: 189, unit_cost: 120, stock: 9 },
  { id: 2, sku: "CH-0002", name: "Inverter battery 200Ah (lithium)", unit_price: 1450, unit_cost: 1000, stock: 0 },
  { id: 3, sku: "CH-0020", name: "LED bulb 9W (pack of 4)", unit_price: 8.5, unit_cost: 4, stock: 240 },
  { id: 4, sku: "CH-0021", name: "LED bulb 12W (pack of 4)", unit_price: 10.5, unit_cost: 5, stock: 120 },
];

test("which invoices count: ours going out is a sale, a supplier's coming in is a purchase", () => {
  const store = "Cedar Hardware & Supply";
  assert.equal(invoiceKind({ docType: "invoice", direction: "out", issuer: "Cedar Hardware & Supply" }, store), "sale");
  assert.equal(invoiceKind({ docType: "invoice", direction: "out", issuer: null }, store), "sale", "we sent it: ours");
  assert.equal(invoiceKind({ docType: "invoice", direction: "in", issuer: "Northstar Trade Co." }, store), "purchase");
  assert.equal(invoiceKind({ docType: "invoice", direction: "in", issuer: "Cedar Hardware" }, store), null, "our own invoice coming back isn't a purchase");
  assert.equal(invoiceKind({ docType: "invoice", direction: "out", issuer: "Northstar Trade Co." }, store), null, "forwarding a supplier's invoice isn't a sale");
  assert.equal(invoiceKind({ docType: "quote", direction: "in", issuer: "Northstar" }, store), null, "quotes don't move stock");
});

test("one key per invoice: the same number from the app and from Gmail counts once", () => {
  assert.equal(invoiceKey({ kind: "sale", number: "INV-20261114-83D3" }), "sale:INV-20261114-83D3");
  assert.equal(invoiceKey({ kind: "sale", number: " inv-20261114-83d3 " }), "sale:INV-20261114-83D3");
  assert.equal(invoiceKey({ kind: "purchase", number: "1042", counterparty: "Northstar Trade Co." }), "purchase:northstar-trade-co:1042");
  assert.equal(invoiceKey({ kind: "purchase", number: null, counterparty: "Northstar", fallback: "g1:2" }), "purchase:doc:g1:2");
});

test("invoice lines are matched to products by SKU, then by an unambiguous name; the rest are reported, not guessed", () => {
  const { matched, unmatched } = resolveLines([
    { description: "Solar panel 450W (CH-0001)", quantity: 10, unitPrice: 189 },
    { description: "Lithium inverter battery 200Ah", sku: null, quantity: 2, unitPrice: 1450 },
    { description: "LED bulbs", quantity: 50, unitPrice: 9 },
    { description: "Delivery fee", quantity: 1, unitPrice: 25 },
    { description: "Solar panel 450W", quantity: null, unitPrice: 189 },
    { description: "Solar panel 450W", sku: "CH-0001", quantity: 2.5 },
  ], products);
  assert.deepEqual(matched.map((m) => [m.productId, m.quantity]), [[1, 10], [2, 2]]);
  assert.equal(matched[0].unitPrice, 189);
  assert.deepEqual(unmatched.map((u) => u.reason), ["more than one product matches", "no product matches", "no whole quantity", "no whole quantity"]);
});

test("the same product twice on one invoice is added up", () => {
  const { matched } = resolveLines([{ description: "x", sku: "CH-0001", quantity: 2 }, { description: "y", sku: "ch-0001", quantity: 3 }], products);
  assert.deepEqual(matched.map((m) => [m.productId, m.quantity]), [[1, 5]]);
});

// ---- against Postgres ----
const url = process.env.POSTGRES_URL;
const skip = url ? false : "POSTGRES_URL is not set";
const schema = `test_inventory_${process.pid}`;

test("applying an invoice moves stock and Sales once; undo puts everything back", { skip }, async (t) => {
  const db = await import("../../server/sales/db.js");
  const inv = await import("../../server/inventory.js");
  const pool = db.createPool(url);
  t.after(async () => { await db.dropSchema(pool, schema); await pool.end(); });
  await db.createSchema(pool, schema);
  await pool.query(`INSERT INTO "${schema}".reps VALUES (1, 'Nour Azar', 'Beirut store', 10000)`);
  await pool.query(`INSERT INTO "${schema}".customers (id, name, region, industry, segment, email, created_at) VALUES (7, 'Frem Electric', 'Beirut store', 'Electrical', 'Trade account', 'a@frem.example', now())`);
  for (const p of products) await pool.query(`INSERT INTO "${schema}".products (id, sku, name, category, unit_price, unit_cost, stock) VALUES ($1, $2, $3, 'Solar', $4, $5, $6)`, [p.id, p.sku, p.name, p.unit_price, p.unit_cost, p.stock]);
  const stock = async (id) => (await pool.query(`SELECT stock FROM "${schema}".products WHERE id = $1`, [id])).rows[0].stock;
  const opts = { pool, schema };

  // A sale to a known customer: stock down, a pending order up.
  const sale = { kind: "sale", number: "INV-1", counterparty: "Frem Electric", customerId: 7, date: new Date("2026-11-15T10:00:00Z"), currency: "USD", total: 2268,
    lines: [{ description: "Solar panel 450W (CH-0001)", quantity: 12, unitPrice: 189 }] };
  const first = await inv.applyInvoice(sale, opts);
  assert.equal(first.applied, true);
  assert.equal(await stock(1), -3, "selling more than we hold shows as negative stock rather than hiding it");
  const order = (await pool.query(`SELECT o.number, o.status, o.customer_id, li.quantity FROM "${schema}".orders o JOIN "${schema}".order_items li ON li.order_id = o.id`)).rows;
  assert.deepEqual(order, [{ number: "INV-1", status: "pending", customer_id: 7, quantity: 12 }]);
  assert.equal((await inv.applyInvoice(sale, opts)).applied, false, "the same invoice again changes nothing");
  assert.equal(await stock(1), -3);

  // A sale to someone not in the customer list: they're added, so the revenue shows up.
  await inv.applyInvoice({ ...sale, number: "INV-2", counterparty: "New Builder Co", customerId: null, lines: [{ description: "x", sku: "CH-0020", quantity: 4, unitPrice: 8.5 }] }, opts);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".customers WHERE name = 'New Builder Co'`)).rows[0].n, 1);

  // A supplier invoice: stock up, a purchase recorded.
  const purchase = { kind: "purchase", number: "NS-77", counterparty: "Northstar Trade Co.", date: new Date("2026-11-15T11:00:00Z"), currency: "USD", total: 1200,
    lines: [{ description: "Solar panel 450W", sku: "CH-0001", quantity: 10, unitPrice: 120 }, { description: "Delivery", quantity: 1, unitPrice: 30 }] };
  const bought = await inv.applyInvoice(purchase, opts);
  assert.equal(await stock(1), 7);
  assert.equal(bought.unmatched.length, 1);
  assert.equal((await pool.query(`SELECT total::float FROM "${schema}".purchases`)).rows[0].total, 1200);

  // Both show on the Sales dashboard: the sales as revenue, the supplier invoice as purchases.
  const { salesDashboard } = await import("../../server/sales/metrics.js");
  const dash = await salesDashboard(pool, { schema, months: 1, now: new Date("2026-11-20T12:00:00Z") });
  assert.equal(dash.kpis.purchases, 1200);
  assert.equal(dash.kpis.purchaseCount, 1);
  assert.equal(Math.round(dash.kpis.revenue), 12 * 189 + 4 * 8.5);

  const log = await inv.listInvoiceChanges(opts);
  assert.deepEqual(log.map((l) => l.key), ["purchase:northstar-trade-co:NS-77", "sale:INV-2", "sale:INV-1"]);
  assert.deepEqual(log[0].lines.map((l) => [l.sku, l.change]), [["CH-0001", 10]]);

  // Undo the purchase and the first sale: stock and Sales are back.
  await inv.undoInvoice("purchase:northstar-trade-co:NS-77", opts);
  await inv.undoInvoice("sale:INV-1", opts);
  assert.equal(await stock(1), 9);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".orders WHERE number = 'INV-1'`)).rows[0].n, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".purchases`)).rows[0].n, 0);
  await assert.rejects(inv.undoInvoice("sale:INV-1", opts), /already undone/);
  assert.equal((await inv.listInvoiceChanges(opts)).find((l) => l.key === "sale:INV-1").undoneAt !== null, true);
});

test("options without a database still use the app's database (the bug that skipped every emailed invoice)", async () => {
  const { withDefaults } = await import("../../server/inventory.js");
  const pool = { fake: true };
  assert.equal(withDefaults({ storeName: "Cedar", since: new Date() }).schema, "sales", "a partial options object keeps the defaults");
  assert.ok("pool" in withDefaults({ storeName: "Cedar" }));
  assert.equal(withDefaults({ pool, schema: "test_x" }).pool, pool);
  assert.equal(withDefaults({ pool, schema: "test_x" }).schema, "test_x");
  assert.equal(withDefaults(undefined).schema, "sales");
});
