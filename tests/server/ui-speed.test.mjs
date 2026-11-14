// Guards against the things that made the UI feel slow (2026-11-14). The CSS side (no backdrop blur on panes, no
// fixed body background) is pinned in theme.test.mjs; this file pins the React side.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("data stays fresh for a while, so switching pages or windows doesn't refetch and redraw everything", () => {
  const main = read("src/main.tsx");
  const m = main.match(/staleTime:\s*([\d_]+)/);
  assert.ok(m, "the query client sets a default staleTime");
  assert.ok(Number(m[1].replace(/_/g, "")) >= 15_000, `staleTime ${m[1]} is at least 15s`);
});

test("charts redraw once after a resize settles, not on every frame of it", () => {
  for (const file of ["src/widgets/ActivityChartWidget.tsx", "src/widgets/SalesWidgets.tsx"]) {
    const src = read(file);
    for (const tag of src.match(/<ResponsiveContainer[^>]*>/g) ?? []) {
      assert.match(tag, /debounce=\{\d+\}/, `${file}: ${tag}`);
    }
  }
});

test("chart series don't replay their entry animation on every refresh", () => {
  const src = read("src/widgets/SalesWidgets.tsx");
  for (const tag of src.match(/<(Area|Line|Bar)\s[^>]*\/>/g) ?? []) assert.match(tag, /isAnimationActive=\{false\}/, tag);
});

const css = read("src/index.css");
const block = (sel) => {
  const m = css.match(new RegExp(`(^|\\n)${sel.replace(/[.>[\]"=()*:]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `${sel} has a rule`);
  return m[2];
};

test("each card's layout is contained, so moving or resizing one doesn't re-lay-out the others", () => {
  assert.match(block(".dashboard-canvas .grid-stack > .grid-stack-item"), /contain:\s*layout style/);
});

test("the resize corner sits inside the card's rounded corner, clear of the border", () => {
  const handle = block(".dashboard-canvas .grid-stack-item > .ui-resizable-se");
  // GridStack insets the card by --gs-item-margin-*; the corner must be measured from the card, not the cell.
  assert.match(handle, /right:\s*calc\(var\(--gs-item-margin-right\) \+ \d+px\)/);
  assert.match(handle, /bottom:\s*calc\(var\(--gs-item-margin-bottom\) \+ \d+px\)/);
  const glyph = block(".dashboard-canvas .grid-stack-item > .ui-resizable-se::after");
  assert.match(glyph, /mask:/, "a drawn grip icon, not a box-border corner");
  assert.match(glyph, /background:\s*var\(--text-3\)/);
});
