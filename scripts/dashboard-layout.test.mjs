import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SPEC, DashboardSpec } from '../shared/spec.js';
import { applyGridChange, cleanLayout, findSpace, normalizeLayout, overlaps, responsiveLayout, settleLayout } from '../src/dashboard/layout.ts';

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
