import type { Layout, LayoutItem } from "react-grid-layout";
import { CATALOG, GRID_COLS } from "../../shared/spec.js";
import type { GridItem, Widget } from "../lib/api";

// Container widths (not window widths). lg is low enough that the grid stays editable
// next to the widget panel on a 1280px laptop.
export const BREAKPOINTS = { lg: 720, md: 480, sm: 0 } as const;
export const COLS = { lg: GRID_COLS, md: 6, sm: 2 } as const;
export type Breakpoint = keyof typeof BREAKPOINTS;

export const ROW_HEIGHT = 24;
export const MARGIN: [number, number] = [16, 16];
export const COLLAPSED_H = 2;

const byReadingOrder = (a: GridItem, b: GridItem) => a.y - b.y || a.x - b.x;

/** Simple row packing used to derive narrower layouts from the saved desktop layout. */
function pack(items: GridItem[], cols: number, widthOf: (it: GridItem) => number): GridItem[] {
  const out: GridItem[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  // Stretch the last card of a row so rows never end with an empty gap.
  const fillRow = () => {
    const last = out[out.length - 1];
    if (last && x < cols) last.w += cols - x;
  };
  for (const it of [...items].sort(byReadingOrder)) {
    const w = Math.min(cols, widthOf(it));
    if (x + w > cols) {
      fillRow();
      y += rowH;
      x = 0;
      rowH = 0;
    }
    out.push({ ...it, x, y, w });
    x += w;
    rowH = Math.max(rowH, it.h);
  }
  fillRow();
  return out;
}

/** Only the desktop layout is stored; tablet and phone layouts are derived from it. */
export function deriveLayouts(lg: GridItem[], widgets: Widget[], collapsed: Record<string, boolean>, editing: boolean) {
  const typeOf = new Map(widgets.map((w) => [w.id, w.type]));
  const isCollapsed = (id: string) => !editing && !!collapsed[id];
  // Folded widgets shrink to their header before any packing happens.
  const base = lg.map((it) => (isCollapsed(it.i) ? { ...it, h: COLLAPSED_H } : it));
  const withLimits = (items: GridItem[], cols: number): Layout =>
    items.map((it): LayoutItem => {
      const t = typeOf.get(it.i);
      const size = t ? CATALOG[t].size : undefined;
      const folded = isCollapsed(it.i);
      return {
        ...it,
        minW: size ? Math.min(size.minW, cols) : undefined,
        minH: folded ? COLLAPSED_H : size?.minH,
        maxH: folded ? COLLAPSED_H : (size as { maxH?: number } | undefined)?.maxH,
      };
    });
  return {
    lg: withLimits(base, COLS.lg),
    // Tablet: wide cards go full width, the rest take half.
    md: withLimits(pack(base, COLS.md, (it) => (it.w > 6 ? COLS.md : 3)), COLS.md),
    // Phone: small number cards pair up, everything else is full width.
    sm: withLimits(pack(base, COLS.sm, (it) => (it.w <= 3 ? 1 : COLS.sm)), COLS.sm),
  };
}

/** Strip library-only fields so the layout matches the saved schema. */
export function toGridItems(layout: Layout): GridItem[] {
  return layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
}

export function nextId(type: string, taken: Set<string>) {
  let n = 1;
  while (taken.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

export function bottomOf(layout: GridItem[]) {
  return layout.reduce((m, it) => Math.max(m, it.y + it.h), 0);
}
