// The assistant's tools over the Postgres sales database (the solar shop). Read-only and bounded:
// - every query is a fixed, parameterized statement; the model picks a tool and fills typed arguments, never SQL;
// - each call runs in a READ ONLY transaction with a statement timeout;
// - results are capped (rows, text length) before they reach the model.
// The one tool that leads to something new, propose_invoice, only *prepares* a draft. Prices, account discounts, tax,
// due date and totals all come from the database and from invoice.js. Nothing is created until the user confirms.
import { z } from "zod";
import { DEFAULT_SCHEMA } from "../sales/db.js";
import { salesDashboard, salesRange } from "../sales/metrics.js";
import { prepareInvoice } from "./invoice.js";
import { runCustomQuery } from "../sales/custom.js";
import { CustomGroupBy, CustomMetric } from "../../shared/spec.js";

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const LINE = "li.quantity * li.unit_price * (1 - li.discount_pct / 100)";
/** Account discounts by customer segment (the same rule the seed uses for trade orders). */
export const ACCOUNT_DISCOUNT_PCT = { "Retail customer": 0, "Trade account": 5, "Commercial account": 10 };
const BREAKDOWNS = {
  category: "p.category", product: "p.name", customer: "c.name", branch: "c.region", staff: "r.name",
  month: "to_char(date_trunc('month', o.ordered_at), 'YYYY-MM')", channel: "o.channel", segment: "c.segment",
};
const STOP = new Set(["a", "an", "the", "for", "to", "of", "and", "or", "in", "on", "my", "i", "need", "want", "with", "under", "some", "what", "is", "it", "do", "best", "good", "me", "fix", "how"]);

const num = (v) => (v == null ? null : Number(v));
const money = (v) => Math.round(Number(v ?? 0) * 100) / 100;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const addDays = (date, days) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const words = (q) => [...new Set(String(q ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [])]
  .filter((w) => w.length > 1 && !STOP.has(w)).slice(0, 8)
  .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)); // "pipes" finds "pipe"

// ---- argument schemas (validated before any query runs) ----
const Months = z.coerce.number().int().min(1).max(24).default(3);
const Args = {
  sales_summary: z.object({ months: Months }),
  sales_breakdown: z.object({ by: z.enum(Object.keys(BREAKDOWNS)), months: Months, limit: z.coerce.number().int().min(1).max(50).default(10) }),
  find_products: z.object({
    query: z.string().trim().max(200).default(""), category: z.string().trim().max(60).optional(),
    maxPrice: z.coerce.number().positive().max(100000).optional(), inStockOnly: z.boolean().default(false),
    limit: z.coerce.number().int().min(1).max(15).default(8),
  }),
  find_customers: z.object({ query: z.string().trim().min(1).max(120), limit: z.coerce.number().int().min(1).max(10).default(5) }),
  customer_history: z.object({ customerId: z.coerce.number().int().positive() }),
  low_stock: z.object({ limit: z.coerce.number().int().min(1).max(30).default(15) }),
  lapsed_customers: z.object({ days: z.coerce.number().int().min(14).max(365).default(60), limit: z.coerce.number().int().min(1).max(20).default(10) }),
  store_profile: z.object({}),
  sales_figures: z.object({
    metric: CustomMetric, groupBy: CustomGroupBy.default("none"),
    months: z.coerce.number().int().min(1).max(24).default(12), limit: z.coerce.number().int().min(1).max(20).default(10),
    products: z.array(z.string()).max(10).default([]), categories: z.array(z.string()).max(10).default([]),
    branches: z.array(z.string()).max(10).default([]), segments: z.array(z.string()).max(10).default([]),
    channels: z.array(z.string()).max(10).default([]), customers: z.array(z.coerce.number().int()).max(10).default([]),
  }),
  staff_performance: z.object({ months: Months }),
  quote_pipeline: z.object({ limit: z.coerce.number().int().min(1).max(15).default(8) }),
};
const InvoiceArgs = z.object({
  customerId: z.coerce.number().int().positive(),
  items: z.array(z.object({ sku: z.string().trim().min(1).max(40), quantity: z.coerce.number().int().min(1).max(10000) })).min(1).max(20),
  notes: z.string().trim().max(500).nullish(),
});

/** Gemini functionDeclarations (OpenAPI subset, uppercase types). Descriptions are what the model reads. */
export const TOOL_DECLARATIONS = [
  { name: "sales_summary", description: "Headline sales numbers. Periods are calendar months: months=1 is this month so far, compared with last month up to the same day; months=3 is this month plus the two before, compared with the three months before that. Returns revenue, orders, average order, gross margin, % change vs the previous period, top categories, branches and products.",
    parameters: { type: "OBJECT", properties: { months: { type: "INTEGER", description: "1-24, default 3" } } } },
  { name: "sales_breakdown", description: "Revenue, orders, units and gross margin over the last N months, grouped by one dimension: category, product, customer, branch, staff, month, channel or segment, with the previous period's revenue and the % change per row (use it for 'what grew or fell most'). Same periods as sales_summary. Sorted by revenue (month rows are sorted by date and have no comparison).",
    parameters: { type: "OBJECT", properties: { by: { type: "STRING", enum: Object.keys(BREAKDOWNS) }, months: { type: "INTEGER" }, limit: { type: "INTEGER", description: "1-50, default 10" } }, required: ["by"] } },
  { name: "find_products", description: "Search the store's catalogue by a need or situation (e.g. 'power cuts at night', 'replace my generator', 'irrigate a farm') or by name. Returns matching products with SKU, price, stock, description, what they're used for and recent popularity. Use it before recommending anything.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, category: { type: "STRING", description: "Optional exact category name" }, maxPrice: { type: "NUMBER", description: "Optional budget per item in USD" }, inStockOnly: { type: "BOOLEAN" }, limit: { type: "INTEGER" } } } },
  { name: "find_customers", description: "Find customers by part of their name, email or phone. Returns id, segment (Retail customer, Trade account, Commercial account), contact details, branch, lifetime spend and last order date.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, limit: { type: "INTEGER" } }, required: ["query"] } },
  { name: "customer_history", description: "One customer's details, recent orders with their lines, and the products they buy most.",
    parameters: { type: "OBJECT", properties: { customerId: { type: "INTEGER" } }, required: ["customerId"] } },
  { name: "lapsed_customers", description: "Customers who stopped ordering: regulars (3+ orders) with no order in the last N days (default 60), biggest past spenders first, with their last order date, how many orders they placed and what they spent. Use it for 'who stopped buying', 'lost customers' or 'who should we call'.",
    parameters: { type: "OBJECT", properties: { days: { type: "INTEGER", description: "14-365, default 60" }, limit: { type: "INTEGER" } } } },
  { name: "sales_figures", description: "Answer any sales question with one measure grouped one way, optionally filtered: e.g. units of a product by month (seasons, trends), revenue by branch for one category, orders by customer for one product. Same periods as sales_summary. Get product SKUs from find_products and customer ids from find_customers first. Returns every bucket (months with no sales show 0), the total and the previous-period total.",
    parameters: { type: "OBJECT", properties: {
      metric: { type: "STRING", enum: CustomMetric.options }, groupBy: { type: "STRING", enum: CustomGroupBy.options },
      months: { type: "INTEGER", description: "1-24, default 12" }, limit: { type: "INTEGER", description: "for non-time groupings, 1-20" },
      products: { type: "ARRAY", items: { type: "STRING" }, description: "product SKUs" }, categories: { type: "ARRAY", items: { type: "STRING" } },
      branches: { type: "ARRAY", items: { type: "STRING" } }, segments: { type: "ARRAY", items: { type: "STRING" } },
      channels: { type: "ARRAY", items: { type: "STRING" } }, customers: { type: "ARRAY", items: { type: "INTEGER" }, description: "customer ids" },
    }, required: ["metric"] } },
  { name: "low_stock", description: "Products at or below their reorder level, with stock, reorder level and how many sold in the last 30 days.",
    parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" } } } },
  { name: "store_profile", description: "The store's own details used on invoices: name, contact, address, currency, sales tax rate and payment terms, plus the account discount per customer segment.",
    parameters: { type: "OBJECT", properties: {} } },
  { name: "staff_performance", description: "Each staff member's revenue over the last N months against their monthly target, with their branch.",
    parameters: { type: "OBJECT", properties: { months: { type: "INTEGER" } } } },
  { name: "quote_pipeline", description: "Open trade quotes (not yet won or lost): totals by stage and the largest open quotes.",
    parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" } } } },
  { name: "propose_invoice", description: "Prepare an invoice draft for the user to review. Call it only after the user has told you the customer and every product with its quantity, and you have looked up the customer id and each SKU. Prices, account discount, tax, due date and totals are filled in by the system from the database. The user then confirms or changes it in the app; you cannot create the PDF yourself.",
    parameters: { type: "OBJECT", properties: {
      customerId: { type: "INTEGER" },
      items: { type: "ARRAY", items: { type: "OBJECT", properties: { sku: { type: "STRING" }, quantity: { type: "INTEGER" } }, required: ["sku", "quantity"] } },
      notes: { type: "STRING", description: "Optional note printed on the invoice, e.g. a job or PO reference the user gave" },
    }, required: ["customerId", "items"] } },
];

export function createSalesTools({ pool, schema = DEFAULT_SCHEMA, now = () => new Date() }) {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  const s = `"${schema}"`;

  /** Runs fn(client) inside a READ ONLY transaction with a 5 s statement timeout. */
  async function readOnly(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = 5000");
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

  async function profile(client) {
    const { rows: [p] } = await client.query(`SELECT name, email, phone, address, currency, tax_rate_bps, payment_terms_days FROM ${s}.store_profile WHERE id = 1`);
    if (!p) throw new Error("The store profile is missing. Load the sales records on the Sales page.");
    return { name: p.name, email: p.email, phone: p.phone, address: p.address, currency: p.currency, taxRateBps: p.tax_rate_bps, paymentTermsDays: p.payment_terms_days };
  }

  const handlers = {
    async sales_summary({ months }) {
      const d = await salesDashboard(pool, { schema, months, now: now() });
      const k = d.kpis;
      const change = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
      const round1 = (v) => Math.round(v * 10) / 10;
      const shares = (rows) => rows.slice(0, 10).map((r) => ({ key: r.key, revenue: money(r.revenue), sharePct: round1(r.share) }));
      return {
        period: { from: iso(d.range.from), to: iso(d.range.to), months }, previousPeriod: { from: iso(d.range.prevFrom), to: iso(d.range.prevTo) }, currency: "USD",
        revenue: money(k.revenue), previousRevenue: money(k.revenuePrev), revenueChangePct: change(k.revenue, k.revenuePrev),
        orders: k.orders, ordersChangePct: change(k.orders, k.ordersPrev), averageOrder: money(k.aov), grossMarginPct: round1(k.marginPct),
        newCustomers: k.newCustomers, quoteWinRatePct: round1(k.winRate), openQuotesValue: money(k.openPipeline), openQuotes: k.openDeals,
        byCategory: shares(d.byCategory), byBranch: shares(d.byRegion),
        topProducts: d.topProducts.slice(0, 5).map((p) => ({ name: p.name, revenue: money(p.revenue), units: p.units })),
      };
    },

    async sales_breakdown({ by, months, limit }) {
      const { from, to, prevFrom, prevTo } = salesRange(now(), months);
      const key = BREAKDOWNS[by];
      const cur = "o.ordered_at >= $1 AND o.ordered_at <= $2";
      const order = by === "month" ? "1" : "revenue DESC";
      // Months are rows of their own, so a previous-period comparison only makes sense for the other dimensions.
      const { rows } = await readOnly((c) => c.query(
        `SELECT ${key} AS key,
                coalesce(sum(${LINE}) FILTER (WHERE ${cur}), 0)::float AS revenue,
                coalesce(sum(${LINE}) FILTER (WHERE o.ordered_at >= $3 AND o.ordered_at < $4), 0)::float AS prev_revenue,
                count(DISTINCT o.id) FILTER (WHERE ${cur})::int AS orders, coalesce(sum(li.quantity) FILTER (WHERE ${cur}), 0)::int AS units,
                (100 * (1 - sum(li.quantity * p.unit_cost) FILTER (WHERE ${cur}) / nullif(sum(${LINE}) FILTER (WHERE ${cur}), 0)))::float AS margin_pct
           FROM ${s}.orders o JOIN ${s}.order_items li ON li.order_id = o.id JOIN ${s}.products p ON p.id = li.product_id
           JOIN ${s}.customers c ON c.id = o.customer_id JOIN ${s}.reps r ON r.id = o.rep_id
          WHERE o.status <> 'refunded' AND ((${cur}) OR (o.ordered_at >= $3 AND o.ordered_at < $4))
          GROUP BY 1 ORDER BY ${order} LIMIT $5`, [from, to, prevFrom, prevTo, by === "month" ? limit * 3 : limit]));
      const change = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
      const shown = by === "month" ? rows.filter((r) => r.revenue > 0).slice(-limit) : rows;
      return {
        by, period: { from: iso(from), to: iso(to), months }, previousPeriod: { from: iso(prevFrom), to: iso(prevTo) }, currency: "USD",
        rows: shown.map((r) => ({
          key: r.key, revenue: money(r.revenue), orders: r.orders, units: r.units, marginPct: r.margin_pct == null ? null : Math.round(r.margin_pct * 10) / 10,
          ...(by === "month" ? {} : { previousRevenue: money(r.prev_revenue), changePct: change(money(r.revenue), money(r.prev_revenue)) }),
        })),
      };
    },

    async find_products({ query, category, maxPrice, inStockOnly, limit }) {
      const terms = words(query);
      const { rows } = await readOnly((c) => c.query(
        `WITH sold AS (
           SELECT li.product_id, sum(li.quantity)::int AS units FROM ${s}.order_items li JOIN ${s}.orders o ON o.id = li.order_id
            WHERE o.status <> 'refunded' AND o.ordered_at >= $5::timestamptz - interval '90 days' GROUP BY 1)
         SELECT p.sku, p.name, p.category, p.brand, p.unit, p.unit_price, p.stock, p.reorder_level, p.description, p.uses,
                coalesce(sold.units, 0) AS units_90d,
                (SELECT count(*) FROM unnest($1::text[]) w
                  WHERE lower(p.name || ' ' || p.category || ' ' || coalesce(p.uses, '') || ' ' || coalesce(p.description, '')) LIKE '%' || w || '%')::int AS score,
                (SELECT count(*) FROM unnest($1::text[]) w WHERE lower(p.name || ' ' || coalesce(p.uses, '')) LIKE '%' || w || '%')::int AS strong
           FROM ${s}.products p LEFT JOIN sold ON sold.product_id = p.id
          WHERE ($2::text IS NULL OR lower(p.category) = lower($2)) AND ($3::numeric IS NULL OR p.unit_price <= $3)
            AND (NOT $4 OR p.stock > 0)
          ORDER BY score DESC, strong DESC, units_90d DESC LIMIT 60`,
        [terms, category ?? null, maxPrice ?? null, inStockOnly, now()]));
      const matched = terms.length ? rows.filter((r) => r.score > 0) : rows;
      return {
        searchedFor: terms, currency: "USD",
        products: matched.slice(0, limit).map((r) => ({
          sku: r.sku, name: r.name, category: r.category, brand: r.brand, unit: r.unit, price: money(r.unit_price),
          stock: r.stock, lowStock: r.stock <= r.reorder_level, soldLast90Days: r.units_90d,
          description: String(r.description ?? "").slice(0, 300), uses: String(r.uses ?? "").split(/,\s*/).filter(Boolean),
        })),
      };
    },

    async find_customers({ query, limit }) {
      const { rows } = await readOnly((c) => c.query(
        `SELECT c.id, c.name, c.segment, c.industry, c.email, c.phone, c.address, c.region,
                coalesce(sum(${LINE}) FILTER (WHERE o.status <> 'refunded'), 0)::float AS lifetime, max(o.ordered_at) AS last_order
           FROM ${s}.customers c LEFT JOIN ${s}.orders o ON o.customer_id = c.id LEFT JOIN ${s}.order_items li ON li.order_id = o.id
          WHERE c.name ILIKE '%' || $1 || '%' OR c.email ILIKE '%' || $1 || '%' OR c.phone ILIKE '%' || $1 || '%'
          GROUP BY c.id ORDER BY lifetime DESC LIMIT $2`, [query.replace(/[%_\\]/g, ""), limit]));
      return { customers: rows.map((r) => ({ id: r.id, name: r.name, segment: r.segment, industry: r.industry, email: r.email, phone: r.phone, address: r.address,
        branch: r.region, accountDiscountPct: ACCOUNT_DISCOUNT_PCT[r.segment] ?? 0, lifetimeSpend: money(r.lifetime), lastOrder: iso(r.last_order) })) };
    },

    async customer_history({ customerId }) {
      return readOnly(async (c) => {
        const { rows: [cu] } = await c.query(`SELECT id, name, segment, industry, email, phone, address, region, created_at FROM ${s}.customers WHERE id = $1`, [customerId]);
        if (!cu) throw new Error(`No customer with id ${customerId}.`);
        const { rows: orders } = await c.query(
          `SELECT o.number, o.ordered_at, o.status, o.channel, sum(${LINE})::float AS total,
                  json_agg(json_build_object('product', p.name, 'sku', p.sku, 'quantity', li.quantity) ORDER BY p.name) AS lines
             FROM ${s}.orders o JOIN ${s}.order_items li ON li.order_id = o.id JOIN ${s}.products p ON p.id = li.product_id
            WHERE o.customer_id = $1 GROUP BY o.id ORDER BY o.ordered_at DESC LIMIT 8`, [customerId]);
        const { rows: top } = await c.query(
          `SELECT p.name, p.sku, sum(li.quantity)::int AS units, sum(${LINE})::float AS revenue
             FROM ${s}.orders o JOIN ${s}.order_items li ON li.order_id = o.id JOIN ${s}.products p ON p.id = li.product_id
            WHERE o.customer_id = $1 AND o.status <> 'refunded' GROUP BY p.id ORDER BY revenue DESC LIMIT 5`, [customerId]);
        return {
          customer: { id: cu.id, name: cu.name, segment: cu.segment, industry: cu.industry, email: cu.email, phone: cu.phone, address: cu.address, branch: cu.region,
            customerSince: iso(cu.created_at), accountDiscountPct: ACCOUNT_DISCOUNT_PCT[cu.segment] ?? 0 },
          currency: "USD",
          recentOrders: orders.map((o) => ({ number: o.number, date: iso(o.ordered_at), status: o.status, channel: o.channel, total: money(o.total), lines: o.lines.slice(0, 8) })),
          topProducts: top.map((t) => ({ name: t.name, sku: t.sku, units: t.units, revenue: money(t.revenue) })),
        };
      });
    },

    async sales_figures({ metric, groupBy, months, limit, ...filters }) {
      // The custom-widget engine: fixed, parameterized, READ ONLY SQL picked from allow-lists.
      return runCustomQuery(pool, { metric, groupBy, months, limit, filters }, { schema, now: now() });
    },

    async low_stock({ limit }) {
      const { rows } = await readOnly((c) => c.query(
        `SELECT p.sku, p.name, p.category, p.stock, p.reorder_level,
                coalesce((SELECT sum(li.quantity) FROM ${s}.order_items li JOIN ${s}.orders o ON o.id = li.order_id
                           WHERE li.product_id = p.id AND o.ordered_at >= $2::timestamptz - interval '30 days'), 0)::int AS sold_30d
           FROM ${s}.products p WHERE p.stock <= p.reorder_level ORDER BY p.stock::float / greatest(p.reorder_level, 1), sold_30d DESC LIMIT $1`, [limit, now()]));
      return { products: rows.map((r) => ({ sku: r.sku, name: r.name, category: r.category, stock: r.stock, reorderLevel: r.reorder_level, soldLast30Days: r.sold_30d })) };
    },

    async lapsed_customers({ days, limit }) {
      const { rows } = await readOnly((c) => c.query(
        `SELECT c.id, c.name, c.segment, c.region, c.phone, count(DISTINCT o.id)::int AS orders, max(o.ordered_at) AS last_order, sum(${LINE})::float AS spent
           FROM ${s}.customers c JOIN ${s}.orders o ON o.customer_id = c.id JOIN ${s}.order_items li ON li.order_id = o.id
          WHERE o.status <> 'refunded'
          GROUP BY c.id HAVING count(DISTINCT o.id) >= 3 AND max(o.ordered_at) < $1::timestamptz - make_interval(days => $2)
          ORDER BY spent DESC LIMIT $3`, [now(), days, limit]));
      return { sinceDays: days, currency: "USD", customers: rows.map((r) => ({
        id: r.id, name: r.name, segment: r.segment, branch: r.region, phone: r.phone, orders: r.orders, lastOrder: iso(r.last_order),
        daysSinceLastOrder: Math.floor((now().getTime() - new Date(r.last_order).getTime()) / 864e5), spentBefore: money(r.spent) })) };
    },

    async store_profile() {
      return { ...(await readOnly(profile)), accountDiscountPctBySegment: ACCOUNT_DISCOUNT_PCT };
    },

    async staff_performance({ months }) {
      const { from, to } = salesRange(now(), months);
      const { rows } = await readOnly((c) => c.query(
        `SELECT r.name, r.region, r.monthly_target::float AS target, coalesce(sum(${LINE}), 0)::float AS revenue
           FROM ${s}.reps r LEFT JOIN ${s}.orders o ON o.rep_id = r.id AND o.status <> 'refunded' AND o.ordered_at >= $1 AND o.ordered_at <= $2
           LEFT JOIN ${s}.order_items li ON li.order_id = o.id GROUP BY r.id ORDER BY revenue DESC`, [from, to]));
      return { period: { from: iso(from), to: iso(to), months }, currency: "USD",
        staff: rows.map((r) => ({ name: r.name, branch: r.region, revenue: money(r.revenue), targetForPeriod: money(r.target * months), attainmentPct: r.target ? Math.round((r.revenue / (r.target * months)) * 1000) / 10 : null })) };
    },

    async quote_pipeline({ limit }) {
      return readOnly(async (c) => {
        const { rows: stages } = await c.query(`SELECT stage, count(*)::int AS quotes, sum(amount)::float AS value FROM ${s}.deals WHERE stage NOT IN ('won', 'lost') GROUP BY 1 ORDER BY 3 DESC`);
        const { rows: top } = await c.query(
          `SELECT d.name, d.stage, d.amount::float AS amount, d.expected_close, c.name AS customer FROM ${s}.deals d JOIN ${s}.customers c ON c.id = d.customer_id
            WHERE d.stage NOT IN ('won', 'lost') ORDER BY d.amount DESC LIMIT $1`, [limit]);
        return { currency: "USD", byStage: stages.map((x) => ({ stage: x.stage, quotes: x.quotes, value: money(x.value) })),
          largest: top.map((d) => ({ quote: d.name, customer: d.customer, stage: d.stage, value: money(d.amount), expectedClose: iso(d.expected_close) })) };
      });
    },
  };

  /** Builds an invoice draft from database facts only. Throws a plain-language error when something is unknown. */
  async function draftInvoice(input) {
    const { customerId, items, notes } = InvoiceArgs.parse(input);
    const skus = [...new Set(items.map((i) => i.sku.toUpperCase()))];
    if (skus.length !== items.length) throw new Error("Each product should appear once on the invoice; combine the quantities.");
    return readOnly(async (c) => {
      const store = await profile(c);
      const { rows: [cu] } = await c.query(`SELECT id, name, segment, email, address FROM ${s}.customers WHERE id = $1`, [customerId]);
      if (!cu) throw new Error(`No customer with id ${customerId}. Look the customer up first.`);
      const { rows: products } = await c.query(`SELECT sku, name, unit, unit_price, stock FROM ${s}.products WHERE upper(sku) = ANY($1)`, [skus]);
      const bySku = new Map(products.map((p) => [p.sku.toUpperCase(), p]));
      const missing = skus.filter((k) => !bySku.has(k));
      if (missing.length) throw new Error(`Unknown product SKU: ${missing.join(", ")}. Search the catalogue first.`);
      const discount = ACCOUNT_DISCOUNT_PCT[cu.segment] ?? 0;
      const warnings = [];
      const lineItems = items.map(({ sku, quantity }) => {
        const p = bySku.get(sku.toUpperCase());
        if (p.stock < quantity) warnings.push(`Only ${p.stock} of ${p.name} in stock (invoice asks for ${quantity}).`);
        const unitPriceMinor = Math.round(Number(p.unit_price) * (1 - discount / 100) * 100);
        return { sku: p.sku, description: `${p.name} (${p.sku})`, quantity, unitPriceMinor, listPriceMinor: Math.round(Number(p.unit_price) * 100) };
      });
      const issueDate = iso(now());
      const prepared = prepareInvoice({
        invoiceNumber: "DRAFT",
        from: { name: store.name, email: store.email, address: [store.address, store.phone && `Tel ${store.phone}`].filter(Boolean).join(", ") },
        customer: { name: cu.name, email: cu.email, address: cu.address },
        currency: store.currency, issueDate, dueDate: addDays(issueDate, store.paymentTermsDays),
        lineItems: lineItems.map(({ description, quantity, unitPriceMinor }) => ({ description, quantity, unitPriceMinor })),
        taxRateBps: store.taxRateBps,
        notes: [notes && (/[.!?]$/.test(notes) ? notes : `${notes}.`), discount ? `Prices include your ${discount}% ${cu.segment.toLowerCase()} discount.` : null, `Payment due within ${store.paymentTermsDays} days.`].filter(Boolean).join(" "),
        sourceIds: [`customer:${cu.id}`, ...lineItems.map((l) => `product:${l.sku}`)],
      });
      return { ...prepared, customerId: cu.id, segment: cu.segment, accountDiscountPct: discount, paymentTermsDays: store.paymentTermsDays,
        lineItems: prepared.lineItems.map((l, i) => ({ ...l, sku: lineItems[i].sku, listPriceMinor: lineItems[i].listPriceMinor })), warnings };
    });
  }

  return {
    names: Object.keys(handlers),
    /** Validates the arguments, then runs one read-only tool. */
    async run(name, args = {}) {
      if (!Object.hasOwn(handlers, name)) throw new Error(`Unknown tool: ${name}`);
      const parsed = Args[name].parse(args ?? {});
      return handlers[name](parsed);
    },
    draftInvoice,
  };
}
