import { getDb } from "./db.js";
import { BOARDS, DashboardSpec, Widget } from "../shared/spec.js";

// One saved layout per dashboard ("board"): "default" is the email dashboard, "sales" the Sales page.
// Each board only holds widgets from its own catalogue. Feature 6 (RBAC) adds per-person copies.

/** Throws unless `board` exists and every widget in `spec` belongs on it. */
export function checkBoard(board, spec) {
  const def = BOARDS[board];
  if (!def) throw new Error(`Unknown dashboard "${board}".`);
  const foreign = (spec?.widgets ?? []).map((w) => w.type).filter((type) => !(type in def.catalog));
  if (foreign.length) throw new Error(`These widgets can't go on this dashboard: ${[...new Set(foreign)].join(", ")}.`);
  return def;
}

/**
 * Saved layouts can contain widgets whose type or rule was later removed from the catalogue
 * (e.g. the keyword rules dropped on 2026-11-14). Drop those and their grid slots instead of
 * failing, so old dashboards keep loading.
 */
function sanitize(widgets = [], layout = []) {
  const valid = widgets.filter((w) => Widget.safeParse(w).success);
  const ids = new Set(valid.map((w) => w.id));
  return { widgets: valid, layout: layout.filter((l) => ids.has(l.i)) };
}

function publicSpec(doc) {
  const { widgets, layout } = sanitize(doc.widgets, doc.layout);
  return {
    id: doc._id,
    title: doc.title,
    widgets,
    layout,
    version: doc.version,
    canUndo: Boolean(doc.previous),
    updatedAt: doc.updatedAt,
  };
}

export async function getDashboard(board = "default") {
  const def = checkBoard(board, null);
  const col = getDb().collection("dashboards");
  let doc = await col.findOne({ _id: board });
  if (!doc) {
    doc = { _id: board, ...structuredClone(def.spec), version: 1, previous: null, updatedAt: new Date() };
    await col.insertOne(doc);
  }
  return publicSpec(doc);
}

export class ConflictError extends Error {}

/** Validates and saves a new version, keeping the previous one for undo. */
export async function saveDashboard(body, board = "default") {
  const parsed = DashboardSpec.safeParse(body);
  if (!parsed.success) throw new Error(`Invalid dashboard: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  checkBoard(board, parsed.data);
  const col = getDb().collection("dashboards");
  const current = await col.findOne({ _id: board });
  if (current && typeof body.version === "number" && body.version !== current.version) {
    throw new ConflictError("This dashboard changed somewhere else. Reload to get the latest version.");
  }
  const previous = current ? { title: current.title, widgets: current.widgets, layout: current.layout } : null;
  const next = { ...parsed.data, version: (current?.version ?? 0) + 1, previous, updatedAt: new Date() };
  await col.updateOne({ _id: board }, { $set: next }, { upsert: true });
  return publicSpec({ _id: board, ...next });
}

export async function undoDashboard(board = "default") {
  checkBoard(board, null);
  const col = getDb().collection("dashboards");
  const current = await col.findOne({ _id: board });
  if (!current?.previous) throw new Error("Nothing to undo");
  const swapped = {
    ...current.previous,
    previous: { title: current.title, widgets: current.widgets, layout: current.layout },
    version: current.version + 1,
    updatedAt: new Date(),
  };
  await col.updateOne({ _id: board }, { $set: swapped });
  return publicSpec({ _id: board, ...swapped });
}

// ---- widgets the assistant adds (decision #48) ----
/** Grid size per chart type for assistant-made widgets. */
export const CUSTOM_SIZES = { number: { w: 4, h: 5 }, line: { w: 12, h: 9 }, bar: { w: 6, h: 10 }, table: { w: 6, h: 10 } };
const MAX_WIDGETS = 24;
const COLS = 12;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "chart";

/**
 * Adds a widget to a spec without moving anything already there: it goes in the first free spot at or below the
 * board's last row, so it lands at the bottom and small widgets made one after another sit side by side.
 * Pure; returns a new spec.
 */
export function placeWidget(spec, widget) {
  if (spec.widgets.length >= MAX_WIDGETS) throw new Error(`This dashboard is full (${MAX_WIDGETS} widgets). Remove one, then ask again.`);
  const ids = new Set(spec.widgets.map((w) => w.id));
  let id;
  do id = `ai-${slug(widget.title)}-${Math.random().toString(36).slice(2, 6)}`; while (ids.has(id));
  const size = CUSTOM_SIZES[widget.chart] ?? { w: 6, h: 9 };
  const start = spec.layout.length ? Math.max(...spec.layout.map((l) => l.y)) : 0;
  let slot = null;
  for (let y = start; !slot; y++) {
    for (let x = 0; x + size.w <= COLS && !slot; x++) {
      const candidate = { i: id, x, y, w: size.w, h: size.h };
      if (!spec.layout.some((l) => overlaps(l, candidate))) slot = candidate;
    }
  }
  return { ...spec, widgets: [...spec.widgets, { ...widget, id }], layout: [...spec.layout, slot] };
}

/** Adds an assistant-made widget to a board and saves it as a new version (so Undo removes it). */
export async function addWidgetToBoard(board, widget) {
  const current = await getDashboard(board);
  const next = placeWidget(current, widget);
  const saved = await saveDashboard({ title: current.title, widgets: next.widgets, layout: next.layout, version: current.version }, board);
  return { widget: next.widgets.at(-1), spec: saved };
}

/**
 * Removes a widget and closes the gap it leaves: widgets below it, in the columns it covered (and any chained below
 * those), move up by at most its height. Widgets elsewhere, and any free space the user left on purpose, stay put.
 * Pure; returns a new spec.
 */
export function withoutWidget(spec, id) {
  const gone = spec.layout.find((l) => l.i === id);
  const layout = spec.layout.filter((l) => l.i !== id).map((l) => ({ ...l }));
  const widgets = spec.widgets.filter((w) => w.id !== id);
  if (gone) closeGap(layout, gone);
  return { ...spec, widgets, layout };
}

/**
 * Closes the free area `gone` leaves (mutates `layout`): widgets below it, in the columns it covered (and any chained
 * below those), move up by at most its height, without overlapping anything.
 */
function closeGap(layout, gone) {
  const spans = [[gone.x, gone.x + gone.w]];
  const shares = (l) => spans.some(([a, b]) => l.x < b && a < l.x + l.w);
  for (const item of layout.filter((l) => l.y >= gone.y).sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (!shares(item)) continue;
    const start = item.y;
    while (item.y > 0 && start - item.y < gone.h) {
      const up = { ...item, y: item.y - 1 };
      if (layout.some((o) => o !== item && overlaps(o, up))) break;
      item.y -= 1;
    }
    if (item.y !== start) spans.push([item.x, item.x + item.w]);
  }
}

/** Removes one widget (the chat's "Remove" button) and closes the gap. */
export async function removeWidgetFromBoard(board, id) {
  const current = await getDashboard(board);
  if (!current.widgets.some((w) => w.id === id)) throw new Error("That widget is no longer on the dashboard.");
  const next = withoutWidget(current, id);
  return saveDashboard({ title: current.title, widgets: next.widgets, layout: next.layout, version: current.version }, board);
}

// ---- resizing a widget the user names (decision #54) ----
const MAX_H = 30; // LayoutItem allows h up to 30 rows
/** The sizes a widget type can take on a board, from its catalogue entry (12 columns wide; rows are ~40px). */
export function widgetLimits(board, type) {
  const size = BOARDS[board]?.catalog?.[type]?.size ?? {};
  return { minW: size.minW ?? 1, maxW: COLS, minH: Math.max(size.minH ?? 2, 2), maxH: Math.min(size.maxH ?? MAX_H, MAX_H) };
}

/**
 * Gives widget `id` a new width and/or height (in grid columns and rows), kept within what its type can show.
 * It keeps its top-left corner, moving left only if it would run off the grid's right edge. Widgets it now covers
 * are pushed down (and whatever they then cover, in turn); when it gets shorter, the widgets under it move up into
 * the space. Nothing else moves. Pure; returns a new spec.
 */
export function resizeWidget(spec, id, { w, h } = {}, board = "default") {
  const widget = spec.widgets.find((x) => x.id === id);
  const old = spec.layout.find((l) => l.i === id);
  if (!widget || !old) throw new Error("That widget is no longer on the dashboard.");
  const lim = widgetLimits(board, widget.type);
  const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);
  const nw = clamp(w, lim.minW, lim.maxW, old.w);
  const nh = clamp(h, lim.minH, lim.maxH, old.h);
  const item = { ...old, w: nw, h: nh, x: Math.min(old.x, COLS - nw) };
  const layout = spec.layout.map((l) => (l.i === id ? item : { ...l }));
  // Push down: go top to bottom, and drop each widget just below anything already settled that it overlaps.
  const settled = [item];
  for (const l of layout.filter((x) => x !== item).sort((a, b) => a.y - b.y || a.x - b.x)) {
    let hit;
    while ((hit = settled.filter((p) => overlaps(p, l))).length) l.y = Math.max(...hit.map((p) => p.y + p.h));
    settled.push(l);
  }
  if (nh < old.h) closeGap(layout, { x: item.x, y: item.y + nh, w: Math.max(old.x + old.w, item.x + item.w) - Math.min(old.x, item.x), h: old.h - nh });
  return { ...spec, layout };
}

/** Resizes one widget on a board and saves it as a new version (so Undo puts it back). */
export async function resizeWidgetOnBoard(board, id, size) {
  const current = await getDashboard(board);
  const before = current.layout.find((l) => l.i === id);
  const widget = current.widgets.find((x) => x.id === id);
  if (!widget || !before) throw new Error("That widget is no longer on the dashboard.");
  const next = resizeWidget(current, id, size, board);
  const after = next.layout.find((l) => l.i === id);
  const from = { w: before.w, h: before.h };
  const to = { w: after.w, h: after.h };
  const limited = (size.w != null && size.w !== to.w) || (size.h != null && size.h !== to.h);
  const limits = widgetLimits(board, widget.type);
  if (from.w === to.w && from.h === to.h) return { title: widget.title, version: current.version, from, to, limited, limits, unchanged: true };
  const saved = await saveDashboard({ title: current.title, widgets: next.widgets, layout: next.layout, version: current.version }, board);
  return { title: widget.title, version: saved.version, from, to, limited, limits, unchanged: false };
}

export async function resetDashboard(board = "default") {
  const def = checkBoard(board, null);
  const current = await getDashboard(board);
  return saveDashboard({ ...structuredClone(def.spec), version: current.version }, board);
}
