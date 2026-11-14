import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SPEC, DashboardSpec } from '../shared/spec.js';
import { applyGridChange, cleanLayout, collapseLayout, findSpace, normalizeLayout, overlaps, responsiveLayout, settleLayout } from '../src/dashboard/layout.ts';

const noOverlaps = (layout, cols = 12) => {
  for (const item of layout) {
    assert.ok(item.x >= 0 && item.x + item.w <= cols);
    for (const other of layout) assert.equal(overlaps(item, other), false, `${item.i} overlaps ${other.i}`);
  }
};

test('saved free positions and empty space survive normalization and serialization', () => {
  // Park one card below everything, leaving a gap: the gap must survive.
  const bottom = Math.max(...DEFAULT_SPEC.layout.map((item) => item.y + item.h));
  const layout = DEFAULT_SPEC.layout.map((item) => item.i === 'stat-awaiting-you' ? { ...item, x: 0, y: bottom + 3 } : item);
  const draft = normalizeLayout(DEFAULT_SPEC.widgets, layout);
  assert.deepEqual(draft, layout);
  const saved = DashboardSpec.parse({ ...DEFAULT_SPEC, layout: cleanLayout(draft) });
  assert.deepEqual(normalizeLayout(saved.widgets, saved.layout), layout);
});

test('a moved card owns its destination and only colliding cards move away', () => {
  const layout = [{ i: 'a', x: 0, y: 0, w: 4, h: 3 }, { i: 'b', x: 0, y: 0, w: 4, h: 6 }, { i: 'c', x: 8, y: 20, w: 4, h: 3 }];
  const next = settleLayout(layout, 12, 'a');
  assert.equal(next[0].y, 0);
  assert.equal(next[1].y, 3);
  assert.deepEqual(next[2], layout[2]);
  noOverlaps(next);
});

test('adding chooses a real empty slot instead of overlapping a widget', () => {
  const layout = [{ i: 'a', x: 0, y: 0, w: 6, h: 9 }];
  const item = findSpace(layout, 'b', { w: 6, h: 3 });
  assert.deepEqual(item, { i: 'b', x: 6, y: 0, w: 6, h: 3 });
  noOverlaps([...layout, item]);
});

test('phone and tablet projection never mutate desktop coordinates', () => {
  const original = structuredClone(DEFAULT_SPEC.layout);
  for (const cols of [2, 6, 12]) {
    const display = responsiveLayout(original, cols);
    noOverlaps(display, cols);
    assert.deepEqual(applyGridChange(original, display, display, cols), original);
  }
  assert.deepEqual(original, DEFAULT_SPEC.layout);
});

test('resize persists dimensions, removes library flags and resolves collisions', () => {
  const before = DEFAULT_SPEC.layout;
  const after = before.map((item) => item.i === 'stat-awaiting-you' ? { ...item, h: 6, minH: 3, moved: true } : item);
  const result = applyGridChange(before, before, after, 12, 'stat-awaiting-you');
  assert.equal(result[0].h, 6);
  assert.equal('moved' in result[0], false);
  noOverlaps(result);
  assert.equal(DashboardSpec.safeParse({ ...DEFAULT_SPEC, layout: result }).success, true);
});

// ---- collapsing a widget frees its space (view mode only; the saved layout never changes) ----
const at = (layout, id) => layout.find((item) => item.i === id);

test('collapsing a card pulls the card below it up', () => {
  const layout = [{ i: 'a', x: 0, y: 0, w: 12, h: 8 }, { i: 'b', x: 0, y: 8, w: 12, h: 4 }];
  const out = collapseLayout(layout, { a: true }, 2);
  assert.deepEqual(at(out, 'a'), { i: 'a', x: 0, y: 0, w: 12, h: 2 });
  assert.equal(at(out, 'b').y, 2);
});

test('only cards under the collapsed one move; the other column stays put', () => {
  const layout = [
    { i: 'a', x: 0, y: 0, w: 6, h: 6 }, { i: 'c', x: 6, y: 0, w: 6, h: 10 }, { i: 'b', x: 0, y: 6, w: 6, h: 4 },
  ];
  const out = collapseLayout(layout, { a: true }, 2);
  assert.equal(at(out, 'b').y, 2);
  assert.deepEqual(at(out, 'c'), layout[1]);
  noOverlaps(out);
});

test('a full-width card never slides under a tall neighbour', () => {
  const layout = [
    { i: 'a', x: 0, y: 0, w: 6, h: 6 }, { i: 'c', x: 6, y: 0, w: 6, h: 10 }, { i: 'd', x: 0, y: 10, w: 12, h: 4 },
  ];
  const out = collapseLayout(layout, { a: true }, 2);
  assert.equal(at(out, 'd').y, 10);
  noOverlaps(out);
});

test('several collapsed cards in a column add up', () => {
  const layout = [{ i: 'a', x: 0, y: 0, w: 12, h: 8 }, { i: 'b', x: 0, y: 8, w: 12, h: 6 }, { i: 'c', x: 0, y: 14, w: 12, h: 4 }];
  const out = collapseLayout(layout, { a: true, b: true }, 2);
  assert.deepEqual(out.map((item) => [item.i, item.y, item.h]), [['a', 0, 2], ['b', 2, 2], ['c', 4, 4]]);
});

test('gaps the user left on purpose are kept, and nothing collapsed means nothing moves', () => {
  const layout = [{ i: 'a', x: 0, y: 0, w: 6, h: 4 }, { i: 'b', x: 6, y: 12, w: 6, h: 4 }];
  assert.deepEqual(collapseLayout(layout, {}, 2), layout);
  assert.equal(at(collapseLayout(layout, { a: true }, 2), 'b').y, 12); // not under a, so it stays
});

test('the default dashboard stays overlap-free whichever cards are collapsed', () => {
  const ids = DEFAULT_SPEC.layout.map((item) => item.i);
  for (let mask = 1; mask < 64; mask++) {
    const collapsed = Object.fromEntries(ids.filter((_, i) => mask & (1 << (i % 6)) && i % 3 === 0).map((id) => [id, true]));
    noOverlaps(collapseLayout(DEFAULT_SPEC.layout, collapsed, 2));
  }
});

test("moves chain: a card follows the cards above it even when it is not under a folded card itself", () => {
  // The layout from the bug report: Who-emails-you-most, Contacts and Attachments folded.
  const layout = [
    { i: "activity", x: 0, y: 31, w: 8, h: 8 }, { i: "hours", x: 8, y: 31, w: 4, h: 8 },
    { i: "people", x: 6, y: 39, w: 6, h: 7 },
    { i: "contacts", x: 0, y: 46, w: 7, h: 11 }, { i: "attachments", x: 7, y: 46, w: 5, h: 11 },
    { i: "labels", x: 0, y: 57, w: 6, h: 7 },
  ];
  const out = collapseLayout(layout, { people: true, contacts: true, attachments: true }, 2);
  assert.equal(at(out, "people").y, 39);
  assert.equal(at(out, "contacts").y, 41);
  assert.equal(at(out, "attachments").y, 41);
  assert.equal(at(out, "labels").y, 43, "no empty band between Contacts and Unread by label");
  noOverlaps(out);
});

test("a gap the user left between two cards is kept when the upper one folds", () => {
  const layout = [{ i: "a", x: 0, y: 0, w: 12, h: 8 }, { i: "b", x: 0, y: 11, w: 12, h: 4 }];
  assert.equal(at(collapseLayout(layout, { a: true }, 2), "b").y, 5);
});
