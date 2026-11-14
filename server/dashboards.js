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

export async function resetDashboard(board = "default") {
  const def = checkBoard(board, null);
  const current = await getDashboard(board);
  return saveDashboard({ ...structuredClone(def.spec), version: current.version }, board);
}
