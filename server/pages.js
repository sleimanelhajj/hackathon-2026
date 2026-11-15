// Dashboard pages (decision #60). The main board ("main") is the first page; users (and the assistant) can add more,
// each a main board of its own ("page-xxxxxx") that takes any email or sales widget. The Email dashboard ("default")
// and Sales ("sales") are separate and keep their own widgets. Page names and order live in `dashboard_pages`; each
// page's layout is a normal versioned board in `dashboards` (server/dashboards.js).
import crypto from "node:crypto";
import { z } from "zod";
import { getDb } from "./db.js";
import { PAGE_ID } from "../shared/spec.js";

export const MAX_PAGES = 12;
export const PageName = z.string().trim().min(1, "Give the page a name.").max(40, "Keep the name under 40 characters.");

/** "page-" and six random lowercase letters/digits, not one of `taken`. */
export function newPageId(taken = new Set()) {
  for (;;) {
    const id = `page-${crypto.randomBytes(6).toString("base64").replace(/[^a-z0-9]/gi, "").toLowerCase().padEnd(6, "0").slice(0, 6)}`;
    if (PAGE_ID.test(id) && !taken.has(id)) return id;
  }
}

const col = () => getDb().collection("dashboard_pages");

/** Every page, in order; the main page is always first (created on first use). */
export async function listPages() {
  await col().updateOne({ _id: "main" }, { $setOnInsert: { name: "Overview", order: 0, createdAt: new Date() } }, { upsert: true });
  const docs = await col().find({}).sort({ order: 1, createdAt: 1 }).toArray();
  return docs.map((d) => ({ id: d._id, name: d.name }));
}

export async function createPage(name) {
  const pages = await listPages();
  if (pages.length >= MAX_PAGES) throw new Error(`You have ${MAX_PAGES} pages already. Delete one first.`);
  const id = newPageId(new Set(pages.map((p) => p.id)));
  const doc = { _id: id, name: PageName.parse(name), order: pages.length, createdAt: new Date() };
  await col().insertOne(doc);
  // A new page starts empty (not with the overview's widgets), ready for whatever the user adds.
  await getDb().collection("dashboards").updateOne({ _id: id }, { $setOnInsert: { title: doc.name, widgets: [], layout: [], version: 1, previous: null, updatedAt: new Date() } }, { upsert: true });
  return { id, name: doc.name };
}

export async function renamePage(id, name) {
  const clean = PageName.parse(name);
  const res = await col().updateOne({ _id: id }, { $set: { name: clean } });
  if (!res.matchedCount) throw new Error("That page doesn't exist any more.");
  await getDb().collection("dashboards").updateOne({ _id: id }, { $set: { title: clean } });
  return { id, name: clean };
}

export async function deletePage(id) {
  if (id === "main") throw new Error("The main page can't be deleted; rename it or remove its widgets instead.");
  if (!PAGE_ID.test(id)) throw new Error("That isn't a page.");
  await col().deleteOne({ _id: id });
  await getDb().collection("dashboards").deleteOne({ _id: id });
  return { id, deleted: true };
}
