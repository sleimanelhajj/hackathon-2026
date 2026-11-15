// Invoices move stock and Sales (decision #58). An invoice we send (from the app, or from Gmail and read by the AI
// from the attachment) lowers stock and records a pending sales order; a supplier's invoice we receive raises stock
// and records a purchase. Automatic, as the user chose: each invoice counts once (keyed by its number), every change
// is logged in `invoice_changes` + `stock_movements`, and any of them can be undone from the Sales page.
// Email-read invoices count only from the moment this was switched on (`inventory_settings`), so old mail in the
// mailbox doesn't move stock all at once.
//
// Pure rules first (tests/server/inventory.test.mjs), then Postgres.
import { DEFAULT_SCHEMA, getPool, postgresConfigured } from "./sales/db.js";
import { matchProducts } from "./agent/reply-inventory.js";

const SKU = /\b[A-Z]{2,5}-\d{2,6}\b/i;
const words = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slug = (s) => words(s).replace(/\s+/g, "-") || "unknown";

/**
 * "sale" for an invoice we issued and sent, "purchase" for a supplier's invoice we received, null for anything else
 * (quotes, our own invoice coming back, a supplier's invoice we forwarded).
 */
export function invoiceKind(doc, storeName) {
  if (doc?.docType !== "invoice") return null;
  const issuer = words(doc.issuer);
  const store = words(storeName);
  const core = store.split(" ").slice(0, 2).join(" ");
  const ours = Boolean(issuer) && Boolean(store) && (store.startsWith(issuer) || issuer.startsWith(store) || (core.length > 3 && issuer.includes(core)));
  if (doc.direction === "out") return !issuer || ours ? "sale" : null;
  return ours ? null : "purchase";
}

/** One key per invoice, so the same invoice from the app and from Gmail (or read twice) counts once. */
export function invoiceKey({ kind, number, counterparty, fallback }) {
  const n = String(number ?? "").trim();
  if (!n) return `${kind}:doc:${fallback}`;
  return kind === "sale" ? `sale:${n.toUpperCase()}` : `purchase:${slug(counterparty)}:${n}`;
}

/**
 * Matches invoice lines to products: a SKU (given, or in the description), else a name only one product fits. Lines
 * without a whole quantity, or that fit no product or several, are reported back, never guessed. Repeats add up.
 */
export function resolveLines(lines, products) {
  const bySku = new Map(products.map((p) => [String(p.sku).toUpperCase(), p]));
  const matched = new Map();
  const unmatched = [];
  for (const line of lines ?? []) {
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) { unmatched.push({ description: line.description, reason: "no whole quantity" }); continue; }
    const sku = String(line.sku ?? SKU.exec(String(line.description ?? ""))?.[0] ?? "").toUpperCase();
    let product = sku ? bySku.get(sku) : null;
    if (!product) {
      const candidates = matchProducts(line.description, products);
      if (candidates.length > 1) { unmatched.push({ description: line.description, reason: "more than one product matches" }); continue; }
      product = candidates[0];
    }
    if (!product) { unmatched.push({ description: line.description, reason: "no product matches" }); continue; }
    const prev = matched.get(product.id);
    if (prev) prev.quantity += quantity;
    else matched.set(product.id, { productId: product.id, sku: product.sku, name: product.name, quantity, unitPrice: line.unitPrice ?? null });
  }
  return { matched: [...matched.values()], unmatched };
}

// ---------- Postgres ----------
const q = (schema) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  return `"${schema}"`;
};
const defaults = () => ({ pool: postgresConfigured() ? getPool() : null, schema: DEFAULT_SCHEMA });
/** Options with the app's database filled in for whatever wasn't given (a partial object must not mean "no database"). */
export const withDefaults = (opts) => ({ ...defaults(), ...Object.fromEntries(Object.entries(opts ?? {}).filter(([, v]) => v !== undefined)) });

async function inTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The customer for a sale: the known id, else one with that exact name, else a new one (so the revenue shows). */
async function customerFor(c, s, { customerId, counterparty }) {
  if (customerId) {
    const { rows: [row] } = await c.query(`SELECT id, region FROM ${s}.customers WHERE id = $1`, [customerId]);
    if (row) return row;
  }
  const name = String(counterparty ?? "").trim() || "Customer from an emailed invoice";
  const { rows: [found] } = await c.query(`SELECT id, region FROM ${s}.customers WHERE lower(name) = lower($1) ORDER BY id LIMIT 1`, [name]);
  if (found) return found;
  await c.query(`LOCK TABLE ${s}.customers IN EXCLUSIVE MODE`);
  const { rows: [{ next }] } = await c.query(`SELECT coalesce(max(id), 0) + 1 AS next FROM ${s}.customers`);
  await c.query(`INSERT INTO ${s}.customers (id, name, region, industry, segment, email, created_at) VALUES ($1, $2, 'Online', 'Unknown', 'Retail customer', NULL, now())`, [next, name.slice(0, 120)]);
  return { id: next, region: "Online" };
}

/**
 * Applies one invoice: { kind: "sale"|"purchase", number, counterparty, customerId?, date, currency, total, lines,
 * source?, sourceId? }. Returns { applied: false } when this invoice was already applied.
 */
export async function applyInvoice(inv, opts) {
  const { pool, schema } = withDefaults(opts);
  if (!pool) return { applied: false, reason: "no database" };
  const s = q(schema);
  return inTransaction(pool, async (c) => {
    const { rows: products } = await c.query(`SELECT id, sku, name, unit_price::float, unit_cost::float FROM ${s}.products`);
    const { matched, unmatched } = resolveLines(inv.lines, products);
    const key = invoiceKey({ kind: inv.kind, number: inv.number, counterparty: inv.counterparty, fallback: inv.sourceId ?? "unknown" });
    const lineSum = matched.reduce((n, m) => n + m.quantity * (m.unitPrice ?? 0), 0);
    const total = Number.isFinite(Number(inv.total)) && inv.total !== null ? Number(inv.total) : lineSum;
    const date = inv.date ? new Date(inv.date) : new Date();
    const { rows: claimed } = await c.query(
      `INSERT INTO ${s}.invoice_changes (key, kind, number, counterparty, total, currency, invoice_date, source, source_id, unmatched)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (key) DO NOTHING RETURNING key`,
      [key, inv.kind, inv.number ?? null, inv.counterparty ?? null, total, inv.currency || "USD", date, inv.source ?? null, inv.sourceId ?? null, JSON.stringify(unmatched)]
    );
    if (!claimed.length) return { applied: false, key, reason: "already applied" };

    const sign = inv.kind === "sale" ? -1 : 1;
    for (const m of matched) {
      await c.query(`UPDATE ${s}.products SET stock = coalesce(stock, 0) + $1 WHERE id = $2`, [sign * m.quantity, m.productId]);
      await c.query(`INSERT INTO ${s}.stock_movements (change_key, product_id, quantity_change) VALUES ($1, $2, $3)`, [key, m.productId, sign * m.quantity]);
    }
    const price = (m, field) => m.unitPrice ?? products.find((p) => p.id === m.productId)[field];
    if (inv.kind === "sale" && matched.length) {
      const customer = await customerFor(c, s, inv);
      const { rows: [rep] } = await c.query(`SELECT id FROM ${s}.reps ORDER BY (region = $1) DESC, id LIMIT 1`, [customer.region]);
      if (!rep) throw new Error("The sales data has no staff to record the order under. Load the demo data on the Sales page.");
      await c.query(`LOCK TABLE ${s}.orders IN EXCLUSIVE MODE`);
      const { rows: [{ next }] } = await c.query(`SELECT coalesce(max(id), 0) + 1 AS next FROM ${s}.orders`);
      const base = String(inv.number ?? `EMAIL-${next}`).slice(0, 60);
      const { rows: [{ taken }] } = await c.query(`SELECT count(*)::int AS taken FROM ${s}.orders WHERE number = $1`, [base]);
      await c.query(`INSERT INTO ${s}.orders (id, number, customer_id, rep_id, ordered_at, status, channel) VALUES ($1, $2, $3, $4, $5, 'pending', 'Invoice')`,
        [next, taken ? `${base}-${next}` : base, customer.id, rep.id, date]);
      for (const m of matched) {
        await c.query(`INSERT INTO ${s}.order_items (order_id, product_id, quantity, unit_price, discount_pct) VALUES ($1, $2, $3, $4, 0)`, [next, m.productId, m.quantity, price(m, "unit_price")]);
      }
      await c.query(`UPDATE ${s}.invoice_changes SET order_id = $1 WHERE key = $2`, [next, key]);
    }
    if (inv.kind === "purchase") {
      const { rows: [{ id }] } = await c.query(
        `INSERT INTO ${s}.purchases (number, supplier, purchased_at, total, currency, change_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [inv.number ?? null, String(inv.counterparty ?? "Supplier").slice(0, 120), date, total, inv.currency || "USD", key]
      );
      for (const m of matched) {
        await c.query(`INSERT INTO ${s}.purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)`, [id, m.productId, m.quantity, price(m, "unit_cost")]);
      }
      await c.query(`UPDATE ${s}.invoice_changes SET purchase_id = $1 WHERE key = $2`, [id, key]);
    }
    return { applied: true, key, matched, unmatched };
  });
}

/** Reverses one applied invoice: stock back, its order or purchase removed. */
export async function undoInvoice(key, opts) {
  const { pool, schema } = withDefaults(opts);
  if (!pool) throw new Error("Postgres isn't set up.");
  const s = q(schema);
  return inTransaction(pool, async (c) => {
    const { rows: [change] } = await c.query(`SELECT * FROM ${s}.invoice_changes WHERE key = $1 FOR UPDATE`, [key]);
    if (!change) throw new Error("That stock change isn't in the log.");
    if (change.undone_at) throw new Error("That change was already undone.");
    const { rows: moves } = await c.query(`SELECT id, product_id, quantity_change FROM ${s}.stock_movements WHERE change_key = $1 AND undone_at IS NULL`, [key]);
    for (const mv of moves) await c.query(`UPDATE ${s}.products SET stock = coalesce(stock, 0) - $1 WHERE id = $2`, [mv.quantity_change, mv.product_id]);
    await c.query(`UPDATE ${s}.stock_movements SET undone_at = now() WHERE change_key = $1`, [key]);
    if (change.order_id) await c.query(`DELETE FROM ${s}.orders WHERE id = $1`, [change.order_id]);
    if (change.purchase_id) await c.query(`DELETE FROM ${s}.purchases WHERE id = $1`, [change.purchase_id]);
    await c.query(`UPDATE ${s}.invoice_changes SET undone_at = now() WHERE key = $1`, [key]);
    return { key, undone: true };
  });
}

/** The log, newest first: each invoice with the stock it moved and the lines it couldn't match. */
export async function listInvoiceChanges(opts) {
  const { pool, schema, limit = 50 } = withDefaults(opts);
  if (!pool) return [];
  const s = q(schema);
  const { rows } = await pool.query(
    `SELECT ic.*, coalesce(json_agg(json_build_object('sku', p.sku, 'name', p.name, 'change', m.quantity_change) ORDER BY m.id) FILTER (WHERE m.id IS NOT NULL), '[]') AS lines
       FROM ${s}.invoice_changes ic LEFT JOIN ${s}.stock_movements m ON m.change_key = ic.key LEFT JOIN ${s}.products p ON p.id = m.product_id
      GROUP BY ic.id ORDER BY ic.id DESC LIMIT $1`,
    [Math.max(1, Math.min(200, limit))]
  );
  return rows.map((r) => ({
    key: r.key, kind: r.kind, number: r.number, counterparty: r.counterparty, total: r.total === null ? null : Number(r.total), currency: r.currency,
    invoiceDate: r.invoice_date, source: r.source, appliedAt: r.applied_at, undoneAt: r.undone_at, lines: r.lines, unmatched: r.unmatched ?? [],
  }));
}

/** When email-read invoices started to count (set the first time; older mail never moves stock). */
export async function emailInvoicesSince(opts) {
  const { pool, schema } = withDefaults(opts);
  if (!pool) return null;
  const s = q(schema);
  await pool.query(`INSERT INTO ${s}.inventory_settings (id, email_invoices_since) VALUES (1, now()) ON CONFLICT (id) DO NOTHING`);
  const { rows: [row] } = await pool.query(`SELECT email_invoices_since FROM ${s}.inventory_settings WHERE id = 1`);
  return row?.email_invoices_since ?? null;
}

/** An invoice the app created and just sent through Gmail. */
export function applyAppInvoice(invoice, opts) {
  return applyInvoice({
    kind: "sale", number: invoice.invoiceNumber, counterparty: invoice.customer?.name, customerId: invoice.customerId ?? null,
    date: invoice.sentAt ?? new Date(), currency: invoice.currency, total: invoice.totalMinor / 100, source: "app", sourceId: invoice._id,
    lines: (invoice.lineItems ?? []).map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPriceMinor / 100 })),
  }, opts);
}

/** An invoice the AI read from an email attachment (documents.js). Only mail from `since` on counts. */
export async function applyEmailInvoice(doc, { storeName, since, ...opts }) {
  if (!since || new Date(doc.sentAt) < new Date(since)) return { applied: false, reason: "before invoices counted" };
  const kind = invoiceKind(doc, storeName);
  if (!kind) return { applied: false, reason: "not an invoice that moves stock" };
  return applyInvoice({
    kind, number: doc.number, counterparty: kind === "sale" ? doc.billedTo || doc.contact?.name : doc.issuer || doc.contact?.name,
    date: doc.issueDate ? new Date(`${doc.issueDate}T12:00:00Z`) : doc.sentAt, currency: doc.currency, total: doc.total,
    source: "email", sourceId: doc._id, lines: doc.lines,
  }, opts);
}
