// Database backup (server/sales/backup.js): the sales data round-trips exactly (export → restore into a fresh
// schema → same rows), and only collections without personal email data are ever backed up from MongoDB.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { generateSalesData } from "../../server/sales/seed.js";
import { MONGO_BACKUP_COLLECTIONS, MONGO_NEVER_BACKED_UP } from "../../server/sales/backup.js";

const url = process.env.POSTGRES_URL;
const skip = url ? false : "POSTGRES_URL is not set";
const now = new Date("2026-11-14T12:00:00Z");
const a = `test_backup_a_${process.pid}`, b = `test_backup_b_${process.pid}`;
let pool, db, backup;
before(async () => {
  if (skip) return;
  db = await import("../../server/sales/db.js");
  backup = await import("../../server/sales/backup.js");
  pool = db.createPool(url);
  await db.createSchema(pool, a);
  await db.loadData(pool, a, generateSalesData({ seed: 3, months: 24, now }));
});
after(async () => {
  if (!pool) return;
  await db.dropSchema(pool, a);
  await db.dropSchema(pool, b);
  await pool.end();
});

test("the sales data round-trips exactly: export, restore into a fresh schema, export again", { skip }, async () => {
  const first = await backup.exportSales(pool, a);
  assert.equal(first.format, "ai-workspace-os/sales@1");
  assert.equal(first.data.products.length, 10);
  assert.ok(first.data.orders.length > 800 && first.data.orderItems.length >= first.data.orders.length);
  assert.ok(first.data.profile?.name);
  const json = JSON.parse(JSON.stringify(first)); // what's written to disk
  await backup.importSales(pool, b, json);
  const second = await backup.exportSales(pool, b);
  assert.deepEqual(second.data, first.data);
});

test("a backup that isn't ours is refused before anything is touched", { skip }, async () => {
  await assert.rejects(backup.importSales(pool, b, { format: "something-else", data: {} }), /not a sales backup/i);
});

test("MongoDB backups include only data without personal email content", () => {
  assert.deepEqual([...MONGO_BACKUP_COLLECTIONS].sort(), ["dashboards", "invoices"]);
  for (const c of ["messages", "connections", "extractions", "attachment_text", "calendar_invites", "labels", "calendar_sync"]) {
    assert.ok(MONGO_NEVER_BACKED_UP.includes(c), `${c} is never backed up`);
    assert.ok(!MONGO_BACKUP_COLLECTIONS.includes(c));
  }
});
