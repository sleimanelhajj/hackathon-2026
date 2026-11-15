// Dashboard pages (decision #60): a main board you fully customise with email and sales widgets, plus as many extra
// pages as you like; the Email dashboard and Sales keep their own widgets.
import assert from "node:assert/strict";
import test from "node:test";
import { BOARDS, CATALOG, DEFAULT_MAIN_SPEC, DashboardSpec, MAIN_CATALOG, SALES_CATALOG, boardDef } from "../../shared/spec.js";

process.env.TOKEN_SECRET ||= "a".repeat(64);
const { checkBoard } = await import("../../server/dashboards.js");
const { newPageId, PageName } = await import("../../server/pages.js");
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("the main board and extra pages take any email or sales widget; the email and sales boards stay separate", () => {
  for (const type of [...Object.keys(CATALOG), ...Object.keys(SALES_CATALOG)]) assert.ok(type in MAIN_CATALOG, type);
  assert.equal(boardDef("main"), BOARDS.main);
  assert.equal(boardDef("page-ab12cd"), BOARDS.main);
  for (const bad of ["page-../x", "page-AB12CD", "page-", "__proto__", "constructor", "marketing"]) assert.equal(boardDef(bad), null, bad);
  const mixed = { title: "Mine", widgets: [{ id: "a", type: "payments", title: "Payments", show: "all" }, { id: "b", type: "sales-kpi", title: "Revenue", metric: "revenue" }], layout: [] };
  assert.doesNotThrow(() => checkBoard("main", mixed));
  assert.doesNotThrow(() => checkBoard("page-ab12cd", mixed));
  assert.throws(() => checkBoard("default", mixed), /can't go on/);
  assert.throws(() => checkBoard("page-nope!", mixed), /Unknown dashboard/);
});

test("the default main board is valid, overlap-free, and mixes email, sales and payments", () => {
  assert.equal(DashboardSpec.safeParse(DEFAULT_MAIN_SPEC).success, true);
  const types = new Set(DEFAULT_MAIN_SPEC.widgets.map((w) => w.type));
  assert.ok(["sales-kpi", "stat", "payments", "sales-trend"].every((t) => types.has(t)), [...types].join());
  for (const a of DEFAULT_MAIN_SPEC.layout) for (const b of DEFAULT_MAIN_SPEC.layout) if (a !== b) assert.equal(overlaps(a, b), false, `${a.i} overlaps ${b.i}`);
  assert.deepEqual(new Set(DEFAULT_MAIN_SPEC.layout.map((l) => l.i)), new Set(DEFAULT_MAIN_SPEC.widgets.map((w) => w.id)));
});

test("new pages get a short random id that isn't taken, and a plain name", () => {
  const id = newPageId(new Set(["page-aaaaaa"]));
  assert.match(id, /^page-[a-z0-9]{6}$/);
  assert.equal(boardDef(id), BOARDS.main);
  assert.equal(PageName.parse("  Weekly review  "), "Weekly review");
  assert.equal(PageName.safeParse("").success, false);
  assert.equal(PageName.safeParse("x".repeat(41)).success, false);
});
