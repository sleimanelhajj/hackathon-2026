// Postgres connector for the Sales dashboard. Connection string: POSTGRES_URL in .env (never in code or logs).
// Sales tables live in their own schema ("sales" by default), so tests can use a throwaway schema side by side.
import pg from "pg";

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
export const DEFAULT_SCHEMA = "sales";

function safe(schema) {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  return `"${schema}"`;
}

export function postgresConfigured() {
  return Boolean(process.env.POSTGRES_URL?.trim());
}

export function createPool(url = process.env.POSTGRES_URL) {
  if (!url) throw new Error("Postgres isn't set up. Add POSTGRES_URL to .env and restart the server.");
  const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  pool.on("error", (err) => console.error("Postgres pool error:", err.message)); // never crash the API on an idle-client error
  return pool;
}

let shared = null;
/** The API's pool (created on first use). */
export function getPool() {
  shared ??= createPool();
  return shared;
}

/** Creates the database named in the URL if it doesn't exist yet (connects to the "postgres" database to do it). */
export async function ensureDatabase(url = process.env.POSTGRES_URL) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, "")) || "postgres";
  if (name === "postgres") return { created: false, name };
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (rowCount) return { created: false, name };
    if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Can't create a database named "${name}". Create it yourself, then try again.`);
    await client.query(`CREATE DATABASE "${name}"`);
    return { created: true, name };
  } finally {
    await client.end();
  }
}

export async function createSchema(pool, schema = DEFAULT_SCHEMA) {
  const s = safe(schema);
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS ${s};
    CREATE TABLE IF NOT EXISTS ${s}.reps (
      id integer PRIMARY KEY, name text NOT NULL, region text NOT NULL, monthly_target numeric(12,2) NOT NULL);
    CREATE TABLE IF NOT EXISTS ${s}.customers (
      id integer PRIMARY KEY, name text NOT NULL, region text NOT NULL, industry text NOT NULL, segment text NOT NULL,
      email text, created_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS ${s}.products (
      id integer PRIMARY KEY, sku text NOT NULL UNIQUE, name text NOT NULL, category text NOT NULL,
      unit_price numeric(12,2) NOT NULL CHECK (unit_price > 0), unit_cost numeric(12,2) NOT NULL CHECK (unit_cost > 0));
    CREATE TABLE IF NOT EXISTS ${s}.orders (
      id integer PRIMARY KEY, number text NOT NULL UNIQUE, customer_id integer NOT NULL REFERENCES ${s}.customers(id),
      rep_id integer NOT NULL REFERENCES ${s}.reps(id), ordered_at timestamptz NOT NULL,
      status text NOT NULL CHECK (status IN ('paid', 'pending', 'refunded')), channel text NOT NULL);
    CREATE TABLE IF NOT EXISTS ${s}.order_items (
      order_id integer NOT NULL REFERENCES ${s}.orders(id) ON DELETE CASCADE, product_id integer NOT NULL REFERENCES ${s}.products(id),
      quantity integer NOT NULL CHECK (quantity > 0), unit_price numeric(12,2) NOT NULL, discount_pct numeric(5,2) NOT NULL DEFAULT 0,
      PRIMARY KEY (order_id, product_id));
    CREATE TABLE IF NOT EXISTS ${s}.deals (
      id integer PRIMARY KEY, name text NOT NULL, customer_id integer NOT NULL REFERENCES ${s}.customers(id),
      rep_id integer NOT NULL REFERENCES ${s}.reps(id),
      stage text NOT NULL CHECK (stage IN ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
      amount numeric(12,2) NOT NULL CHECK (amount > 0), created_at timestamptz NOT NULL, closed_at timestamptz, expected_close timestamptz);
    CREATE INDEX IF NOT EXISTS orders_ordered_at ON ${s}.orders (ordered_at);
    CREATE INDEX IF NOT EXISTS deals_stage ON ${s}.deals (stage);
  `);
}

export async function dropSchema(pool, schema) {
  await pool.query(`DROP SCHEMA IF EXISTS ${safe(schema)} CASCADE`);
}

/** Bulk insert with UNNEST: one statement per table, however many rows. */
async function insert(client, table, columns, types, rows) {
  if (!rows.length) return;
  const arrays = columns.map((_, i) => rows.map((r) => r[i]));
  const params = types.map((t, i) => `$${i + 1}::${t}[]`).join(", ");
  await client.query(`INSERT INTO ${table} (${columns.join(", ")}) SELECT * FROM UNNEST(${params})`, arrays);
}

/** Replaces everything in the schema with `data` (from generateSalesData), in one transaction. */
export async function loadData(pool, schema, data) {
  const s = safe(schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${s}.order_items, ${s}.orders, ${s}.deals, ${s}.customers, ${s}.products, ${s}.reps`);
    await insert(client, `${s}.reps`, ["id", "name", "region", "monthly_target"], ["int", "text", "text", "numeric"],
      data.reps.map((r) => [r.id, r.name, r.region, r.monthlyTarget]));
    await insert(client, `${s}.customers`, ["id", "name", "region", "industry", "segment", "email", "created_at"], ["int", "text", "text", "text", "text", "text", "timestamptz"],
      data.customers.map((c) => [c.id, c.name, c.region, c.industry, c.segment, c.email, c.createdAt]));
    await insert(client, `${s}.products`, ["id", "sku", "name", "category", "unit_price", "unit_cost"], ["int", "text", "text", "text", "numeric", "numeric"],
      data.products.map((p) => [p.id, p.sku, p.name, p.category, p.unitPrice, p.unitCost]));
    await insert(client, `${s}.orders`, ["id", "number", "customer_id", "rep_id", "ordered_at", "status", "channel"], ["int", "text", "int", "int", "timestamptz", "text", "text"],
      data.orders.map((o) => [o.id, o.number, o.customerId, o.repId, o.orderedAt, o.status, o.channel]));
    await insert(client, `${s}.order_items`, ["order_id", "product_id", "quantity", "unit_price", "discount_pct"], ["int", "int", "int", "numeric", "numeric"],
      data.orderItems.map((i) => [i.orderId, i.productId, i.quantity, i.unitPrice, i.discountPct]));
    await insert(client, `${s}.deals`, ["id", "name", "customer_id", "rep_id", "stage", "amount", "created_at", "closed_at", "expected_close"], ["int", "text", "int", "int", "text", "numeric", "timestamptz", "timestamptz", "timestamptz"],
      data.deals.map((d) => [d.id, d.name, d.customerId, d.repId, d.stage, d.amount, d.createdAt, d.closedAt, d.expectedClose]));
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Row counts per table, or null when the tables don't exist yet. */
export async function tableCounts(pool, schema = DEFAULT_SCHEMA) {
  const s = safe(schema);
  const { rows } = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'orders'", [schema]);
  if (!rows.length) return null;
  const { rows: [c] } = await pool.query(`SELECT
    (SELECT count(*) FROM ${s}.customers)::int AS customers, (SELECT count(*) FROM ${s}.products)::int AS products,
    (SELECT count(*) FROM ${s}.orders)::int AS orders, (SELECT count(*) FROM ${s}.deals)::int AS deals,
    (SELECT count(*) FROM ${s}.reps)::int AS reps`);
  return c;
}
