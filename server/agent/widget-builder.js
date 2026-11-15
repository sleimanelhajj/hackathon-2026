// The widget-builder sub-agent: turns a plain request ("monthly sales of the cordless drill") into a custom sales
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
import { CustomQuery, CustomChart, CustomGroupBy, CustomMetric, Widget, customWidgetProblems } from "../../shared/spec.js";

export const WIDGET_TOOL_DECLARATIONS = [
  { name: "find_products", description: "Search the catalogue by name or need to get exact product SKUs for a filter.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
  { name: "find_customers", description: "Find customers by part of their name to get their ids for a filter.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
  { name: "create_widget", description: "Create the widget. Call once you know every filter value exactly. The system checks it and runs it; if something is wrong you'll get the reason back to fix.",
    parameters: { type: "OBJECT", properties: {
      title: { type: "STRING", description: "Short, plain title, max 60 characters, e.g. 'Cordless drill sales by month'" },
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
];

function systemPrompt(v) {
  return `You are the widget builder for the Sales dashboard of Cedar Hardware & Supply (a hardware store in Lebanon). You receive one request for a chart or number and turn it into a widget by calling create_widget.

Pick:
- metric: revenue (USD after discounts), orders, units (units sold), aov (average order value), marginPct (gross margin %), customers (distinct customers), cost (cost of the goods sold: quantity x unit cost, USD), profit (gross profit: revenue minus cost, USD), purchases (what supplier invoices cost us, USD).
- "Costs", "cost of sales" or "what we spent on stock sold" means cost; "profit" means profit; "what we bought", "spending on suppliers" or "supplier costs" means purchases.
- groupBy: none for one total; month, week or day for change over time (day only up to 3 months); or category, product, branch, staff, channel, segment (customer type), customer to compare. Purchases can only be grouped by month, week, day, category, product or supplier, and filtered by products or categories; supplier works only with purchases.
- chart: number for one total (groupBy none); line for over time; bar to compare groups or periods; table for a ranked list with many rows.
- months: the period in calendar months, this month included (default 12; "this year" = months since January; "this quarter" = 3).
- filters: only exact values. Use find_products for product SKUs and find_customers for customer ids. Valid values:
  categories: ${v.categories.join(", ")}
  branches: ${v.branches.join(", ")}
  customer types (segments): ${v.segments.join(", ")}
  channels: ${v.channels.join(", ")}
- title: short and plain, naming what's shown (e.g. "Cordless drill sales by month").

Defaults when the request doesn't say: "sales" means revenue; a single product or customer over time means a line by month for 12 months; "top" or "best" means a table or bar grouped by product (or what's named), limit 10.
Call create_widget once you know every filter value. If it comes back with a problem, fix it and call create_widget again. Don't write any other text.`;
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
export function createWidgetBuilder({ generate, tools, values, runQuery, maxSteps = 6 }) {
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
          categories: canon(args.categories, v.categories, "category"), branches: canon(args.branches, v.branches, "branch"),
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
          if (name === "create_widget") {
            const checked = await check(args ?? {}, v);
            if (checked.error) response = { error: checked.error };
            else { result = checked; response = { created: true }; }
          } else if (name === "find_products" || name === "find_customers") {
            try { response = await tools.run(name, { query: String(args?.query ?? "").slice(0, 120), limit: 5 }); }
            catch (err) { response = { error: String(err?.message ?? err).slice(0, 200) }; }
          } else {
            response = { error: `Unknown tool ${name}.` };
          }
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
      if (!final.result) throw new Error("I couldn't build that widget. Try naming the measure, the period and what to compare, for example \"revenue by month for the cordless drill, last 6 months\".");
      return final.result;
    },
  };
}

/** A one-line description of what a custom widget counts, for the chat card and the main assistant. */
export function widgetSummary(widget, preview) {
  const what = preview.filters.map((f) => f.replace(/^[^:]+:\s*/, "")).join(", ") || "All sales";
  const months = preview.period?.months ?? widget.query?.months ?? 12;
  return `${what} · ${months === 1 ? "this month" : `last ${months} months`}`;
}
