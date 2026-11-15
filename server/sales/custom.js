// Data for custom sales widgets (made by the assistant's widget builder). The widget holds a typed query; this file is
// the only place it becomes SQL, and only by picking fixed fragments from the allow-lists below. Every value from the
// query is a bound parameter. Runs in a READ ONLY transaction with a statement timeout.
import { CustomQuery, TIME_GROUPS, customWidgetProblems } from "../../shared/spec.js";
import { DEFAULT_SCHEMA } from "./db.js";
import { salesRange } from "./metrics.js";

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const LINE = "li.quantity * li.unit_price * (1 - li.discount_pct / 100)";

const METRICS = {
  revenue: { sql: `sum(${LINE})`, unit: "USD" },
  orders: { sql: "count(DISTINCT o.id)", unit: "count" },
  units: { sql: "sum(li.quantity)", unit: "count" },
  aov: { sql: `sum(${LINE}) / nullif(count(DISTINCT o.id), 0)`, unit: "USD" },
  marginPct: { sql: `100 * (1 - sum(li.quantity * p.unit_cost) / nullif(sum(${LINE}), 0))`, unit: "percent" },
  customers: { sql: "count(DISTINCT o.customer_id)", unit: "count" },
  cost: { sql: "sum(li.quantity * p.unit_cost)", unit: "USD" },
  profit: { sql: `sum(${LINE}) - sum(li.quantity * p.unit_cost)`, unit: "USD" },
  // Supplier invoices (decision #58): a different table, see PURCHASE_SQL below.
  purchases: { sql: "sum(pi.quantity * coalesce(pi.unit_cost, p.unit_cost))", unit: "USD" },
  // Running costs (rent, salaries…) from the expenses table (decision #69).
  expenses: { sql: "sum(e.amount)", unit: "USD" },
};
const GROUPS = {
  none: "'Total'",
  month: "to_char(date_trunc('month', o.ordered_at AT TIME ZONE 'UTC'), 'YYYY-MM')",
  week: "to_char(date_trunc('week', o.ordered_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')",
  day: "to_char(o.ordered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')",
  category: "p.category", product: "p.name", branch: "c.region", staff: "r.name", channel: "o.channel", segment: "c.segment", customer: "c.name",
  supplier: "pu.supplier",
};
/** Purchases read supplier invoices instead of orders: the same fragments with the purchase date and tables. */
const forPurchases = (sql) => sql.replaceAll("o.ordered_at", "pu.purchased_at");
/** Expenses: their own date, category and branch. */
const forExpenses = (groupBy) => ({ category: "e.category", branch: "e.branch" }[groupBy] ?? GROUPS[groupBy].replaceAll("o.ordered_at", "e.spent_at"));

const round = (v, unit) => (v == null ? null : unit === "count" ? Math.round(Number(v)) : Math.round(Number(v) * 100) / 100);
const ymd = (d) => d.toISOString().slice(0, 10);

/** Every bucket key in the period, so a quiet month shows as zero instead of disappearing from the chart. */
function timeKeys(groupBy, from, to) {
  const keys = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  if (groupBy === "month") {
    d.setUTCDate(1);
    while (d <= to) { keys.push(ymd(d).slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  } else if (groupBy === "week") {
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday, like Postgres date_trunc('week')
    while (d <= to) { keys.push(ymd(d)); d.setUTCDate(d.getUTCDate() + 7); }
  } else {
    while (d <= to) { keys.push(ymd(d)); d.setUTCDate(d.getUTCDate() + 1); }
  }
  return keys;
}

/** The store's real filter values, so the widget builder only uses names that exist. */
export async function filterValues(pool, { schema = DEFAULT_SCHEMA } = {}) {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  const s = `"${schema}"`;
  const one = async (sql) => (await pool.query(sql)).rows.map((r) => r.v);
  const [categories, branches, segments, channels] = await Promise.all([
    one(`SELECT DISTINCT category AS v FROM ${s}.products ORDER BY 1`),
    one(`SELECT DISTINCT region AS v FROM ${s}.customers ORDER BY 1`),
    one(`SELECT DISTINCT segment AS v FROM ${s}.customers ORDER BY 1`),
    one(`SELECT DISTINCT channel AS v FROM ${s}.orders ORDER BY 1`),
  ]);
  return { categories, branches, segments, channels };
}

/**
 * Runs one custom widget query.
 * @returns {{ metric, groupBy, unit, period, rows: {key, value}[], total, previousTotal, filters: string[] }}
 */
export async function runCustomQuery(pool, input, { schema = DEFAULT_SCHEMA, now = new Date() } = {}) {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  const q = CustomQuery.parse(input);
  const s = `"${schema}"`;
  const { from, to, prevFrom, prevTo } = salesRange(now, q.months);
  const { sql: metricSql, unit } = METRICS[q.metric];
  const f = q.filters;
  const buying = q.metric === "purchases";
  const spending = q.metric === "expenses";
  const problems = customWidgetProblems({ chart: q.groupBy === "none" ? "number" : "table", query: q });
  if (problems.length) throw new Error(problems.join(" "));

  // Filters: $3.. are always bound; an empty list means "no filter".
  const params = [f.products.map((x) => x.toUpperCase()), f.categories.map((x) => x.toLowerCase()), f.branches.map((x) => x.toLowerCase()),
    f.segments.map((x) => x.toLowerCase()), f.channels.map((x) => x.toLowerCase()), f.customers];
  const where = `o.status <> 'refunded' AND o.ordered_at >= $1 AND o.ordered_at <= $2
    AND (cardinality($3::text[]) = 0 OR upper(p.sku) = ANY($3))
    AND (cardinality($4::text[]) = 0 OR lower(p.category) = ANY($4))
    AND (cardinality($5::text[]) = 0 OR lower(c.region) = ANY($5))
    AND (cardinality($6::text[]) = 0 OR lower(c.segment) = ANY($6))
    AND (cardinality($7::text[]) = 0 OR lower(o.channel) = ANY($7))
    AND (cardinality($8::int[]) = 0 OR c.id = ANY($8))`;
  const fromJoins = `FROM ${s}.orders o JOIN ${s}.order_items li ON li.order_id = o.id JOIN ${s}.products p ON p.id = li.product_id
    JOIN ${s}.customers c ON c.id = o.customer_id JOIN ${s}.reps r ON r.id = o.rep_id`;
  const time = TIME_GROUPS.includes(q.groupBy);
  const purchaseWhere = `pu.purchased_at >= $1 AND pu.purchased_at <= $2
    AND (cardinality($3::text[]) = 0 OR upper(p.sku) = ANY($3))
    AND (cardinality($4::text[]) = 0 OR lower(p.category) = ANY($4))
    AND cardinality($5::text[]) >= 0 AND cardinality($6::text[]) >= 0 AND cardinality($7::text[]) >= 0 AND cardinality($8::int[]) >= 0`;
  const purchaseJoins = `FROM ${s}.purchases pu JOIN ${s}.purchase_items pi ON pi.purchase_id = pu.id JOIN ${s}.products p ON p.id = pi.product_id`;
  const expenseWhere = `e.spent_at >= $1 AND e.spent_at <= $2
    AND cardinality($3::text[]) >= 0
    AND (cardinality($4::text[]) = 0 OR lower(e.category) = ANY($4))
    AND (cardinality($5::text[]) = 0 OR lower(e.branch) = ANY($5))
    AND cardinality($6::text[]) >= 0 AND cardinality($7::text[]) >= 0 AND cardinality($8::int[]) >= 0`;
  const W = buying ? purchaseWhere : spending ? expenseWhere : where;
  const FROM = buying ? purchaseJoins : spending ? `FROM ${s}.expenses e` : fromJoins;
  const G = buying ? forPurchases(GROUPS[q.groupBy]) : spending ? forExpenses(q.groupBy) : GROUPS[q.groupBy];

  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = 5000");
    const grouped = q.groupBy === "none" ? { rows: [] } : await client.query(
      `SELECT ${G} AS key, (${metricSql})::float AS value ${FROM} WHERE ${W}
        GROUP BY 1 ORDER BY ${time ? "1" : "2 DESC NULLS LAST"} ${time ? "" : "LIMIT $9"}`,
      time ? [from, to, ...params] : [from, to, ...params, q.limit]);
    const totals = await client.query(`SELECT (${metricSql})::float AS value ${FROM} WHERE ${W}`, [from, to, ...params]);
    const previous = await client.query(`SELECT (${metricSql})::float AS value ${FROM} WHERE ${W.replace("o.ordered_at <= $2", "o.ordered_at < $2").replace("pu.purchased_at <= $2", "pu.purchased_at < $2").replace("e.spent_at <= $2", "e.spent_at < $2")}`, [prevFrom, prevTo, ...params]);
    // Labels for the filters, so the widget can say exactly what it counts.
    const labels = [];
    if (f.products.length) {
      const { rows } = await client.query(`SELECT name FROM ${s}.products WHERE upper(sku) = ANY($1) ORDER BY name`, [params[0]]);
      labels.push(...rows.map((r) => `Product: ${r.name}`));
    }
    if (f.customers.length) {
      const { rows } = await client.query(`SELECT name FROM ${s}.customers WHERE id = ANY($1) ORDER BY name`, [f.customers]);
      labels.push(...rows.map((r) => `Customer: ${r.name}`));
    }
    for (const [list, label] of [[f.categories, "Category"], [f.branches, "Branch"], [f.segments, "Customer type"], [f.channels, "Channel"]]) {
      for (const v of list) labels.push(`${label}: ${v}`);
    }
    await client.query("COMMIT");

    let rows = grouped.rows.map((r) => ({ key: String(r.key), value: round(r.value, unit) ?? 0 }));
    if (time) {
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      const zero = q.metric === "aov" || q.metric === "marginPct" ? null : 0; // an average of nothing isn't zero
      rows = timeKeys(q.groupBy, from, to).map((key) => ({ key, value: byKey.get(key) ?? zero }));
    }
    return {
      metric: q.metric, groupBy: q.groupBy, unit, period: { from: ymd(from), to: ymd(to), months: q.months },
      rows, total: round(totals.rows[0]?.value, unit) ?? 0, previousTotal: round(previous.rows[0]?.value, unit), filters: labels,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
