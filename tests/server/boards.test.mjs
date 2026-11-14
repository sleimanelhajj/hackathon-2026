// Dashboards ("boards"): each has its own widget catalogue and default layout (shared/spec.js), and the server only
// saves widgets that belong on that board (server/dashboards.js checkBoard).
import assert from "node:assert/strict";
import test from "node:test";
import { BOARDS, CATALOG, DEFAULT_SALES_SPEC, DEFAULT_SPEC, DashboardSpec, SALES_CATALOG, Widget } from "../../shared/spec.js";

process.env.TOKEN_SECRET ||= "a".repeat(64);
const { checkBoard } = await import("../../server/dashboards.js");

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("there are two boards, email and sales, each with its own catalogue and default", () => {
  assert.deepEqual(Object.keys(BOARDS).sort(), ["default", "sales"]);
  assert.equal(BOARDS.default.catalog, CATALOG);
  assert.equal(BOARDS.sales.catalog, SALES_CATALOG);
  assert.equal(BOARDS.sales.spec, DEFAULT_SALES_SPEC);
  for (const type of Object.keys(SALES_CATALOG)) assert.ok(!(type in CATALOG), `${type} is only on the sales board`);
});

test("the default sales board is valid, overlap-free and uses only sales widgets", () => {
  assert.equal(DashboardSpec.safeParse(DEFAULT_SALES_SPEC).success, true);
  for (const w of DEFAULT_SALES_SPEC.widgets) assert.ok(w.type in SALES_CATALOG, w.type);
  const L = DEFAULT_SALES_SPEC.layout;
  for (const a of L) {
    assert.ok(a.x >= 0 && a.x + a.w <= 12, a.i);
    for (const b of L) if (a !== b) assert.equal(overlaps(a, b), false, `${a.i} overlaps ${b.i}`);
  }
});

test("the default sales board shows every kind of sales widget", () => {
  const types = new Set(DEFAULT_SALES_SPEC.widgets.map((w) => w.type));
  for (const [type, entry] of Object.entries(SALES_CATALOG)) if (!entry.hidden) assert.ok(types.has(type), `${type} is on the default board`);
  const tables = DEFAULT_SALES_SPEC.widgets.filter((w) => w.type === "sales-table").map((w) => w.table).sort();
  assert.deepEqual(tables, ["recentOrders", "topCustomers", "topProducts"]);
});

test("every sales widget the catalogue creates is valid", () => {
  for (const [type, entry] of Object.entries(SALES_CATALOG)) {
    const w = { id: "x", ...entry.create() };
    assert.equal(w.type, type);
    assert.equal(Widget.safeParse(w).success, true, type);
  }
  assert.equal(Widget.safeParse({ id: "k", type: "sales-kpi", title: "Bad", metric: "profitz" }).success, false);
  assert.equal(Widget.safeParse({ id: "t", type: "sales-table", title: "Bad", table: "everything" }).success, false);
});

// ---- widgets the assistant adds (decision #48) ----
const { placeWidget, CUSTOM_SIZES } = await import("../../server/dashboards.js");
const custom = (chart) => ({ type: "sales-custom", title: "Drill sales", chart, query: { metric: "revenue", groupBy: chart === "number" ? "none" : "month", months: 12, limit: 10, filters: { products: [], categories: [], branches: [], segments: [], channels: [], customers: [] } } });

test("an assistant widget lands in free space below the board, sized for its chart, without moving anything", () => {
  const spec = structuredClone(DEFAULT_SALES_SPEC);
  const bottom = Math.max(...spec.layout.map((l) => l.y + l.h));
  const next = placeWidget(spec, custom("line"));
  const added = next.widgets.at(-1);
  assert.match(added.id, /^ai-[a-z0-9-]+$/);
  const slot = next.layout.find((l) => l.i === added.id);
  assert.equal(slot.y, bottom);
  assert.equal(slot.w, CUSTOM_SIZES.line.w);
  assert.deepEqual(next.layout.slice(0, -1), spec.layout, "existing widgets keep their places");
  assert.equal(DashboardSpec.safeParse(next).success, true);
  for (const a of next.layout) for (const b of next.layout) if (a !== b) assert.equal(overlaps(a, b), false);
});

test("small assistant widgets sit side by side", () => {
  let spec = structuredClone(DEFAULT_SALES_SPEC);
  spec = placeWidget(spec, custom("number"));
  spec = placeWidget(spec, custom("number"));
  const [a, b] = spec.layout.slice(-2);
  assert.equal(a.y, b.y);
  assert.equal(b.x, a.x + a.w);
  assert.notEqual(spec.widgets.at(-1).id, spec.widgets.at(-2).id);
});

test("removing a widget closes the gap: the widgets below it move up, the ones above stay put", async () => {
  const { withoutWidget } = await import("../../server/dashboards.js");
  let spec = structuredClone(DEFAULT_SALES_SPEC);
  spec = placeWidget(spec, custom("line"));
  spec = placeWidget(spec, custom("number"));
  const [line, number] = spec.layout.slice(-2);
  assert.equal(number.y, line.y + line.h, "the number sits under the line chart");
  const next = withoutWidget(spec, line.i);
  assert.equal(next.widgets.some((w) => w.id === line.i), false);
  const moved = next.layout.find((l) => l.i === number.i);
  assert.equal(moved.y, line.y, "the number moved up into the line chart's place");
  assert.equal(moved.x, number.x);
  for (const l of DEFAULT_SALES_SPEC.layout) assert.deepEqual(next.layout.find((n) => n.i === l.i), l, `${l.i} didn't move`);
  for (const a of next.layout) for (const b of next.layout) if (a !== b) assert.equal(overlaps(a, b), false);
  assert.equal(DashboardSpec.safeParse(next).success, true);
});

test("a gap in the middle of the board closes too, without overlaps", async () => {
  const { withoutWidget } = await import("../../server/dashboards.js");
  const next = withoutWidget(structuredClone(DEFAULT_SALES_SPEC), "pipeline"); // x0 y13 w6 h10, top-products sits under it
  assert.deepEqual(next.layout.find((l) => l.i === "top-products"), { i: "top-products", x: 0, y: 13, w: 6, h: 10 });
  for (const a of next.layout) for (const b of next.layout) if (a !== b) assert.equal(overlaps(a, b), false);
});

test("a number widget is big enough for its value, change and caption", () => {
  assert.ok(CUSTOM_SIZES.number.h >= 5 && CUSTOM_SIZES.number.w >= 4, JSON.stringify(CUSTOM_SIZES.number));
});

test("a full board refuses another widget with a clear message", () => {
  const spec = { title: "Full", widgets: [], layout: [] };
  for (let i = 0; i < 24; i++) { spec.widgets.push({ id: `w${i}`, type: "sales-pipeline", title: "P" }); spec.layout.push({ i: `w${i}`, x: 0, y: i * 2, w: 12, h: 2 }); }
  assert.throws(() => placeWidget(spec, custom("line")), /full|24/i);
});

test("the server refuses widgets from another board, and unknown boards", () => {
  assert.doesNotThrow(() => checkBoard("sales", DEFAULT_SALES_SPEC));
  assert.doesNotThrow(() => checkBoard("default", DEFAULT_SPEC));
  assert.throws(() => checkBoard("default", DEFAULT_SALES_SPEC), /sales-kpi|can't go on/);
  assert.throws(() => checkBoard("sales", DEFAULT_SPEC), /can't go on/);
  assert.throws(() => checkBoard("marketing", DEFAULT_SPEC), /Unknown dashboard/);
});
