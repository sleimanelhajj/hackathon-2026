// Ready-made widgets the assistant can put on a board (server/widget-kinds.js, decision #60): every widget in the
// "Add widgets" panel, with its setting, named as a plain "kind" such as "sales-kpi:revenue" or "payments:to-pay".
import assert from "node:assert/strict";
import test from "node:test";
import { WIDGET_KINDS, widgetFromKind } from "../../server/widget-kinds.js";
import { Widget, CATALOG, SALES_CATALOG } from "../../shared/spec.js";

test("every kind makes a valid widget of the right type, titled for what it shows", () => {
  assert.ok(WIDGET_KINDS.length > 30);
  for (const k of WIDGET_KINDS) {
    const { widget, size } = widgetFromKind(k.kind);
    assert.equal(Widget.safeParse({ id: "x", ...widget }).success, true, k.kind);
    assert.ok(size.w >= 1 && size.h >= 2, k.kind);
    assert.ok(k.label && k.data, k.kind);
  }
  assert.deepEqual(widgetFromKind("sales-kpi:purchases").widget, { type: "sales-kpi", title: "Purchases", metric: "purchases" });
  assert.deepEqual(widgetFromKind("payments:to-pay").widget, { type: "payments", title: "Invoices to pay", show: "to-pay" });
  assert.equal(widgetFromKind("stat:awaitingYou").widget.title, "Waiting on you");
  assert.equal(widgetFromKind("sales-trend").widget.type, "sales-trend");
});

test("each kind says whether it shows email or sales data; hidden assistant-only types aren't offered", () => {
  const data = Object.fromEntries(WIDGET_KINDS.map((k) => [k.kind.split(":")[0], k.data]));
  for (const type of Object.keys(CATALOG)) if (!CATALOG[type].hidden) assert.equal(data[type], "email", type);
  for (const type of Object.keys(SALES_CATALOG)) if (!SALES_CATALOG[type].hidden) assert.equal(data[type], "sales", type);
  assert.ok(!WIDGET_KINDS.some((k) => k.kind.startsWith("sales-custom") || k.kind.startsWith("email-custom")));
});

test("an unknown kind or setting is refused with the list to choose from", () => {
  assert.throws(() => widgetFromKind("sales-kpi:profit"), /isn't a widget/);
  assert.throws(() => widgetFromKind("pie-chart"), /isn't a widget/);
});
