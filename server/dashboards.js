import { getDb } from "./db.js";
import { DashboardSpec, DEFAULT_SPEC, Widget } from "../shared/spec.js";

// One dashboard per workspace for now ("default"). Feature 6 (RBAC) adds per-person copies.
const ID = "default";

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

export async function getDashboard() {
  const col = getDb().collection("dashboards");
  let doc = await col.findOne({ _id: ID });
  if (!doc) {
    doc = { _id: ID, ...structuredClone(DEFAULT_SPEC), version: 1, previous: null, updatedAt: new Date() };
    await col.insertOne(doc);
  }
  return publicSpec(doc);
}

export class ConflictError extends Error {}

/** Validates and saves a new version, keeping the previous one for undo. */
export async function saveDashboard(body) {
  const parsed = DashboardSpec.safeParse(body);
  if (!parsed.success) throw new Error(`Invalid dashboard: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  const col = getDb().collection("dashboards");
  const current = await col.findOne({ _id: ID });
  if (current && typeof body.version === "number" && body.version !== current.version) {
    throw new ConflictError("This dashboard changed somewhere else. Reload to get the latest version.");
  }
  const previous = current ? { title: current.title, widgets: current.widgets, layout: current.layout } : null;
  const next = { ...parsed.data, version: (current?.version ?? 0) + 1, previous, updatedAt: new Date() };
  await col.updateOne({ _id: ID }, { $set: next }, { upsert: true });
  return publicSpec({ _id: ID, ...next });
}

export async function undoDashboard() {
  const col = getDb().collection("dashboards");
  const current = await col.findOne({ _id: ID });
  if (!current?.previous) throw new Error("Nothing to undo");
  const swapped = {
    ...current.previous,
    previous: { title: current.title, widgets: current.widgets, layout: current.layout },
    version: current.version + 1,
    updatedAt: new Date(),
  };
  await col.updateOne({ _id: ID }, { $set: swapped });
  return publicSpec({ _id: ID, ...swapped });
}

export async function resetDashboard() {
  const current = await getDashboard();
  return saveDashboard({ ...structuredClone(DEFAULT_SPEC), version: current.version });
}
