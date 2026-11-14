import { CATALOG, GRID_COLS } from "../../shared/spec.js";
import type { GridItem, Widget, WidgetType } from "../lib/api";

export const ROW_HEIGHT = 24;
export const GAP = 16;
export const COLLAPSED_H = 2;
export type Size = { w: number; h: number };

/** Only persist coordinates, never grid-library flags or temporary drop placeholders. */
export function cleanLayout(layout: readonly GridItem[]): GridItem[] {
  return layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
}

export function overlaps(a: GridItem, b: GridItem) {
  return a.i !== b.i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Preserve empty space. Resolve only overlaps, with the edited card taking priority. */
export function settleLayout(layout: readonly GridItem[], cols = GRID_COLS, priority?: string): GridItem[] {
  const placed: GridItem[] = [];
  const ordered = priority ? [...layout.filter((l) => l.i === priority), ...layout.filter((l) => l.i !== priority)] : layout;
  for (const source of ordered) {
    const w = Math.min(cols, Math.max(1, Math.round(source.w)));
    const item = { i: source.i, w, h: Math.max(2, Math.min(30, Math.round(source.h))),
      x: Math.max(0, Math.min(cols - w, Math.round(source.x))), y: Math.max(0, Math.min(470, Math.round(source.y))) };
    let hit: GridItem | undefined;
    while ((hit = placed.find((other) => overlaps(item, other)))) item.y = hit.y + hit.h;
    placed.push(item);
  }
  return layout.map((l) => placed.find((p) => p.i === l.i)!);
}

/** Keep saved positions intact, adding only missing widgets to free space. */
export function normalizeLayout(widgets: Widget[], layout: readonly GridItem[]): GridItem[] {
  const ids = new Set(widgets.map((w) => w.id));
  const result = settleLayout(cleanLayout(layout.filter((l) => ids.has(l.i))));
  for (const widget of widgets) if (!result.some((l) => l.i === widget.id)) {
    const { w, h } = CATALOG[widget.type].size;
    result.push(findSpace(result, widget.id, { w, h }));
  }
  return result;
}

export function findSpace(layout: readonly GridItem[], id: string, size: Size): GridItem {
  const w = Math.min(GRID_COLS, size.w);
  const bottom = Math.max(0, ...layout.map((l) => l.y + l.h));
  for (let y = 0; y <= bottom; y++) for (let x = 0; x <= GRID_COLS - w; x++) {
    const item = { i: id, x, y, w, h: size.h };
    if (!layout.some((other) => overlaps(item, other))) return item;
  }
  return { i: id, x: 0, y: bottom, w, h: size.h };
}

export function orderOf(layout: readonly GridItem[]) {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.i);
}

/** Narrow screens get readable widths. Desktop coordinates remain the source of truth. */
export function responsiveLayout(layout: readonly GridItem[], cols: number): GridItem[] {
  if (cols === GRID_COLS) return cleanLayout(layout);
  const projected = [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => ({ ...l,
    x: cols === 2 ? 0 : Math.floor(l.x * cols / GRID_COLS),
    w: cols === 2 ? 2 : Math.max(2, Math.round(l.w * cols / GRID_COLS)),
  }));
  return settleLayout(projected, cols);
}

/** Apply only edited responsive positions; merely changing screen width never changes a saved layout. */
export function applyGridChange(canonical: readonly GridItem[], before: readonly GridItem[], after: readonly GridItem[], cols: number, priority?: string): GridItem[] {
  if (cols === GRID_COLS) return settleLayout(cleanLayout(after), GRID_COLS, priority);
  const result = canonical.map((item) => {
    const prev = before.find((l) => l.i === item.i);
    const next = after.find((l) => l.i === item.i);
    if (!prev || !next) return { ...item };
    return { ...item,
      x: next.x === prev.x ? item.x : Math.round(next.x * GRID_COLS / cols),
      y: next.y === prev.y ? item.y : next.y,
      w: next.w === prev.w ? item.w : Math.round(next.w * GRID_COLS / cols),
      h: next.h,
    };
  });
  return settleLayout(result, GRID_COLS, priority);
}

export function nextId(type: WidgetType, taken: Set<string>) {
  let n = 1;
  while (taken.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}
