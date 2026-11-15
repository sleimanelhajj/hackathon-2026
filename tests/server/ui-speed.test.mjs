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

// Opening or closing the sidebar used to animate its width inside the page flow, so the whole dashboard (grid, every
// widget, every chart) re-laid-out on each of ~15 animation frames. Now the sidebar floats outside the flow: only it
// animates, and the page moves over once.
test("the sidebar animates outside the page flow, so toggling it doesn't re-lay-out the page every frame", () => {
  const side = block(".sidebar");
  assert.match(side, /position:\s*fixed/);
  assert.match(side, /transition:\s*width/);
  assert.match(side, /contain:\s*layout/);
  const main = block(".main");
  assert.match(main, /margin-left:\s*calc\(var\(--sidebar-w\)/, "the page leaves room for the open sidebar");
  assert.doesNotMatch(main, /transition:[^;]*(margin|width|padding)\s+\d/, "the page itself never animates its size");
  const collapsed = block('.shell:has(.sidebar[data-collapsed="true"]) .main');
  assert.match(collapsed, /margin-left:\s*calc\(var\(--sidebar-w-collapsed\)/);
  // The page's room changes at once both ways; useSlideWithSidebar then slides it there with a transform.
  assert.doesNotMatch(collapsed, /transition/);
  assert.match(read("src/App.tsx"), /useSlideWithSidebar\(mainRef\)/);
  assert.match(read("src/lib/useSlideWithSidebar.ts"), /SIDEBAR_MS = 260/);
  assert.match(side, /transition:\s*width 260ms/, "the slide and the sidebar take the same time");
});

// The chat panel is a grid: header, messages, composer, footnote. The messages row must be the one that stretches;
// with a stale extra row the composer took the space and grew to a tall empty box.
test("the chat panel's grid rows match its parts, and only the message list stretches", () => {
  const rows = block(".agent-panel").match(/grid-template-rows:\s*([^;]+);/)[1].trim();
  const tracks = rows.match(/minmax\([^)]*\)|\S+/g);
  const parts = (read("src/agent/AgentAssistant.tsx").match(/<aside className="agent-panel"[\s\S]*?<\/aside>/)[0]
    .match(/^ {10}<(header|div|form|p)\b/gm) ?? []).length;
  assert.equal(tracks.length, parts, `${tracks.length} rows (${rows}) for ${parts} parts`);
  assert.equal(tracks.filter((t) => /1fr/.test(t)).length, 1);
  assert.match(tracks[1], /1fr/, "the message list (second part) stretches");
});

test("dialogs keep their header and footer fixed and scroll only the middle", () => {
  // Every dialog (src/components/Modal.tsx) is one column: header, a scrolling body, footer.
  assert.match(block(".ui-modal"), /overflow:\s*hidden/);
  assert.match(block(".ui-modal-panel"), /max-height:\s*calc\(100dvh - \d+px\)/);
  const scroll = block(".ui-modal-body");
  assert.match(scroll, /overflow-y:\s*auto/);
  assert.match(scroll, /min-height:\s*0/);
  assert.match(block(".reply-note"), /var\(--signal-subtle\)/, "a caution is amber, the only colour besides blue");
  // In a scrolling flex column, items shrink to fit unless told not to; the quoted email was squashed in half.
  assert.match(block(".ui-modal-body > *"), /flex-shrink:\s*0/);
});

test("the email table skeleton keeps its shapes off the card's edges wherever it's placed", () => {
  // It sits inside the real table card (no padding of its own) on the All email page, so it pads itself.
  assert.match(block(".skeleton-table"), /padding:\s*\d+px \d+px/);
  assert.match(block(".skeleton-table-card"), /padding:\s*0/);
});

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
