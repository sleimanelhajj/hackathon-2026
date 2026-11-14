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
  for (const type of Object.keys(SALES_CATALOG)) assert.ok(types.has(type), `${type} is on the default board`);
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

test("the server refuses widgets from another board, and unknown boards", () => {
  assert.doesNotThrow(() => checkBoard("sales", DEFAULT_SALES_SPEC));
  assert.doesNotThrow(() => checkBoard("default", DEFAULT_SPEC));
  assert.throws(() => checkBoard("default", DEFAULT_SALES_SPEC), /sales-kpi|can't go on/);
  assert.throws(() => checkBoard("sales", DEFAULT_SPEC), /can't go on/);
  assert.throws(() => checkBoard("marketing", DEFAULT_SPEC), /Unknown dashboard/);
});
