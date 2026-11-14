// Wires the assistant together for the API: Gemini + the sales tools + the LangGraph agent + invoice storage.
// The agent is created on first use so the server starts fine without Postgres or Gemini configured.
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { getPool, postgresConfigured } from "../sales/db.js";
import { generateContent, geminiConfigured, geminiModel } from "./llm.js";
import { prepareInvoice, publicInvoice } from "./invoice.js";
import { createSalesTools } from "./sales-tools.js";
import { createSalesAgent } from "./sales-agent.js";
import { createWidgetBuilder } from "./widget-builder.js";
import { filterValues, runCustomQuery } from "../sales/custom.js";
import { addWidgetToBoard, getDashboard, removeWidgetFromBoard } from "../dashboards.js";

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
  if (!agent) {
    const tools = createSalesTools({ pool: getPool() });
    // The dashboard builder sub-agent: its own Gemini prompt and tools; the widget it makes goes on the Sales board.
    const builder = createWidgetBuilder({
      generate: generateContent, tools,
      values: () => filterValues(getPool()),
      runQuery: (query) => runCustomQuery(getPool(), query),
    });
    const addWidget = async (request) => {
      const built = await builder.build(request);
      const { widget } = await addWidgetToBoard("sales", built.widget);
      await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "agent", action: "widget_added", board: "sales", widgetId: widget.id, ok: true }).catch(() => {});
      return { board: "sales", widget, preview: built.preview };
    };
    // Removing a widget the user names: list both boards so the model can match the title, then remove (gap closes).
    const BOARD_NAMES = { sales: "Sales", default: "Email dashboard" };
    const listWidgets = async () => Promise.all(Object.entries(BOARD_NAMES).map(async ([board, name]) => {
      const spec = await getDashboard(board);
      return { board, name, widgets: spec.widgets.map((w) => ({ id: w.id, title: w.title, type: w.type })) };
    }));
    const removeWidget = async (board, id) => {
      if (!(board in BOARD_NAMES)) throw new Error(`Unknown dashboard "${board}".`);
      const before = await getDashboard(board);
      const title = before.widgets.find((w) => w.id === id)?.title;
      if (!title) throw new Error("That widget is no longer on the dashboard. List the widgets again.");
      const saved = await removeWidgetFromBoard(board, id);
      await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "agent", action: "widget_removed", board, widgetId: id, ok: true }).catch(() => {});
      return { board, id, title, version: saved.version };
    };
    agent = createSalesAgent({ generate: generateContent, tools, saveInvoice: (draft) => saveConfirmedInvoice(draft), addWidget, listWidgets, removeWidget });
  }
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
