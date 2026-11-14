// The widget-builder sub-agent (server/agent/widget-builder.js) and how the main assistant delegates to it.
// Driven by scripted fake models: no Gemini, no database.
import assert from "node:assert/strict";
import test from "node:test";
import { createWidgetBuilder, WIDGET_TOOL_DECLARATIONS } from "../../server/agent/widget-builder.js";
import { createSalesAgent } from "../../server/agent/sales-agent.js";

const call = (name, args = {}) => ({ role: "model", parts: [{ functionCall: { name, args } }] });
const say = (text) => ({ role: "model", parts: [{ text }] });
function fakeModel(script) {
  const seen = [];
  const fn = async (req) => {
    seen.push(structuredClone(req));
    const next = script.shift();
    if (!next) throw new Error("script ran out");
    return { content: typeof next === "function" ? next(req.contents) : next, model: "fake" };
  };
  fn.seen = seen;
  return fn;
}
const tools = { async run(name, args) { return name === "find_products" ? { products: [{ sku: "CH-0010", name: "Cordless drill/driver 20V kit" }] } : { customers: [] }; } };
const values = async () => ({ categories: ["Power tools", "Plumbing"], branches: ["Downtown store", "Online"], segments: ["Trade account"], channels: ["In store"] });
const preview = { rows: [{ key: "2026-10", value: 1200 }, { key: "2026-11", value: 800 }], total: 2000, previousTotal: 1500, unit: "USD", period: { from: "2026-06-01", to: "2026-11-14", months: 6 }, filters: ["Product: Cordless drill/driver 20V kit"] };

test("the builder looks things up, then creates a validated widget and test-runs its query", async () => {
  const model = fakeModel([
    call("find_products", { query: "cordless drill" }),
    call("create_widget", { title: "Cordless drill sales", chart: "line", metric: "revenue", groupBy: "month", months: 6, products: ["CH-0010"] }),
  ]);
  const ran = [];
  const builder = createWidgetBuilder({ generate: model, tools, values, runQuery: async (q) => { ran.push(q); return preview; } });
  const out = await builder.build("show me monthly sales of the cordless drill for the last 6 months");
  assert.equal(out.widget.type, "sales-custom");
  assert.equal(out.widget.chart, "line");
  assert.deepEqual(out.widget.query.filters.products, ["CH-0010"]);
  assert.equal(out.widget.query.months, 6);
  assert.equal(ran.length, 1, "the query was tried before the widget is accepted");
  assert.equal(out.preview.total, 2000);
  // Its own prompt, with the store's real category and branch names.
  assert.match(model.seen[0].system, /widget builder/i);
  assert.match(model.seen[0].system, /Downtown store/);
  assert.deepEqual(model.seen[0].tools.map((t) => t.name).sort(), WIDGET_TOOL_DECLARATIONS.map((t) => t.name).sort());
});

test("a chart that doesn't suit the data is sent back to the sub-agent to fix", async () => {
  const model = fakeModel([
    call("create_widget", { title: "Sales by category", chart: "line", metric: "revenue", groupBy: "category" }),
    (contents) => {
      assert.match(contents.at(-1).parts[0].functionResponse.response.error, /over time/i);
      return call("create_widget", { title: "Sales by category", chart: "bar", metric: "revenue", groupBy: "category" });
    },
  ]);
  const out = await createWidgetBuilder({ generate: model, tools, values, runQuery: async () => preview }).build("sales by category");
  assert.equal(out.widget.chart, "bar");
});

test("unknown names and query errors are sent back too", async () => {
  const model = fakeModel([
    call("create_widget", { title: "X", chart: "bar", metric: "revenue", groupBy: "branch", branches: ["Mars store"] }),
    (contents) => {
      assert.match(contents.at(-1).parts[0].functionResponse.response.error, /Mars store/);
      return call("create_widget", { title: "X", chart: "bar", metric: "revenue", groupBy: "branch" });
    },
  ]);
  const out = await createWidgetBuilder({ generate: model, tools, values, runQuery: async () => preview }).build("x");
  assert.deepEqual(out.widget.query.filters.branches, []);
});

test("a builder that can't settle gives up with a clear error", async () => {
  const model = fakeModel(Array.from({ length: 10 }, () => call("create_widget", { title: "Bad", chart: "number", metric: "revenue", groupBy: "month" })));
  await assert.rejects(createWidgetBuilder({ generate: model, tools, values, runQuery: async () => preview, maxSteps: 3 }).build("bad"), /couldn't build/i);
});

test("the assistant removes a widget you name: it lists the boards, matches it, removes it and reports it", async () => {
  const model = fakeModel([
    call("list_dashboard_widgets"),
    (contents) => {
      const boards = contents.at(-1).parts[0].functionResponse.response.boards;
      const plumbing = boards.find((b) => b.board === "sales").widgets.find((w) => /plumbing/i.test(w.title));
      return call("remove_dashboard_widget", { board: "sales", widgetId: plumbing.id });
    },
    (contents) => {
      const r = contents.at(-1).parts[0].functionResponse.response;
      assert.equal(r.removed, true);
      return say(`Removed **${r.title}**. You can undo it from the chat.`);
    },
  ]);
  const removed = [];
  const agent = createSalesAgent({
    generate: model, tools: { run: async () => ({}), draftInvoice: async () => ({}) }, saveInvoice: async () => ({}),
    listWidgets: async () => [
      { board: "sales", name: "Sales", widgets: [{ id: "ai-plumbing-1", title: "Plumbing revenue by branch", type: "sales-custom" }, { id: "pipeline", title: "Pipeline", type: "sales-pipeline" }] },
      { board: "default", name: "Email dashboard", widgets: [{ id: "starred", title: "Starred", type: "rule-list" }] },
    ],
    removeWidget: async (board, id) => { removed.push([board, id]); return { board, id, title: "Plumbing revenue by branch", version: 23 }; },
  });
  const out = await agent.send({ threadId: "r1", message: "remove the plumbing chart" });
  assert.deepEqual(removed, [["sales", "ai-plumbing-1"]]);
  assert.deepEqual(out.removed, [{ board: "sales", id: "ai-plumbing-1", title: "Plumbing revenue by branch", version: 23 }]);
  assert.ok(out.toolsUsed.includes("remove_dashboard_widget"));
  const names = model.seen[0].tools.map((t) => t.name);
  assert.ok(names.includes("list_dashboard_widgets") && names.includes("remove_dashboard_widget"));
});

test("removing an id that isn't on the board is reported back to the model, not thrown", async () => {
  const model = fakeModel([
    call("remove_dashboard_widget", { board: "sales", widgetId: "nope" }),
    (contents) => say(`Couldn't: ${contents.at(-1).parts[0].functionResponse.response.error}`),
  ]);
  const agent = createSalesAgent({
    generate: model, tools: { run: async () => ({}), draftInvoice: async () => ({}) }, saveInvoice: async () => ({}),
    listWidgets: async () => [], removeWidget: async () => { throw new Error("That widget is no longer on the dashboard."); },
  });
  const out = await agent.send({ threadId: "r2", message: "remove nope" });
  assert.match(out.reply, /no longer on the dashboard/);
  assert.deepEqual(out.removed, []);
});

test("the main assistant delegates 'show me…' to the builder and reports the widget it added", async () => {
  const model = fakeModel([
    call("add_dashboard_widget", { request: "monthly sales of the cordless drill, last 6 months" }),
    (contents) => {
      const r = contents.at(-1).parts[0].functionResponse.response;
      assert.equal(r.added, true);
      return say(`Added **${r.title}** to your Sales dashboard.`);
    },
  ]);
  const requests = [];
  const agent = createSalesAgent({
    generate: model, tools: { run: async () => ({}), draftInvoice: async () => ({}) }, saveInvoice: async () => ({}),
    addWidget: async (request) => { requests.push(request); return { board: "sales", widget: { id: "ai-drill-1a2b", title: "Cordless drill sales", chart: "line" }, preview }; },
  });
  const out = await agent.send({ threadId: "w1", message: "Show me the sales of the cordless drill" });
  assert.deepEqual(requests, ["monthly sales of the cordless drill, last 6 months"]);
  assert.deepEqual(out.widgets, [{ board: "sales", id: "ai-drill-1a2b", title: "Cordless drill sales", chart: "line", summary: "Cordless drill/driver 20V kit · last 6 months" }]);
  assert.match(out.reply, /Added \*\*Cordless drill sales\*\*/);
  assert.ok(out.toolsUsed.includes("add_dashboard_widget"));
});
