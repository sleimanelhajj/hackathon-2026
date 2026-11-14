// Database backup and restore (decision #53).
//
// Postgres: the sales schema is fictional demo data, so all of it is exported to JSON (backups/sales.json, committed)
// and can be restored with `npm run db:restore -- --yes`. The JSON has the same shape as generateSalesData(), so
// restoring reuses loadData().
//
// MongoDB: only collections without personal data are backed up (dashboard layouts, invoice drafts for fictional
// customers). Synced email, AI labels about it, attachment text and OAuth tokens are never exported or committed;
// a teammate connects and syncs their own Gmail instead (AGENTS.md rules 1 and 5).
import { DEFAULT_SCHEMA, createSchema, loadData } from "./db.js";

export const SALES_FORMAT = "ai-workspace-os/sales@1";
export const MONGO_FORMAT = "ai-workspace-os/mongo-safe@1";
export const MONGO_BACKUP_COLLECTIONS = ["dashboards", "invoices"];
export const MONGO_NEVER_BACKED_UP = ["messages", "connections", "extractions", "attachment_text", "calendar_invites", "labels", "calendar_sync", "audit_events"];

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const num = (v) => (v == null ? null : Number(v));

/** Every row of the sales schema, in the shape generateSalesData() returns. */
export async function exportSales(pool, schema = DEFAULT_SCHEMA) {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  const s = `"${schema}"`;
  const q = async (sql) => (await pool.query(sql)).rows;
  const [profile] = await q(`SELECT * FROM ${s}.store_profile WHERE id = 1`);
  const data = {
    profile: profile ? { name: profile.name, email: profile.email, phone: profile.phone, address: profile.address, currency: profile.currency, taxRateBps: profile.tax_rate_bps, paymentTermsDays: profile.payment_terms_days } : null,
    reps: (await q(`SELECT * FROM ${s}.reps ORDER BY id`)).map((r) => ({ id: r.id, name: r.name, region: r.region, monthlyTarget: num(r.monthly_target) })),
    customers: (await q(`SELECT * FROM ${s}.customers ORDER BY id`)).map((c) => ({ id: c.id, name: c.name, region: c.region, industry: c.industry, segment: c.segment, email: c.email, phone: c.phone, address: c.address, createdAt: c.created_at })),
    products: (await q(`SELECT * FROM ${s}.products ORDER BY id`)).map((p) => ({
      id: p.id, sku: p.sku, name: p.name, category: p.category, brand: p.brand, unit: p.unit, description: p.description,
      uses: String(p.uses ?? "").split(/,\s*/).filter(Boolean), unitPrice: num(p.unit_price), unitCost: num(p.unit_cost), stock: p.stock, reorderLevel: p.reorder_level,
    })),
    orders: (await q(`SELECT * FROM ${s}.orders ORDER BY id`)).map((o) => ({ id: o.id, number: o.number, customerId: o.customer_id, repId: o.rep_id, orderedAt: o.ordered_at, status: o.status, channel: o.channel })),
    orderItems: (await q(`SELECT * FROM ${s}.order_items ORDER BY order_id, product_id`)).map((i) => ({ orderId: i.order_id, productId: i.product_id, quantity: i.quantity, unitPrice: num(i.unit_price), discountPct: num(i.discount_pct) })),
    deals: (await q(`SELECT * FROM ${s}.deals ORDER BY id`)).map((d) => ({ id: d.id, name: d.name, customerId: d.customer_id, repId: d.rep_id, stage: d.stage, amount: num(d.amount), createdAt: d.created_at, closedAt: d.closed_at, expectedClose: d.expected_close })),
  };
  return { format: SALES_FORMAT, exportedAt: new Date().toISOString(), counts: Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])), data };
}

/** Replaces the sales schema with a backup (as read from JSON: dates are strings). */
export async function importSales(pool, schema = DEFAULT_SCHEMA, backup) {
  if (backup?.format !== SALES_FORMAT || !backup.data?.orders) throw new Error("That file is not a sales backup from this app.");
  const d = backup.data;
  const date = (v) => (v == null ? null : new Date(v));
  const data = {
    profile: d.profile,
    reps: d.reps,
    customers: d.customers.map((c) => ({ ...c, createdAt: date(c.createdAt) })),
    products: d.products,
    orders: d.orders.map((o) => ({ ...o, orderedAt: date(o.orderedAt) })),
    orderItems: d.orderItems,
    deals: d.deals.map((x) => ({ ...x, createdAt: date(x.createdAt), closedAt: date(x.closedAt), expectedClose: date(x.expectedClose) })),
  };
  await createSchema(pool, schema);
  await loadData(pool, schema, data);
  return backup.counts ?? null;
}
