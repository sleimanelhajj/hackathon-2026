// Wires the assistant together for the API: Gemini + the sales tools + the LangGraph agent + invoice storage.
// The agent is created on first use so the server starts fine without Postgres or Gemini configured.
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { getPool, postgresConfigured } from "../sales/db.js";
import { generateContent, geminiConfigured, geminiModel } from "./llm.js";
import { prepareInvoice, publicInvoice } from "./invoice.js";
import { createSalesTools } from "./sales-tools.js";
import { createSalesAgent } from "./sales-agent.js";

const invoiceNumber = (date = new Date()) =>
  `INV-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

/** Stores a draft the user confirmed. The totals are recomputed by prepareInvoice, never trusted from the draft. */
export async function saveConfirmedInvoice(draft, { db = getDb(), now = new Date() } = {}) {
  const prepared = prepareInvoice({ ...draft, invoiceNumber: invoiceNumber(now) });
  if (prepared.totalMinor !== draft.totalMinor) throw new Error("The invoice total changed. Ask for the draft again.");
  const doc = {
    _id: crypto.randomUUID(), ...prepared, status: "draft", source: "assistant", customerId: draft.customerId ?? null,
    model: geminiModel(), confirmedAt: now, createdAt: now, updatedAt: now,
  };
  await db.collection("invoices").insertOne(doc);
  await db.collection("audit_events").insertOne({ at: now, actor: "user", action: "invoice_confirmed", invoiceId: doc._id, totalMinor: doc.totalMinor, ok: true }).catch(() => {});
  return publicInvoice(doc);
}

let agent = null;
export function getAssistant() {
  if (!geminiConfigured()) throw new Error("The assistant needs Gemini. Add GEMINI_API_KEY to .env and restart the server.");
  if (!postgresConfigured()) throw new Error("The assistant reads the sales database. Add POSTGRES_URL to .env and load the demo data on the Sales page.");
  agent ??= createSalesAgent({ generate: generateContent, tools: createSalesTools({ pool: getPool() }), saveInvoice: (draft) => saveConfirmedInvoice(draft) });
  return agent;
}

/** Errors in plain words for the chat panel (no connection strings, no stack traces). */
export function assistantError(err) {
  const code = err?.code;
  if (code === "ECONNREFUSED") return "I can't reach the sales database. Is Postgres running?";
  if (code === "42P01") return "The sales tables don't exist yet. Load the demo data on the Sales page first.";
  if (code === "28P01") return "Postgres refused the username or password in POSTGRES_URL.";
  return String(err?.message || err).replace(/postgres(ql)?:\/\/[^\s]+/gi, "[connection string]").slice(0, 300);
}
