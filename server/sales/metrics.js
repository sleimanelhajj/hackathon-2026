// Everything the Sales dashboard shows, computed from Postgres. No number is invented: each one is a SQL aggregate
// over the sales tables, and tests/server/sales-metrics.test.mjs recomputes them by hand.
//
// Definitions (shown in the UI as well):
// - Revenue: sum of quantity × unit price × (1 − discount) over order lines, refunded orders left out.
// - Period: this calendar month so far plus the (months − 1) months before it.
// - Previous period: the same calendar months one period earlier, up to the same day of the month.
// - Win rate: won ÷ (won + lost) for deals closed in the period. Open pipeline: every deal not yet won or lost.
import { DEFAULT_SCHEMA } from "./db.js";

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const OPEN_STAGES = ["lead", "qualified", "proposal", "negotiation"];

const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const monthStart = (now, back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const num = (v) => (v == null ? 0 : Number(v));
const pct = (a, b) => (b ? (a / b) * 100 : null);

export function salesRange(now, months) {
  const from = monthStart(now, months - 1);
  return { from, to: now, prevFrom: monthStart(now, 2 * months - 1), prevTo: addMonths(now, -months) };
}

export async function salesDashboard(pool, { schema = DEFAULT_SCHEMA, months = 12, now = new Date() } = {}) {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  months = Math.max(1, Math.min(24, Math.round(months)));
  const s = `"${schema}"`;
  const { from, to, prevFrom, prevTo } = salesRange(now, months);
  const period = [from, to];
  const line = "li.quantity * li.unit_price * (1 - li.discount_pct / 100)";

  // Per-order totals for both periods: the KPIs and the monthly buckets come from these.
  const ordersQ = pool.query(
    `SELECT o.id, o.ordered_at, sum(${line})::float AS revenue, sum(li.quantity * p.unit_cost)::float AS cost
       FROM ${s}.orders o JOIN ${s}.order_items li ON li.order_id = o.id JOIN ${s}.products p ON p.id = li.product_id
      WHERE o.status <> 'refunded' AND ((o.ordered_at >= $1 AND o.ordered_at <= $2) OR (o.ordered_at >= $3 AND o.ordered_at < $4))
      GROUP BY o.id`,
    [from, to, prevFrom, prevTo]
  );
  const customersQ = pool.query(
    `SELECT count(*) FILTER (WHERE created_at >= $1 AND created_at <= $2)::int AS cur,
            count(*) FILTER (WHERE created_at >= $3 AND created_at < $4)::int AS prev FROM ${s}.customers`,
    [from, to, prevFrom, prevTo]
  );
  const dealsQ = pool.query(
    `SELECT count(*) FILTER (WHERE stage = 'won' AND closed_at >= $1 AND closed_at <= $2)::int AS won,
            count(*) FILTER (WHERE stage = 'lost' AND closed_at >= $1 AND closed_at <= $2)::int AS lost,
            count(*) FILTER (WHERE stage = 'won' AND closed_at >= $3 AND closed_at < $4)::int AS won_prev,
            count(*) FILTER (WHERE stage = 'lost' AND closed_at >= $3 AND closed_at < $4)::int AS lost_prev,
            coalesce(sum(amount) FILTER (WHERE stage = ANY($5)), 0)::float AS open_value,
            count(*) FILTER (WHERE stage = ANY($5))::int AS open_count
       FROM ${s}.deals`,
    [from, to, prevFrom, prevTo, OPEN_STAGES]
  );
  const linesInPeriod = `FROM ${s}.orders o JOIN ${s}.order_items li ON li.order_id = o.id JOIN ${s}.products p ON p.id = li.product_id
      JOIN ${s}.customers c ON c.id = o.customer_id WHERE o.status <> 'refunded' AND o.ordered_at >= $1 AND o.ordered_at <= $2`;
  const categoryQ = pool.query(`SELECT p.category AS key, sum(${line})::float AS revenue ${linesInPeriod} GROUP BY 1 ORDER BY 2 DESC`, period);
  const regionQ = pool.query(`SELECT c.region AS key, sum(${line})::float AS revenue ${linesInPeriod} GROUP BY 1 ORDER BY 2 DESC`, period);
  const productsQ = pool.query(
    `SELECT p.name, p.category, sum(${line})::float AS revenue, sum(li.quantity)::int AS units ${linesInPeriod}
      GROUP BY p.id ORDER BY revenue DESC LIMIT 10`, period);
  const topCustomersQ = pool.query(
    `SELECT c.name, c.industry, c.region, sum(${line})::float AS revenue, count(DISTINCT o.id)::int AS orders ${linesInPeriod}
      GROUP BY c.id ORDER BY revenue DESC LIMIT 10`, period);
  const repsQ = pool.query(
    `SELECT r.id, r.name, r.region, r.monthly_target::float AS monthly_target,
            coalesce((SELECT sum(${line}) FROM ${s}.orders o JOIN ${s}.order_items li ON li.order_id = o.id
                       WHERE o.rep_id = r.id AND o.status <> 'refunded' AND o.ordered_at >= $1 AND o.ordered_at <= $2), 0)::float AS revenue,
            (SELECT count(*) FROM ${s}.deals d WHERE d.rep_id = r.id AND d.stage = 'won' AND d.closed_at >= $1 AND d.closed_at <= $2)::int AS won
       FROM ${s}.reps r ORDER BY revenue DESC`, period);
  const pipelineQ = pool.query(
    `SELECT stage, count(*)::int AS count, sum(amount)::float AS value FROM ${s}.deals
      WHERE stage = ANY($3) OR (closed_at >= $1 AND closed_at <= $2) GROUP BY stage`, [from, to, OPEN_STAGES]);
  const recentQ = pool.query(
    `SELECT o.number, c.name AS customer, o.status, o.ordered_at, o.channel, sum(${line})::float AS total
       FROM ${s}.orders o JOIN ${s}.order_items li ON li.order_id = o.id JOIN ${s}.customers c ON c.id = o.customer_id
      GROUP BY o.id, c.name ORDER BY o.ordered_at DESC LIMIT 10`);

  // Supplier invoices (decision #58): what was bought in each period.
  const purchasesQ = pool.query(
    `SELECT coalesce(sum(total) FILTER (WHERE purchased_at >= $1 AND purchased_at <= $2), 0)::float AS cur,
            coalesce(sum(total) FILTER (WHERE purchased_at >= $3 AND purchased_at < $4), 0)::float AS prev,
            count(*) FILTER (WHERE purchased_at >= $1 AND purchased_at <= $2)::int AS n FROM ${s}.purchases`,
    [from, to, prevFrom, prevTo]
  );

  const [orders, customers, deals, category, region, products, topCustomers, reps, pipeline, recent, purchases] = await Promise.all([
    ordersQ, customersQ, dealsQ, categoryQ, regionQ, productsQ, topCustomersQ, repsQ, pipelineQ, recentQ, purchasesQ,
  ]);

  // ---- KPIs ----
  const cur = orders.rows.filter((o) => o.ordered_at >= from);
  const prev = orders.rows.filter((o) => o.ordered_at < from);
  const total = (list, key) => list.reduce((sum, o) => sum + o[key], 0);
  const revenue = total(cur, "revenue"), revenuePrev = total(prev, "revenue");
  const cost = total(cur, "cost"), costPrev = total(prev, "cost");
  const d = deals.rows[0];

  // ---- monthly buckets: month i of this period beside month i of the previous one ----
  const monthly = Array.from({ length: months }, (_, i) => {
    const start = addMonths(from, i);
    return { month: ym(start), start, end: i === months - 1 ? to : addMonths(from, i + 1), revenue: 0, revenueLastYear: 0, orders: 0 };
  });
  const bucketOf = (date, base) => {
    const i = (date.getUTCFullYear() - base.getUTCFullYear()) * 12 + date.getUTCMonth() - base.getUTCMonth();
    return monthly[Math.max(0, Math.min(months - 1, i))];
  };
  for (const o of cur) { const b = bucketOf(o.ordered_at, from); b.revenue += o.revenue; b.orders += 1; }
  for (const o of prev) bucketOf(o.ordered_at, prevFrom).revenueLastYear += o.revenue;

  const share = (rows) => rows.map((r) => ({ key: r.key, revenue: r.revenue, share: pct(r.revenue, revenue) ?? 0 }));
  const byStage = Object.fromEntries(pipeline.rows.map((r) => [r.stage, r]));

  return {
    sample: true, // demo data from server/sales/seed.js; the UI labels it as such
    range: { from: from.toISOString(), to: to.toISOString(), months, prevFrom: prevFrom.toISOString(), prevTo: prevTo.toISOString() },
    kpis: {
      revenue, revenuePrev,
      orders: cur.length, ordersPrev: prev.length,
      aov: cur.length ? revenue / cur.length : 0, aovPrev: prev.length ? revenuePrev / prev.length : 0,
      marginPct: pct(revenue - cost, revenue) ?? 0, marginPctPrev: pct(revenuePrev - costPrev, revenuePrev) ?? 0,
      newCustomers: customers.rows[0].cur, newCustomersPrev: customers.rows[0].prev,
      winRate: pct(d.won, d.won + d.lost) ?? 0, winRatePrev: pct(d.won_prev, d.won_prev + d.lost_prev) ?? 0,
      openPipeline: d.open_value, openDeals: d.open_count,
      purchases: purchases.rows[0].cur, purchasesPrev: purchases.rows[0].prev, purchaseCount: purchases.rows[0].n,
    },
    monthly: monthly.map(({ month, revenue, revenueLastYear, orders }) => ({ month, revenue, revenueLastYear, orders })),
    byCategory: share(category.rows),
    byRegion: share(region.rows),
    topProducts: products.rows.map((r) => ({ name: r.name, category: r.category, revenue: r.revenue, units: r.units })),
    topCustomers: topCustomers.rows.map((r) => ({ name: r.name, industry: r.industry, region: r.region, revenue: r.revenue, orders: r.orders })),
    reps: reps.rows.map((r) => ({ name: r.name, region: r.region, revenue: r.revenue, target: r.monthly_target * months, attainment: pct(r.revenue, r.monthly_target * months) ?? 0, won: r.won })),
    pipeline: [...OPEN_STAGES, "won", "lost"].map((stage) => ({ stage, count: byStage[stage]?.count ?? 0, value: num(byStage[stage]?.value), open: OPEN_STAGES.includes(stage) })),
    recentOrders: recent.rows.map((r) => ({ number: r.number, customer: r.customer, status: r.status, channel: r.channel, orderedAt: r.ordered_at, total: r.total })),
  };
}
