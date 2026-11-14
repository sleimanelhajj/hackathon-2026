// npm run db:backup — writes backups/sales.json (Postgres demo data) and backups/mongo-safe.json (dashboard layouts
// and demo invoices). Personal email data is never exported (see server/sales/backup.js, decision #53).
import "dotenv/config";
import fs from "node:fs";
import { MongoClient } from "mongodb";
import { createPool } from "../server/sales/db.js";
import { MONGO_BACKUP_COLLECTIONS, MONGO_FORMAT, exportSales } from "../server/sales/backup.js";

const dir = new URL("../backups/", import.meta.url);
fs.mkdirSync(dir, { recursive: true });

if (process.env.POSTGRES_URL) {
  const pool = createPool();
  try {
    const sales = await exportSales(pool);
    fs.writeFileSync(new URL("sales.json", dir), JSON.stringify(sales, null, 1));
    console.log(`Postgres: wrote backups/sales.json (${Object.entries(sales.counts).map(([k, v]) => `${v} ${k}`).join(", ")})`);
  } finally {
    await pool.end();
  }
} else console.log("Postgres: skipped (POSTGRES_URL isn't set).");

if (process.env.MONGODB_URI) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || "ai_workspace_os");
    const out = { format: MONGO_FORMAT, exportedAt: new Date().toISOString(), collections: {} };
    for (const name of MONGO_BACKUP_COLLECTIONS) {
      let docs = await db.collection(name).find({}).toArray();
      // Invoices: only drafts for the fictional demo customers (.example addresses); anything else could be personal.
      if (name === "invoices") docs = docs.filter((d) => !d.customer?.email || /\.example$/i.test(d.customer.email)).map(({ sentGmailId, sendError, ...d }) => d);
      out.collections[name] = docs;
    }
    fs.writeFileSync(new URL("mongo-safe.json", dir), JSON.stringify(out, null, 1));
    console.log(`MongoDB: wrote backups/mongo-safe.json (${Object.entries(out.collections).map(([k, v]) => `${v.length} ${k}`).join(", ")}); email data is never exported.`);
  } finally {
    await client.close();
  }
} else console.log("MongoDB: skipped (MONGODB_URI isn't set).");
