import { MongoClient } from "mongodb";

let client;
let db;

export async function connectDb() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set. Copy .env.example to .env and fill it in.");
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  db = client.db(process.env.MONGODB_DB || "ai_workspace_os");
  await Promise.all([
    db.collection("connections").createIndex({ provider: 1 }, { unique: true }),
    db.collection("messages").createIndex({ gmailId: 1 }, { unique: true }),
    db.collection("messages").createIndex({ threadId: 1, date: -1 }),
    db.collection("messages").createIndex({ date: -1 }),
    db.collection("invoices").createIndex({ createdAt: -1 }),
    db.collection("invoices").createIndex({ status: 1, updatedAt: -1 }),
    db.collection("audit_events").createIndex({ at: -1 }),
  ]);
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not connected yet");
  return db;
}

export async function pingDb() {
  try {
    await getDb().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}
