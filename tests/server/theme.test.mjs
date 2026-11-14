// The visual theme (src/index.css): white glass panes over soft coloured light, dark-blue primary, a calm amber kept
// for warnings only — and still readable (WCAG AA contrast) and usable without transparency (decision #35).
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("../../src/index.css", import.meta.url), "utf8");
const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
const token = (name) => {
  const m = root.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `token --${name} is defined`);
  return m[1].trim();
};

// ---- colour maths ----
function rgba(value) {
  const v = value.trim();
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = v.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error(`not a plain colour: ${value}`);
}
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
function hsl([r, g, b]) {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}
const color = (name) => rgba(token(name));
// What text actually sits on: a glass pane over the lightest and darkest part of the ground, and over the darkest
// ground with each coloured glow at full strength behind it (the worst cases).
const GLOWS = ["glow-blue", "glow-lavender", "glow-pink"];
const grounds = () => [
  ...["bg", "bg-deep"].map((g) => over(color("glass"), color(g))),
  ...GLOWS.map((g) => over(color("glass"), over(color(g), color("bg-deep")))),
];

// ---- palette ----
test("primary is a dark blue", () => {
  const { h, s, l } = hsl(color("accent"));
  assert.ok(h >= 215 && h <= 235, `hue ${h.toFixed(0)} is blue, not sky or violet`);
  assert.ok(l <= 0.4, `lightness ${l.toFixed(2)} is dark`);
  assert.ok(s >= 0.4, `saturation ${s.toFixed(2)} reads as blue, not grey`);
});

test("panes are white", () => {
  const { l } = hsl(color("surface-solid"));
  assert.ok(l >= 0.98, `--surface-solid lightness ${l.toFixed(2)}`);
});

test("the base ground is light and cool; the colour comes from the glows", () => {
  for (const name of ["bg", "bg-deep"]) {
    const { s, l } = hsl(color(name));
    assert.ok(s <= 0.6, `--${name} saturation ${s.toFixed(2)} stays soft`);
    assert.ok(l >= 0.82 && l <= 0.97, `--${name} lightness ${l.toFixed(2)} is light grey`);
  }
  assert.ok(lum(color("bg-deep")) < lum(color("bg")), "the grey deepens down the page so the glass has something to sit on");
});

test("warnings are a calm amber, the only colour besides blue", () => {
  const { h, s } = hsl(color("signal"));
  assert.ok(h >= 25 && h <= 45, `hue ${h.toFixed(0)} is amber`);
  assert.ok(s >= 0.6, "it is saturated enough to notice");
});

// ---- glass ----
test("the glass token is translucent white", () => {
  const [r, g, b, a] = color("glass");
  assert.ok(r >= 240 && g >= 240 && b >= 240, "white");
  assert.ok(a >= 0.4 && a <= 0.85, `alpha ${a} lets the colour through; contrast is checked separately`);
});

// Speed (2026-11-14): panes sit on the page's soft light, which is already smooth, so a backdrop blur there costs a
// full re-blur on every scroll, drag and resize frame and changes nothing you can see. Only layers that float over
// other content (menus, the widget settings box, dialogs) blur what is behind them.
const PANES = [".sidebar", ".widget", ".panel", ".surface", ".callout", ".skeleton", ".side-panel-slot"];
const FLOATING = [".modal", ".widget-config", ".select-menu"];
const ruleOf = (sel) => {
  const m = css.match(new RegExp(`(^|\\n)${sel.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `${sel} has a rule`);
  return m[2];
};

test("panes are glass: translucent white with the bright edge", () => {
  for (const sel of PANES) {
    const r = ruleOf(sel);
    assert.match(r, /background:\s*(linear-gradient\(90deg, )?var\(--glass/, `${sel} uses the glass background`);
    assert.match(r, /border:\s*1px solid var\(--glass-edge\)/, `${sel} has the glass edge`);
  }
});

test("panes don't re-blur the page on every frame (that is what made scrolling and dragging lag)", () => {
  for (const sel of PANES) assert.doesNotMatch(ruleOf(sel), /backdrop-filter/, `${sel} has no backdrop blur`);
});

test("floating layers over content are frosted glass", () => {
  for (const sel of FLOATING) {
    const r = ruleOf(sel);
    assert.match(r, /background:\s*var\(--glass-strong\)/, `${sel} uses strong glass`);
    assert.match(r, /backdrop-filter:\s*var\(--blur\)/, `${sel} blurs what is behind it`);
    assert.match(r, /-webkit-backdrop-filter:\s*var\(--blur\)/, `${sel} also works in Safari`);
  }
});

test("the page background is painted once, not on every scroll", () => {
  assert.doesNotMatch(ruleOf("body"), /\bfixed\b/, "no background-attachment: fixed on body (forces a full repaint per scroll frame)");
  assert.match(ruleOf("body::before"), /position:\s*fixed/);
  assert.match(ruleOf("body::before"), /will-change:\s*transform/, "the light gets its own compositor layer");
});

test("people who reduce transparency get solid panes", () => {
  const block = css.match(/@media \(prefers-reduced-transparency: reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, "has a prefers-reduced-transparency block");
  assert.match(block[1], /--glass:\s*var\(--surface-solid\)/);
  assert.match(block[1], /--blur:\s*none/);
});

test("drifting clouds stop for people who reduce motion", () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(block);
  assert.match(block[1], /animation:\s*none/);
});

// ---- readability ----
test("body and secondary text pass AA (4.5:1) on glass over any part of the sky", () => {
  for (const ground of grounds()) {
    assert.ok(contrast(color("text"), ground) >= 7, "main text ≥ 7:1");
    for (const name of ["text-2", "text-3", "accent-text", "danger", "signal-text"]) {
      const c = contrast(color(name), ground);
      assert.ok(c >= 4.5, `--${name} is ${c.toFixed(2)}:1`);
    }
  }
});

test("buttons and tags pass AA", () => {
  assert.ok(contrast([255, 255, 255, 1], color("accent")) >= 4.5, "white on the primary button");
  assert.ok(contrast([255, 255, 255, 1], color("accent-hover")) >= 4.5, "white on the hovered primary button");
  for (const [fg, bg] of [["accent-text", "accent-subtle"], ["signal-text", "signal-subtle"], ["danger", "danger-subtle"], ["success", "success-subtle"], ["inferred", "inferred-subtle"]]) {
    const c = contrast(color(fg), color(bg));
    assert.ok(c >= 4.5, `--${fg} on --${bg} is ${c.toFixed(2)}:1`);
  }
});

test("warnings use the amber family", () => {
  assert.equal(token("warning"), "var(--signal-text)");
  assert.equal(token("warning-subtle"), "var(--signal-subtle)");
});

// ---- review findings (finish review, 2026-11-14) ----
const rule = (sel) => {
  const m = css.match(new RegExp(`(^|\\n)${sel.replace(/[.[\]"=()]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `${sel} has a rule`);
  return m[2];
};

test("the clouds paint above the sky gradient (body is its own stacking context)", () => {
  assert.match(rule("body"), /isolation:\s*isolate/);
});

test("at least one cloud sits in the lower, bluer half of the sky so the glass has something to frost", () => {
  const clouds = rule("body::before");
  const ys = [...clouds.matchAll(/at \d+% (\d+)%/g)].map((m) => +m[1]);
  assert.ok(ys.some((y) => y >= 50 && y < 100), `cloud centres at ${ys.join(", ")}%`);
});

test("loading skeletons are glass, not an opaque old-palette stripe", () => {
  const s = rule(".skeleton");
  assert.doesNotMatch(s, /#[0-9a-f]{3,6}/i);
  assert.match(s, /var\(--glass/);
});

test("the closest panes keep the white top-edge highlight", () => {
  assert.match(token("shadow-lift"), /^inset 0 1px 0 rgba\(255, 255, 255/);
  assert.match(rule(".modal"), /border:\s*1px solid var\(--glass-edge\)/);
});

test("the 'Rule' tag uses tokens, readable and in the blue family", () => {
  assert.match(rule('.tag[data-tone="derived"]'), /background:\s*var\(--derived-subtle\);\s*color:\s*var\(--derived\)/);
  const { h } = hsl(color("derived"));
  assert.ok(h >= 200 && h <= 235, `hue ${h.toFixed(0)}`);
  for (const ground of grounds()) assert.ok(contrast(color("derived"), over(color("derived-subtle"), ground)) >= 4.5);
});

test("no old-palette hex values remain outside :root (brand logos excepted)", () => {
  const body = css.replace(/:root\s*\{[\s\S]*?\n\}/, "");
  const old = ["#6f6f82", "#f1b8b5", "#fdeceb", "#fafafc", "#1d4ed8", "#c7cbff", "#4f46e5"];
  for (const hex of old) assert.ok(!body.toLowerCase().includes(hex) && !body.includes(hex.replace("#", "%23")), `${hex} is gone`);
});

test("edit mode has one border rule, not two that cancel each other", () => {
  assert.equal([...css.matchAll(/\n\.widget\[data-editing="true"\]\s*\{[^}]*border-color/g)].length, 1);
});

// ---- visible glass (decision #38): the frosting must have something to frost, and show it ----
test("panes are clearly see-through, floating layers frosted", () => {
  const [, , , a] = color("glass");
  assert.ok(a >= 0.4 && a <= 0.55, `--glass alpha ${a}`);
  assert.match(token("blur"), /blur\((1[6-9]|2\d|3[0-2])px\)/, "a clear frosting that stays cheap to draw");
});

test("every pane carries the glass sheen", () => {
  assert.match(token("glass-sheen"), /^linear-gradient\(/);
  for (const sel of [".sidebar", ".widget", ".panel", ".surface"]) {
    const m = css.match(new RegExp(`(^|\\n)${sel.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
    assert.match(m[2], /background-image:\s*var\(--glass-sheen\)/, `${sel} has the sheen`);
  }
});

test("behind the glass is soft coloured light: blue, lavender and pink glows (decision #39)", () => {
  const ranges = { "glow-blue": [205, 235], "glow-lavender": [240, 275], "glow-pink": [310, 345] };
  for (const [name, [lo, hi]] of Object.entries(ranges)) {
    const c = color(name);
    const { h, s } = hsl(c);
    assert.ok(h >= lo && h <= hi, `--${name} hue ${h.toFixed(0)}`);
    assert.ok(s >= 0.5, `--${name} is colourful`);
    assert.ok(c[3] >= 0.25 && c[3] <= 0.5, `--${name} alpha ${c[3]}: visible, still soft`);
  }
  const glows = css.match(/(^|\n)body::before\s*\{([^}]*)\}/)[2];
  for (const name of Object.keys(ranges)) assert.match(glows, new RegExp(`var\\(--${name}\\)`));
  const colors = [...glows.matchAll(/rgba\(\d+, \d+, \d+, [\d.]+\)|var\(--[a-z-]+\)/g)].map((m) => m[0]);
  for (const c of colors) assert.ok(/^var\(--(glow-(blue|lavender|pink)|bg|bg-deep)\)$/.test(c) || /^rgba\(255, 255, 255,/.test(c), `unexpected glow colour ${c}`);
});

test("the sidebar floats as its own rounded glass panel, with space around it", () => {
  const side = css.match(/(^|\n)\.sidebar\s*\{([^}]*)\}/)[2];
  assert.match(side, /margin:\s*\d+px/);
  assert.match(side, /border-radius:\s*var\(--radius-xl\)/);
  assert.match(side, /border:\s*1px solid var\(--glass-edge\)/);
  assert.match(side, /height:\s*calc\(100vh - \d+px\)/);
});

test("banners are glass too", () => {
  const callout = css.match(/(^|\n)\.callout\s*\{([^}]*)\}/)[2];
  assert.match(callout, /background-image:\s*var\(--glass-sheen\)/);
  assert.match(callout, /border:\s*1px solid var\(--glass-edge\)/);
});

// ---- bans from the design floor ----
test("no thick coloured side borders on cards, rows or callouts", () => {
  // A resize-corner arrow (border-right + border-bottom on one tiny element) is a glyph, not a side stripe.
  const lines = css.split("\n").filter((l) => !(/border-right:/.test(l) && /border-bottom:/.test(l)));
  const bad = lines.flatMap((l) => [...l.matchAll(/border-(left|right):\s*([2-9]|\d{2,})(\.\d+)?px/g)].map((m) => m[0]));
  assert.deepEqual(bad, []);
});
