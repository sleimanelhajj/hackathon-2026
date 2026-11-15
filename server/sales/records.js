// Data for list widgets (decision #69): rows of products, customers, orders, supplier purchases, expenses, quotes or
// staff, with the columns, filters and sort the assistant chose. The widget holds a typed query (shared/spec.js
// RecordsQuery); this file is the only place it becomes SQL, and only by picking fixed fragments from the allow-lists
// below. Every value is a bound parameter. Runs in a READ ONLY transaction with a statement timeout.
import { RECORD_DATASETS, RecordsQuery, recordsProblems } from "../../shared/spec.js";
import { DEFAULT_SCHEMA } from "./db.js";
import { salesRange } from "./metrics.js";

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const LINE = "li.quantity * li.unit_price * (1 - li.discount_pct / 100)";
const day = (sql) => `to_char(${sql} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

/**
 * Each dataset: its FROM (with the period's figures joined in), the SQL of every column (keys match
 * RECORD_DATASETS), and the filters it understands. `p(value)` binds a value and returns its placeholder.
 */
const DATASETS = {
  products: {
    from: (s, p, { from, to }) => `${s}.products p
      LEFT JOIN (SELECT li.product_id, sum(li.quantity) AS units, sum(${LINE}) AS revenue FROM ${s}.order_items li
        JOIN ${s}.orders o ON o.id = li.order_id WHERE o.status <> 'refunded' AND o.ordered_at >= ${p(from)} AND o.ordered_at <= ${p(to)} GROUP BY 1) sold ON sold.product_id = p.id
      LEFT JOIN (SELECT pi.product_id, sum(pi.quantity) AS units, sum(pi.quantity * coalesce(pi.unit_cost, pp.unit_cost)) AS cost FROM ${s}.purchase_items pi
        JOIN ${s}.purchases pu ON pu.id = pi.purchase_id JOIN ${s}.products pp ON pp.id = pi.product_id
        WHERE pu.purchased_at >= ${p(from)} AND pu.purchased_at <= ${p(to)} GROUP BY 1) bought ON bought.product_id = p.id`,
    columns: {
      name: "p.name", sku: "p.sku", category: "p.category", brand: "p.brand", unit: "p.unit",
      price: "p.unit_price::float", cost: "p.unit_cost::float", marginPct: "(100 * (1 - p.unit_cost / nullif(p.unit_price, 0)))::float",
      stock: "p.stock", reorderLevel: "p.reorder_level",
      stockStatus: "CASE WHEN p.stock IS NULL THEN 'Unknown' WHEN p.stock <= 0 THEN 'Out of stock' WHEN p.stock <= coalesce(p.reorder_level, 0) THEN 'Low' ELSE 'In stock' END",
      stockValue: "(p.stock * p.unit_cost)::float", retailValue: "(p.stock * p.unit_price)::float",
      unitsSold: "coalesce(sold.units, 0)::int", revenue: "coalesce(sold.revenue, 0)::float",
      unitsBought: "coalesce(bought.units, 0)::int", purchaseCost: "coalesce(bought.cost, 0)::float",
    },
    where: (f, p) => [
      f.search && `(p.name ILIKE ${p(`%${f.search}%`)} OR p.sku ILIKE ${p(`%${f.search}%`)} OR p.description ILIKE ${p(`%${f.search}%`)})`,
      f.products.length && `upper(p.sku) = ANY(${p(f.products.map((x) => x.toUpperCase()))}::text[])`,
      f.categories.length && `lower(p.category) = ANY(${p(f.categories.map((x) => x.toLowerCase()))}::text[])`,
      f.stock === "out" && "coalesce(p.stock, 0) <= 0",
      f.stock === "low" && "p.stock <= coalesce(p.reorder_level, 0)",
    ],
  },
  customers: {
    from: (s, p, { from, to }) => `${s}.customers c
      LEFT JOIN (SELECT o.customer_id, count(DISTINCT o.id) AS orders, sum(${LINE}) AS revenue, max(o.ordered_at) AS last FROM ${s}.orders o
        JOIN ${s}.order_items li ON li.order_id = o.id WHERE o.status <> 'refunded' AND o.ordered_at >= ${p(from)} AND o.ordered_at <= ${p(to)} GROUP BY 1) a ON a.customer_id = c.id`,
    columns: {
      name: "c.name", segment: "c.segment", branch: "c.region", industry: "c.industry", email: "c.email", phone: "c.phone",
      orders: "coalesce(a.orders, 0)::int", revenue: "coalesce(a.revenue, 0)::float", lastOrder: day("a.last"),
    },
    where: (f, p) => [
      f.search && `(c.name ILIKE ${p(`%${f.search}%`)} OR c.email ILIKE ${p(`%${f.search}%`)})`,
      f.branches.length && `lower(c.region) = ANY(${p(f.branches.map((x) => x.toLowerCase()))}::text[])`,
      f.segments.length && `lower(c.segment) = ANY(${p(f.segments.map((x) => x.toLowerCase()))}::text[])`,
    ],
  },
  orders: {
    from: (s) => `${s}.orders o JOIN ${s}.customers c ON c.id = o.customer_id JOIN ${s}.reps r ON r.id = o.rep_id
      LEFT JOIN (SELECT li.order_id, sum(li.quantity) AS units, sum(${LINE}) AS total, string_agg(p.name || ' x' || li.quantity, ', ' ORDER BY p.name) AS items
        FROM ${s}.order_items li JOIN ${s}.products p ON p.id = li.product_id GROUP BY 1) t ON t.order_id = o.id`,
    columns: {
      number: "o.number", date: day("o.ordered_at"), customer: "c.name", branch: "c.region", staff: "r.name", channel: "o.channel",
      status: "o.status", items: "t.items", units: "coalesce(t.units, 0)::int", total: "coalesce(t.total, 0)::float",
    },
    sortSql: { date: "o.ordered_at" },
    where: (f, p, { from, to }, s) => [
      `o.ordered_at >= ${p(from)} AND o.ordered_at <= ${p(to)}`,
      f.search && `(o.number ILIKE ${p(`%${f.search}%`)} OR c.name ILIKE ${p(`%${f.search}%`)})`,
      f.statuses.length && `lower(o.status) = ANY(${p(f.statuses.map((x) => x.toLowerCase()))}::text[])`,
      f.branches.length && `lower(c.region) = ANY(${p(f.branches.map((x) => x.toLowerCase()))}::text[])`,
      f.segments.length && `lower(c.segment) = ANY(${p(f.segments.map((x) => x.toLowerCase()))}::text[])`,
      (f.products.length || f.categories.length) && `EXISTS (SELECT 1 FROM ${s}.order_items li2 JOIN ${s}.products p2 ON p2.id = li2.product_id WHERE li2.order_id = o.id
        AND (${f.products.length ? `upper(p2.sku) = ANY(${p(f.products.map((x) => x.toUpperCase()))}::text[])` : "true"})
        AND (${f.categories.length ? `lower(p2.category) = ANY(${p(f.categories.map((x) => x.toLowerCase()))}::text[])` : "true"}))`,
    ],
  },
  purchases: {
    from: (s) => `${s}.purchases pu
      LEFT JOIN (SELECT pi.purchase_id, sum(pi.quantity) AS units, string_agg(p.name || ' x' || pi.quantity, ', ' ORDER BY p.name) AS items
        FROM ${s}.purchase_items pi JOIN ${s}.products p ON p.id = pi.product_id GROUP BY 1) t ON t.purchase_id = pu.id`,
    columns: {
      number: "pu.number", date: day("pu.purchased_at"), supplier: "pu.supplier", items: "t.items", units: "coalesce(t.units, 0)::int", total: "pu.total::float",
    },
    sortSql: { date: "pu.purchased_at" },
    where: (f, p, { from, to }, s) => [
      `pu.purchased_at >= ${p(from)} AND pu.purchased_at <= ${p(to)}`,
      f.search && `(pu.supplier ILIKE ${p(`%${f.search}%`)} OR pu.number ILIKE ${p(`%${f.search}%`)})`,
      (f.products.length || f.categories.length) && `EXISTS (SELECT 1 FROM ${s}.purchase_items pi2 JOIN ${s}.products p2 ON p2.id = pi2.product_id WHERE pi2.purchase_id = pu.id
        AND (${f.products.length ? `upper(p2.sku) = ANY(${p(f.products.map((x) => x.toUpperCase()))}::text[])` : "true"})
        AND (${f.categories.length ? `lower(p2.category) = ANY(${p(f.categories.map((x) => x.toLowerCase()))}::text[])` : "true"}))`,
    ],
  },
  expenses: {
    from: (s) => `${s}.expenses e`,
    columns: { date: day("e.spent_at"), category: "e.category", payee: "e.payee", branch: "e.branch", description: "e.description", amount: "e.amount::float" },
    sortSql: { date: "e.spent_at" },
    where: (f, p, { from, to }) => [
      `e.spent_at >= ${p(from)} AND e.spent_at <= ${p(to)}`,
      f.search && `(e.description ILIKE ${p(`%${f.search}%`)} OR e.payee ILIKE ${p(`%${f.search}%`)})`,
      f.categories.length && `lower(e.category) = ANY(${p(f.categories.map((x) => x.toLowerCase()))}::text[])`,
      f.branches.length && `lower(e.branch) = ANY(${p(f.branches.map((x) => x.toLowerCase()))}::text[])`,
    ],
  },
  quotes: {
    from: (s) => `${s}.deals d JOIN ${s}.customers c ON c.id = d.customer_id JOIN ${s}.reps r ON r.id = d.rep_id`,
    columns: {
      name: "d.name", customer: "c.name", stage: "d.stage", amount: "d.amount::float", staff: "r.name",
      created: day("d.created_at"), expectedClose: day("d.expected_close"), closed: day("d.closed_at"),
    },
    sortSql: { created: "d.created_at", expectedClose: "d.expected_close", closed: "d.closed_at" },
    // Open quotes always show; won and lost ones only when they closed in the period.
    where: (f, p, { from }) => [
      `(d.closed_at IS NULL OR d.closed_at >= ${p(from)})`,
      f.search && `(d.name ILIKE ${p(`%${f.search}%`)} OR c.name ILIKE ${p(`%${f.search}%`)})`,
      f.statuses.length && `lower(d.stage) = ANY(${p(f.statuses.map((x) => x.toLowerCase()))}::text[])`,
      f.branches.length && `lower(c.region) = ANY(${p(f.branches.map((x) => x.toLowerCase()))}::text[])`,
    ],
  },
  staff: {
    from: (s, p, { from, to }) => `${s}.reps r
      LEFT JOIN (SELECT o.rep_id, count(DISTINCT o.id) AS orders, sum(${LINE}) AS revenue FROM ${s}.orders o JOIN ${s}.order_items li ON li.order_id = o.id
        WHERE o.status <> 'refunded' AND o.ordered_at >= ${p(from)} AND o.ordered_at <= ${p(to)} GROUP BY 1) a ON a.rep_id = r.id`,
    columns: {
      name: "r.name", branch: "r.region", target: "r.monthly_target::float", orders: "coalesce(a.orders, 0)::int", revenue: "coalesce(a.revenue, 0)::float",
    },
    perMonth: true, // targetPct needs the period length, added below
    where: (f, p) => [
      f.search && `r.name ILIKE ${p(`%${f.search}%`)}`,
      f.branches.length && `lower(r.region) = ANY(${p(f.branches.map((x) => x.toLowerCase()))}::text[])`,
    ],
  },
};

/** Plain labels for the filters, so the widget says exactly what it lists. */
function filterLabels(q, productNames) {
  const f = q.filters;
  const out = [];
  if (f.search) out.push(`Matching "${f.search}"`);
  out.push(...productNames.map((n) => `Product: ${n}`));
  for (const [list, label] of [[f.categories, "Category"], [f.branches, "Branch"], [f.segments, "Customer type"], [f.statuses, q.dataset === "quotes" ? "Stage" : "Status"]]) {
    for (const v of list) out.push(`${label}: ${v}`);
  }
  if (f.stock === "low") out.push("Low or out of stock");
  if (f.stock === "out") out.push("Out of stock");
  return out;
}

/**
 * Runs one list query.
 * @returns {{ dataset, label, columns: {key,label,unit}[], rows: object[], total, period: {from,to,months}, filters: string[] }}
 */
export async function runRecordsQuery(pool, input, { schema = DEFAULT_SCHEMA, now = new Date() } = {}) {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  const q = RecordsQuery.parse(input);
  const problems = recordsProblems(q);
  if (problems.length) throw new Error(problems.join(" "));
  const s = `"${schema}"`;
  const def = RECORD_DATASETS[q.dataset];
  const ds = DATASETS[q.dataset];
  const { from, to } = salesRange(now, q.months);
  const range = { from, to };

  const params = [];
  const p = (value) => { params.push(value); return `$${params.length}`; };
  const columnSql = { ...ds.columns };
  if (ds.perMonth) columnSql.targetPct = `(100 * coalesce(a.revenue, 0) / nullif(r.monthly_target * ${p(q.months)}::int, 0))::float`;
  const keys = q.columns.length ? q.columns : def.defaults;
  const sortKey = q.sortBy || def.sort;
  const fromSql = ds.from(s, p, range);
  const where = ds.where(q.filters, p, range, s).filter(Boolean);
  const sortSql = ds.sortSql?.[sortKey] ?? columnSql[sortKey];
  const dir = q.sortDir === "auto" ? (def.columns[sortKey].unit === "text" ? "ASC" : "DESC") : q.sortDir.toUpperCase();
  const sql = `SELECT ${keys.map((k) => `${columnSql[k]} AS "${k}"`).join(", ")}, count(*) OVER () AS "__total"
    FROM ${fromSql} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${sortSql} ${dir} NULLS LAST, 1 ASC LIMIT ${p(q.limit)}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = 5000");
    const { rows } = await client.query(sql, params);
    const names = q.filters.products.length
      ? (await client.query(`SELECT name FROM ${s}.products WHERE upper(sku) = ANY($1) ORDER BY name`, [q.filters.products.map((x) => x.toUpperCase())])).rows.map((r) => r.name)
      : [];
    await client.query("COMMIT");
    const total = rows.length ? Number(rows[0].__total) : 0;
    return {
      dataset: q.dataset, label: def.label,
      columns: keys.map((key) => ({ key, ...def.columns[key] })),
      rows: rows.map(({ __total, ...row }) => row),
      total,
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), months: q.months },
      filters: filterLabels(q, names),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
