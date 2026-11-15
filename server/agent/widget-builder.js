// The widget-builder sub-agent: turns a plain request ("monthly sales of the 5 kWh battery") into a custom sales
// widget. It's its own small LangGraph graph with its own prompt and tools, called by the main assistant through
// the add_dashboard_widget tool:
//
//   START → model ──(find_products / find_customers)──→ tools ──→ model …
//                └──(create_widget)──→ tools: validate + test-run the query ──ok──→ END
//                                                         └─ problem → back to model to fix it
//
// The model only fills a typed spec (metric, grouping, period, filters, chart). The spec is validated with zod, the
// chart is checked against the data shape, names are checked against the store's real values, and the query is run
// once before the widget is accepted, so a broken or empty widget never reaches the board.
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { CustomQuery, CustomChart, CustomGroupBy, CustomMetric, RECORD_DATASETS, RecordsQuery, Widget, customWidgetProblems, recordsProblems } from "../../shared/spec.js";
import { noteTool } from "./trace.js";
import { EXPENSE_CATEGORIES } from "../sales/changes.js";

export const WIDGET_TOOL_DECLARATIONS = [
  { name: "find_products", description: "Search the catalogue by name or need to get exact product SKUs for a filter.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
  { name: "find_customers", description: "Find customers by part of their name to get their ids for a filter.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
  { name: "create_widget", description: "Create the widget. Call once you know every filter value exactly. The system checks it and runs it; if something is wrong you'll get the reason back to fix.",
    parameters: { type: "OBJECT", properties: {
      title: { type: "STRING", description: "Short, plain title, max 60 characters, e.g. '5 kWh battery sales by month'" },
      chart: { type: "STRING", enum: CustomChart.options, description: "number = one total; line = over time; bar = compare groups or periods; table = ranked list" },
      metric: { type: "STRING", enum: CustomMetric.options },
      groupBy: { type: "STRING", enum: CustomGroupBy.options },
      months: { type: "INTEGER", description: "1-24 calendar months, this month included. Default 12." },
      limit: { type: "INTEGER", description: "For product/customer/staff groupings: how many to show (1-20, default 10)" },
      products: { type: "ARRAY", items: { type: "STRING" }, description: "Product SKUs from find_products" },
      categories: { type: "ARRAY", items: { type: "STRING" } },
      branches: { type: "ARRAY", items: { type: "STRING" } },
      segments: { type: "ARRAY", items: { type: "STRING" } },
      channels: { type: "ARRAY", items: { type: "STRING" } },
      customers: { type: "ARRAY", items: { type: "INTEGER" }, description: "Customer ids from find_customers" },
      note: { type: "STRING", description: "Optional one-line description shown under the title" },
    }, required: ["title", "chart", "metric", "groupBy"] } },
  { name: "create_list", description: "Create a LIST widget: a table of individual records (each product, customer, order, purchase, expense, quote or staff member) with the columns you choose. Use it whenever the user wants to see the items themselves rather than one total or a chart. The system checks it and runs it; if something is wrong you'll get the reason back to fix.",
    parameters: { type: "OBJECT", properties: {
      title: { type: "STRING", description: "Short, plain title, max 60 characters, e.g. 'Products and stock'" },
      dataset: { type: "STRING", enum: Object.keys(RECORD_DATASETS) },
      columns: { type: "ARRAY", items: { type: "STRING" }, description: "Column keys of the dataset, in display order (max 10). Leave out for the defaults." },
      sortBy: { type: "STRING", description: "A column key to sort by" },
      sortDir: { type: "STRING", enum: ["auto", "asc", "desc"], description: "auto = A to Z for text, highest or newest first for numbers and dates" },
      limit: { type: "INTEGER", description: "How many rows (1-50, default 20)" },
      months: { type: "INTEGER", description: "Period in calendar months, this month included (1-24, default 12): which orders, purchases, expenses or closed quotes are listed, and the period of figures like units sold or revenue" },
      search: { type: "STRING", description: "Words to match in names (product, customer, supplier, order number…)" },
      products: { type: "ARRAY", items: { type: "STRING" }, description: "Product SKUs from find_products" },
      categories: { type: "ARRAY", items: { type: "STRING" }, description: "Product categories (expense categories for expenses)" },
      branches: { type: "ARRAY", items: { type: "STRING" } },
      segments: { type: "ARRAY", items: { type: "STRING" } },
      statuses: { type: "ARRAY", items: { type: "STRING" }, description: "Orders: paid, pending, refunded. Quotes: lead, qualified, proposal, negotiation, won, lost" },
      stock: { type: "STRING", enum: ["any", "low", "out"], description: "Products only: low = at or below the reorder level (out of stock included); out = none left" },
      note: { type: "STRING", description: "Optional one-line description" },
    }, required: ["title", "dataset"] } },
];
const DATASET_HELP = Object.entries(RECORD_DATASETS)
  .map(([k, d]) => `  ${k}: ${Object.entries(d.columns).map(([c, v]) => `${c} (${v.label})`).join(", ")}`)
  .join("\n");

function systemPrompt(v) {
  return `You are the widget builder for the Sales dashboard of Cedar Solar Supply (a small solar shop in Lebanon). You receive one request for something to show and turn it into a widget: a chart or number (create_widget) or a list of records (create_list). Map the request to the data as precisely as you can; never swap in a different measure than the one asked for.

LIST OR CHART
- The user wants to see the items themselves ("list of products", "our products and stock", "which items do we have", "show the customers", "recent orders of panels", "supplier invoices", "open quotes", "low stock items", "expenses this month") → create_list.
- The user wants a total, a trend or a comparison ("sales by month", "revenue by branch", "how much we spent on panels") → create_widget.

CHARTS AND NUMBERS (create_widget)
- metric: revenue (USD after discounts), orders, units (units sold), aov (average order value), marginPct (gross margin %), customers (distinct customers), cost (cost of goods SOLD: units sold x unit cost, USD), profit (gross profit: revenue minus cost of goods sold, USD), purchases (what we PAID suppliers for stock we bought, from supplier invoices, USD), expenses (running costs: rent, salaries, utilities…, USD).
- Cost words, read carefully:
  - "cost of purchasing / buying X", "purchase cost", "what we paid for X", "what we bought", "supplier costs", "costs of X" for a product we buy, "spending on stock" → purchases (filter the product or category).
  - Only "cost of goods sold", "COGS", "cost of sales" or "what the items we sold cost us" → cost.
  - "profit" → profit. "expenses", "running costs", "rent", "salaries", "bills" → expenses.
  - When unsure between purchases and cost, choose purchases and say "Purchases" in the title.
- groupBy: none for one total; month, week or day for change over time (day only up to 3 months); or category, product, branch, staff, channel, segment (customer type), customer to compare. Purchases can only be grouped by month, week, day, category, product or supplier, and filtered by products or categories; supplier works only with purchases. Expenses can only be grouped by month, week, day, category (the expense category) or branch, and filtered by categories (expense categories) and branches.
- chart: number for one total (groupBy none); line for over time; bar to compare groups or periods; table for a ranked list with many rows.
- months: the period in calendar months, this month included (default 12; "this year" = months since January; "this quarter" = 3).
- filters: only exact values. Use find_products for product SKUs and find_customers for customer ids. Valid values:
  categories: ${v.categories.join(", ")}
  expense categories (expenses only): ${EXPENSE_CATEGORIES.join(", ")}
  branches: ${v.branches.join(", ")}
  customer types (segments): ${v.segments.join(", ")}
  channels: ${v.channels.join(", ")}
- title: short and plain, naming what's shown (e.g. "5 kWh battery sales by month").

Defaults when the request doesn't say: "sales" means revenue; a single product or customer over time means a line by month for 12 months; "top" or "best" means a table or bar grouped by product (or what's named), limit 10.
LISTS (create_list): datasets and their column keys:
${DATASET_HELP}
- Choose the columns that answer the request (e.g. products and stock: name, category, price, stock, stockStatus; stock value: name, stock, cost, stockValue). Sort by what matters (stock ascending for "running low", revenue for "best customers").
- products, customers and staff list every one; their sales figures (unitsSold, revenue, orders…) cover the months period. orders, purchases and expenses list those in the period; quotes list open ones plus those closed in the period.

Call create_widget or create_list once you know every filter value. If it comes back with a problem, fix it and call it again. Don't write any other text.`;
}

const State = Annotation.Root({
  contents: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
  result: Annotation({ reducer: (_, b) => b, default: () => null }),
  steps: Annotation({ reducer: (_, b) => b, default: () => 0 }),
});
const callsIn = (content) => (content?.parts ?? []).filter((p) => p.functionCall).map((p) => p.functionCall);

/**
 * @param deps.generate  Gemini function calling (llm.js generateContent)
 * @param deps.tools     { run(name, args) } — the read-only sales tools (find_products, find_customers)
 * @param deps.values    () => { categories, branches, segments, channels } — the store's real filter values
 * @param deps.runQuery  (query) => custom query result (server/sales/custom.js)
 */
export function createWidgetBuilder({ generate, tools, values, runQuery, runRecords = null, maxSteps = 6 }) {
  /** Validates a create_widget call; returns { widget, preview } or { error }. */
  async function check(args, v) {
    const canon = (list, allowed, label) => {
      const out = [];
      for (const value of list ?? []) {
        const hit = allowed.find((a) => a.toLowerCase() === String(value).toLowerCase());
        if (!hit) throw new Error(`"${value}" isn't a known ${label}. Use one of: ${allowed.join(", ")}.`);
        out.push(hit);
      }
      return out;
    };
    try {
      const query = CustomQuery.parse({
        metric: args.metric, groupBy: args.groupBy ?? "none", months: args.months ?? 12, limit: args.limit ?? 10,
        filters: {
          products: (args.products ?? []).map(String), customers: (args.customers ?? []).map(Number),
          categories: args.metric === "expenses" ? canon(args.categories, EXPENSE_CATEGORIES, "expense category") : canon(args.categories, v.categories, "category"),
          branches: canon(args.branches, v.branches, "branch"),
          segments: canon(args.segments, v.segments, "customer type"), channels: canon(args.channels, v.channels, "channel"),
        },
      });
      const widget = Widget.parse({ id: "new", type: "sales-custom", title: String(args.title ?? "").slice(0, 60), chart: args.chart, query, ...(args.note ? { note: String(args.note).slice(0, 160) } : {}) });
      const problems = customWidgetProblems(widget);
      if (problems.length) return { error: problems.join(" ") };
      const preview = await runQuery(query);
      const found = preview.filters.filter((f) => f.startsWith("Product: ")).length;
      if (found < query.filters.products.length) return { error: "One or more product SKUs weren't found. Look them up with find_products." };
      const { id: _id, ...rest } = widget;
      return { widget: rest, preview };
    } catch (err) {
      const message = err?.issues ? `${err.issues[0].path.join(".")}: ${err.issues[0].message}` : String(err?.message ?? err);
      return { error: message.slice(0, 300) };
    }
  }

  /** Validates a create_list call; returns { widget, preview } or { error }. */
  async function checkList(args) {
    try {
      const arr = (x) => (Array.isArray(x) ? x.map(String) : []);
      const query = RecordsQuery.parse({
        dataset: args.dataset, columns: arr(args.columns), sortBy: args.sortBy ? String(args.sortBy) : "", sortDir: args.sortDir || "auto",
        limit: args.limit ?? 20, months: args.months ?? 12,
        filters: { search: String(args.search ?? "").slice(0, 80), products: arr(args.products), categories: arr(args.categories), branches: arr(args.branches),
          segments: arr(args.segments), statuses: arr(args.statuses), stock: args.stock || "any" },
      });
      const problems = recordsProblems(query);
      if (problems.length) return { error: problems.join(" ") };
      const title = String(args.title ?? "").slice(0, 60) || RECORD_DATASETS[query.dataset].label;
      const widget = Widget.parse({ id: "new", type: "sales-records", title, query, ...(args.note ? { note: String(args.note).slice(0, 160) } : {}) });
      if (!runRecords) return { error: "Lists aren't available." };
      const preview = await runRecords(query);
      const found = preview.filters.filter((f) => f.startsWith("Product: ")).length;
      if (found < query.filters.products.length) return { error: "One or more product SKUs weren't found. Look them up with find_products." };
      const { id: _id, ...rest } = widget;
      return { widget: rest, preview };
    } catch (err) {
      const message = err?.issues ? `${err.issues[0].path.join(".")}: ${err.issues[0].message}` : String(err?.message ?? err);
      return { error: message.slice(0, 300) };
    }
  }

  function graphFor(v) {
    const system = systemPrompt(v);
    return new StateGraph(State)
      .addNode("model", async (s) => {
        const { content } = await generate({ system, contents: s.contents, tools: WIDGET_TOOL_DECLARATIONS });
        return { contents: [content], steps: s.steps + 1 };
      })
      .addNode("tools", async (s) => {
        const parts = [];
        let result = null;
        for (const { name, args, id } of callsIn(s.contents.at(-1))) {
          let response;
          if (name === "create_widget" || name === "create_list") {
            const checked = name === "create_list" ? await checkList(args ?? {}) : await check(args ?? {}, v);
            if (checked.error) response = { error: checked.error };
            else { result = checked; response = { created: true }; }
          } else if (name === "find_products" || name === "find_customers") {
            try { response = await tools.run(name, { query: String(args?.query ?? "").slice(0, 120), limit: 5 }); }
            catch (err) { response = { error: String(err?.message ?? err).slice(0, 200) }; }
          } else {
            response = { error: `Unknown tool ${name}.` };
          }
          noteTool({ name, args, result: response, ok: !response?.error, error: response?.error }); // Logs (#67)
          parts.push({ functionResponse: { ...(id ? { id } : {}), name, response } });
        }
        return { contents: [{ role: "user", parts }], ...(result ? { result } : {}) };
      })
      .addEdge(START, "model")
      .addConditionalEdges("model", (s) => (callsIn(s.contents.at(-1)).length && s.steps < maxSteps ? "tools" : END), ["tools", END])
      .addConditionalEdges("tools", (s) => (s.result || s.steps >= maxSteps ? END : "model"), ["model", END])
      .compile();
  }

  return {
    /** Builds one widget from a plain request. Throws when the sub-agent can't produce a valid one. */
    async build(request) {
      const text = String(request ?? "").trim().slice(0, 1000);
      if (!text) throw new Error("Say what the widget should show.");
      const v = await values();
      const final = await graphFor(v).invoke({ contents: [{ role: "user", parts: [{ text }] }] }, { recursionLimit: maxSteps * 2 + 4 });
      if (!final.result) throw new Error("I couldn't build that widget. Try naming the measure, the period and what to compare, for example \"revenue by month for the 5 kWh battery, last 6 months\".");
      return final.result;
    },
  };
}

/** A one-line description of what a custom widget counts, for the chat card and the main assistant. */
export function widgetSummary(widget, preview) {
  if (widget.type === "sales-records") {
    const what = preview.filters.join(", ") || `All ${preview.label.toLowerCase()}`;
    return `${what} · ${preview.total} ${preview.total === 1 ? "row" : "rows"}`;
  }
  const what = preview.filters.map((f) => f.replace(/^[^:]+:\s*/, "")).join(", ") || ({ purchases: "All purchases", expenses: "All expenses" }[preview.metric] ?? "All sales");
  const months = preview.period?.months ?? widget.query?.months ?? 12;
  return `${what} · ${months === 1 ? "this month" : `last ${months} months`}`;
}
