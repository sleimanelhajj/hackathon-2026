// Where a PDF report's pages end (decision #61). Widgets that overlap vertically are merged into blocks; a page ends in
// the middle of a gap between blocks, so no card is cut in half. Only a block taller than a whole page gets split.

export type Range = { top: number; bottom: number };
export type Slice = { start: number; end: number };

/** Page slices (same units as the input) for a board `total` tall, `area` per page. */
export function pageSlices(widgets: Range[], total: number, area: number): Slice[] {
  if (area <= 0 || total <= 0) return [{ start: 0, end: Math.max(0, total) }];
  // Gaps between merged widget blocks: their midpoints are the safe places to break.
  const breaks: number[] = [];
  let blockEnd = -Infinity;
  for (const w of [...widgets].sort((a, b) => a.top - b.top)) {
    if (w.top > blockEnd && blockEnd > -Infinity) breaks.push((blockEnd + w.top) / 2);
    blockEnd = Math.max(blockEnd, w.bottom);
  }
  const slices: Slice[] = [];
  let start = 0;
  while (total - start > area) {
    const limit = start + area;
    let end = limit;
    for (const b of breaks) if (b > start && b <= limit) end = b; // breaks are ascending: keep the last that fits
    slices.push({ start, end });
    start = end;
  }
  slices.push({ start, end: total });
  return slices;
}

/** Each widget's vertical extent inside `root`, in CSS pixels from its top edge. */
export function widgetRanges(root: HTMLElement): Range[] {
  const origin = root.getBoundingClientRect().top;
  return [...root.querySelectorAll<HTMLElement>(".grid-stack-item, .widget, .callout, .surface")].map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top - origin, bottom: r.bottom - origin };
  }).filter((r) => r.bottom > r.top);
}

export type Box = Range & { left: number; right: number; extra: number };

/**
 * New vertical extents when widgets grow by `extra` (the rows their list hides behind a scrollbar on screen). Each
 * widget moves down by the largest push of any widget above it in the same columns, so nothing overlaps and the gaps
 * stay as they were. Widgets side by side don't move each other.
 */
export function growLayout(boxes: Box[]): Range[] {
  const out: Range[] = new Array(boxes.length);
  const placed: number[] = [];
  for (const i of boxes.map((_, i) => i).sort((a, b) => boxes[a].top - boxes[b].top)) {
    const b = boxes[i];
    let shift = 0;
    for (const j of placed) {
      const a = boxes[j];
      const above = a.bottom <= b.top + 0.5;
      const sameColumns = a.left < b.right - 0.5 && b.left < a.right - 0.5;
      if (above && sameColumns) shift = Math.max(shift, out[j].bottom - a.bottom);
    }
    const top = b.top + shift;
    out[i] = { top, bottom: top + (b.bottom - b.top) + Math.max(0, b.extra) };
    placed.push(i);
  }
  return out;
}

/** Image pixels per CSS pixel: 2 (sharp) unless the board is so big the browser couldn't draw it (side ≤ 16000 px, area ≤ 16 MP). */
export function exportScale(width: number, height: number): number {
  const w = Math.max(1, width), h = Math.max(1, height);
  return Math.min(2, 16000 / Math.max(w, h), Math.sqrt(16e6 / (w * h)));
}
