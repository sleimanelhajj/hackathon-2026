// npm run db:restore -- --yes — loads backups/sales.json into Postgres (replacing the sales tables) and upserts the
// dashboard layouts and demo invoices from backups/mongo-safe.json. Needs --yes because it replaces data.
// Add --sales-only or --mongo-only to restore just one side.
import "dotenv/config";
import fs from "node:fs";
import { MongoClient } from "mongodb";
import { createPool, ensureDatabase } from "../server/sales/db.js";
import { MONGO_BACKUP_COLLECTIONS, MONGO_FORMAT, importSales } from "../server/sales/backup.js";

const args = new Set(process.argv.slice(2));
if (!args.has("--yes")) {
  console.log("This replaces the sales tables in Postgres and the dashboard layouts in MongoDB with the backup.\nRun again with --yes to go ahead:  npm run db:restore -- --yes");
  process.exit(1);
}
const dir = new URL("../backups/", import.meta.url);
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, dir), "utf8"));
const revive = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? new Date(v) : v);
const reviveDoc = (doc) => JSON.parse(JSON.stringify(doc), (_k, v) => revive(v));

if (!args.has("--mongo-only")) {
  if (!process.env.POSTGRES_URL) console.log("Postgres: skipped (POSTGRES_URL isn't set).");
  else {
    await ensureDatabase();
    const pool = createPool();
    try {
      const counts = await importSales(pool, undefined, read("sales.json"));
      console.log(`Postgres: restored the sales data${counts ? ` (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")})` : ""}.`);
    } finally {
      await pool.end();
    }
  }
}

if (!args.has("--sales-only")) {
  if (!process.env.MONGODB_URI) console.log("MongoDB: skipped (MONGODB_URI isn't set).");
  else {
    const backup = read("mongo-safe.json");
    if (backup.format !== MONGO_FORMAT) throw new Error("backups/mongo-safe.json is not a backup from this app.");
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    try {
      const db = client.db(process.env.MONGODB_DB || "ai_workspace_os");
      for (const name of MONGO_BACKUP_COLLECTIONS) {
        const docs = (backup.collections[name] ?? []).map(reviveDoc);
        for (const doc of docs) await db.collection(name).replaceOne({ _id: doc._id }, doc, { upsert: true });
        console.log(`MongoDB: restored ${docs.length} ${name}.`);
      }
    } finally {
      await client.close();
    }
  }
}
