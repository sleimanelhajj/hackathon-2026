// PDF page breaks for an exported dashboard (src/dashboard/exportLayout.ts): a page ends between widgets, never
// through one, unless a single widget is taller than a whole page.
import { expect, test } from "vitest";
import { pageSlices } from "../src/dashboard/exportLayout";

test("a short board fits on one page", () => {
  expect(pageSlices([{ top: 0, bottom: 300 }], 320, 500)).toEqual([{ start: 0, end: 320 }]);
});

test("a page ends in the gap above the widget that would be cut", () => {
  // Widgets at 0-200, 220-420 and 440-640; a page holds 500, so the third widget moves to page two.
  const widgets = [{ top: 0, bottom: 200 }, { top: 220, bottom: 420 }, { top: 440, bottom: 640 }];
  expect(pageSlices(widgets, 660, 500)).toEqual([{ start: 0, end: 430 }, { start: 430, end: 660 }]);
});

test("side-by-side widgets: the break goes below both of them", () => {
  const widgets = [{ top: 0, bottom: 300 }, { top: 0, bottom: 450 }, { top: 470, bottom: 700 }];
  expect(pageSlices(widgets, 700, 500)).toEqual([{ start: 0, end: 460 }, { start: 460, end: 700 }]);
});

test("a widget taller than a page is cut, because nothing else fits", () => {
  expect(pageSlices([{ top: 0, bottom: 1200 }], 1200, 500)).toEqual([{ start: 0, end: 500 }, { start: 500, end: 1000 }, { start: 1000, end: 1200 }]);
});

// growLayout: in the export copy, a widget whose list scrolls on screen grows to show every row; widgets below it in
// the same columns move down by as much, so nothing overlaps and the gaps stay the same.
import { exportScale, growLayout } from "../src/dashboard/exportLayout";

test("a growing widget pushes down only the widgets under it", () => {
  const boxes = [
    { top: 0, bottom: 200, left: 0, right: 500, extra: 300 },   // Top products: 300px of rows hidden
    { top: 0, bottom: 200, left: 520, right: 1000, extra: 0 },  // Top customers, beside it
    { top: 220, bottom: 400, left: 0, right: 500, extra: 0 },   // under Top products
    { top: 220, bottom: 400, left: 520, right: 1000, extra: 0 }, // under Top customers
  ];
  expect(growLayout(boxes)).toEqual([
    { top: 0, bottom: 500 }, { top: 0, bottom: 200 }, { top: 520, bottom: 700 }, { top: 220, bottom: 400 },
  ]);
});

test("a wide widget under two growing ones moves below the taller of them, and pushes are passed down", () => {
  const boxes = [
    { top: 0, bottom: 100, left: 0, right: 500, extra: 50 },
    { top: 0, bottom: 100, left: 500, right: 1000, extra: 120 },
    { top: 120, bottom: 200, left: 0, right: 1000, extra: 30 },
    { top: 220, bottom: 300, left: 0, right: 300, extra: 0 },
  ];
  expect(growLayout(boxes)).toEqual([
    { top: 0, bottom: 150 }, { top: 0, bottom: 220 }, { top: 240, bottom: 350 }, { top: 370, bottom: 450 },
  ]);
});

test("the image stays inside what browsers can draw: sharp (2x) for normal boards, less for huge ones", () => {
  expect(exportScale(1200, 2000)).toBe(2);
  expect(exportScale(1400, 9000)).toBeLessThan(2);
  expect(1400 * 9000 * exportScale(1400, 9000) ** 2).toBeLessThanOrEqual(16e6 + 1);
  expect(30000 * exportScale(800, 30000)).toBeLessThanOrEqual(16000);
});
