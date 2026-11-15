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

test("the assistant resizes a widget you name: it lists the boards with sizes, resizes it and reports old and new size", async () => {
  const model = fakeModel([
    call("list_dashboard_widgets"),
    (contents) => {
      const pipeline = contents.at(-1).parts[0].functionResponse.response.boards[0].widgets.find((w) => /pipeline/i.test(w.title));
      assert.equal(pipeline.w, 6);
      return call("resize_dashboard_widget", { board: "sales", widgetId: pipeline.id, width: 12 });
    },
    (contents) => {
      const r = contents.at(-1).parts[0].functionResponse.response;
      assert.equal(r.resized, true);
      assert.deepEqual(r.to, { w: 12, h: 9 });
      return say(`Made **${r.title}** full width. You can undo it from the chat.`);
    },
  ]);
  const calls = [];
  const agent = createSalesAgent({
    generate: model, tools: { run: async () => ({}), draftInvoice: async () => ({}) }, saveInvoice: async () => ({}),
    listWidgets: async () => [{ board: "sales", name: "Sales", widgets: [{ id: "pipeline", title: "Pipeline", type: "sales-pipeline", w: 6, h: 9 }] }],
    resizeWidget: async (board, id, size) => { calls.push([board, id, size]); return { board, id, title: "Pipeline", version: 7, from: { w: 6, h: 9 }, to: { w: 12, h: 9 }, limited: false }; },
  });
  const out = await agent.send({ threadId: "z1", message: "make the pipeline full width" });
  assert.deepEqual(calls, [["sales", "pipeline", { w: 12 }]]);
  assert.deepEqual(out.resized, [{ board: "sales", id: "pipeline", title: "Pipeline", version: 7, from: { w: 6, h: 9 }, to: { w: 12, h: 9 }, limited: false }]);
  assert.ok(out.toolsUsed.includes("resize_dashboard_widget"));
  const decl = model.seen[0].tools.find((t) => t.name === "resize_dashboard_widget");
  assert.ok(decl, "the model is offered the resize tool");
  assert.deepEqual(decl.parameters.required, ["board", "widgetId"]);
});

test("a resize that changes nothing gets no Undo card, and errors go back to the model", async () => {
  const model = fakeModel([
    call("resize_dashboard_widget", { board: "sales", widgetId: "kpi-revenue", height: 20 }),
    call("resize_dashboard_widget", { board: "sales", widgetId: "gone", width: 6 }),
    (contents) => say(`Couldn't: ${contents.at(-1).parts[0].functionResponse.response.error}`),
  ]);
  const agent = createSalesAgent({
    generate: model, tools: { run: async () => ({}), draftInvoice: async () => ({}) }, saveInvoice: async () => ({}),
    listWidgets: async () => [],
    resizeWidget: async (board, id) => {
      if (id === "gone") throw new Error("That widget is no longer on the dashboard.");
      return { board, id, title: "Revenue", version: 3, from: { w: 2, h: 4 }, to: { w: 2, h: 4 }, limited: true, unchanged: true };
    },
  });
  const out = await agent.send({ threadId: "z2", message: "make revenue taller" });
  assert.match(out.reply, /no longer on the dashboard/);
  assert.deepEqual(out.resized, []);
});

test("the assistant finds an attachment you ask about: who, what kind, which date (decision #56)", async () => {
  const model = fakeModel([
    call("search_documents", { contact: "Haddad", type: "invoice", from: "2026-11-12", to: "2026-11-12" }),
    (contents) => {
      const r = contents.at(-1).parts[0].functionResponse.response;
      assert.equal(r.files[0].number, "1042");
      return say(`Haddad Plumbing's invoice ${r.files[0].number} on 12 November was ${r.files[0].total} USD.`);
    },
  ]);
  const asked = [];
  const agent = createSalesAgent({
    generate: model, tools: { run: async () => ({}), draftInvoice: async () => ({}) }, saveInvoice: async () => ({}),
    searchDocuments: async (q) => { asked.push(q); return [{ filename: "Invoice-1042.pdf", contact: "Haddad Plumbing", type: "invoice", number: "1042", total: 2450.5, issueDate: "2026-11-12" }]; },
  });
  const out = await agent.send({ threadId: "d1", message: "what was the invoice from Haddad on 12 November?" });
  assert.deepEqual(asked, [{ contact: "Haddad", type: "invoice", from: "2026-11-12", to: "2026-11-12" }]);
  assert.match(out.reply, /1042/);
  assert.ok(out.toolsUsed.includes("search_documents"));
  const decl = model.seen[0].tools.find((t) => t.name === "search_documents");
  assert.ok(decl, "offered to the model");
  assert.ok(decl.parameters.properties.type.enum.includes("invoice"));
  assert.match(JSON.stringify(model.seen[0]), /search_documents/);
});

// ---- dashboard pages, ready-made and email widgets (decision #60) ----
const noTools = { run: async () => ({}), draftInvoice: async () => ({}) };

test("the assistant makes a new page and fills it with ready-made email and sales widgets", async () => {
  const model = fakeModel([
    call("create_dashboard_page", { name: "Money" }),
    (contents) => {
      const page = contents.at(-1).parts[0].functionResponse.response;
      assert.equal(page.board, "page-abc123");
      return { role: "model", parts: [
        { functionCall: { name: "add_ready_widget", args: { board: page.board, kind: "payments:to-pay" } } },
        { functionCall: { name: "add_ready_widget", args: { board: page.board, kind: "sales-kpi:revenue" } } },
      ] };
    },
    say("I made a **Money** page with your invoices to pay and revenue."),
  ]);
  const added = [];
  const agent = createSalesAgent({
    generate: model, tools: noTools, saveInvoice: async () => ({}),
    createPage: async (name) => ({ board: "page-abc123", name }),
    addReadyWidget: async (board, kind) => { added.push([board, kind]); return { board, boardName: "Money", widget: { id: `ai-${added.length}`, type: "payments", title: kind } }; },
  });
  const out = await agent.send({ threadId: "p1", message: "make a money page with what I owe and revenue" });
  assert.deepEqual(added, [["page-abc123", "payments:to-pay"], ["page-abc123", "sales-kpi:revenue"]]);
  assert.equal(out.widgets.length, 2);
  assert.equal(out.widgets[0].boardName, "Money");
  const names = model.seen[0].tools.map((t) => t.name);
  assert.ok(names.includes("create_dashboard_page") && names.includes("add_ready_widget"));
  const kinds = model.seen[0].tools.find((t) => t.name === "add_ready_widget").parameters.properties.kind.enum;
  assert.ok(kinds.includes("payments:to-pay") && kinds.includes("stat:awaitingYou"));
});

test("the assistant builds a custom email chart: a typed query, checked, previewed, then added", async () => {
  const model = fakeModel([
    call("add_email_widget", { board: "default", title: "Emails by company", chart: "bar", metric: "emails", groupBy: "company", days: 30 }),
    (contents) => {
      const r = contents.at(-1).parts[0].functionResponse.response;
      assert.equal(r.added, true);
      assert.match(r.shows, /haddad-plumbing\.example 12/);
      return say(`Added **${r.title}** to your Email dashboard.`);
    },
  ]);
  const specs = [];
  const agent = createSalesAgent({
    generate: model, tools: noTools, saveInvoice: async () => ({}),
    addEmailWidget: async (board, spec) => {
      specs.push([board, spec]);
      return { board, boardName: "Email dashboard", widget: { id: "ai-emails", type: "email-custom", title: spec.title, chart: spec.chart }, preview: { rows: [{ key: "haddad-plumbing.example", value: 12 }], total: 30, unit: "emails" } };
    },
  });
  const out = await agent.send({ threadId: "e1", message: "chart my emails by company" });
  assert.equal(specs[0][0], "default");
  assert.deepEqual(specs[0][1].query, { metric: "emails", groupBy: "company", days: 30, filters: {} });
  assert.equal(out.widgets[0].title, "Emails by company");
});

test("a sales chart can go on the main dashboard or a page, not only Sales", async () => {
  const model = fakeModel([
    call("add_dashboard_widget", { request: "drill sales by month", board: "main" }),
    say("Added."),
  ]);
  const boards = [];
  const agent = createSalesAgent({
    generate: model, tools: noTools, saveInvoice: async () => ({}),
    addWidget: async (request, board) => { boards.push(board); return { board, widget: { id: "ai-drill", title: "Drill sales", chart: "line" }, preview: { rows: [], total: 0, previousTotal: 0, unit: "USD", period: {}, filters: [] } }; },
  });
  await agent.send({ threadId: "s1", message: "put drill sales on my main dashboard" });
  assert.deepEqual(boards, ["main"]);
});
