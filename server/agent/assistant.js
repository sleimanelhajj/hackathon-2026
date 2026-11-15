// Wires the assistant together for the API: Gemini + the sales tools + the LangGraph agent + invoice storage.
// The agent is created on first use so the server starts fine without Postgres or Gemini configured.
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { getPool, postgresConfigured } from "../sales/db.js";
import { generateContent, geminiConfigured, geminiModel } from "./llm.js";
import { asAgent } from "./trace.js";
import { prepareInvoice, publicInvoice } from "./invoice.js";
import { createSalesTools } from "./sales-tools.js";
import { createSalesAgent } from "./sales-agent.js";
import { createChangeDesk } from "../sales/changes.js";
import { createWidgetBuilder } from "./widget-builder.js";
import { filterValues, runCustomQuery } from "../sales/custom.js";
import { loadDocuments, searchDocs } from "../documents.js";
import { boardDef, EmailCustomQuery, emailChartProblems } from "../../shared/spec.js";
import { createPage as createDashboardPage, listPages } from "../pages.js";
import { widgetFromKind } from "../widget-kinds.js";
import { runEmailQuery } from "../email-custom.js";
import { CUSTOM_SIZES, addWidgetToBoard, getDashboard, removeWidgetFromBoard, resizeWidgetOnBoard } from "../dashboards.js";

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
let desk = null;
/** The change desk (decision #68): drafts, saves and undoes changes to the sales records; one per server. */
export function getChangeDesk() {
  if (!postgresConfigured()) throw new Error("Set POSTGRES_URL on the server, then load the sales records on the Sales page.");
  desk ??= createChangeDesk({ pool: getPool() });
  return desk;
}
export function getAssistant() {
  if (!geminiConfigured()) throw new Error("The assistant needs Gemini. Add GEMINI_API_KEY to .env and restart the server.");
  if (!postgresConfigured()) throw new Error("The assistant reads the sales database. Set POSTGRES_URL on the server, then load the sales records on the Sales page.");
  if (!agent) {
    const tools = createSalesTools({ pool: getPool() });
    // The dashboard builder sub-agent: its own Gemini prompt and tools; the widget it makes goes on the Sales board.
    const builder = createWidgetBuilder({
      generate: generateContent, tools,
      values: () => filterValues(getPool()),
      runQuery: (query) => runCustomQuery(getPool(), query),
    });
    // Every board the assistant can work on (decision #60): Email dashboard, Sales, and the main Dashboard's pages.
    const boardList = async () => [{ board: "default", name: "Email dashboard" }, { board: "sales", name: "Sales" }, ...(await listPages()).map((p) => ({ board: p.id, name: p.name }))];
    const boardName = async (board) => (await boardList()).find((b) => b.board === board)?.name ?? board;
    const known = async (board) => {
      if (!boardDef(board) || !(await boardList()).some((b) => b.board === board)) throw new Error(`Unknown dashboard "${String(board).slice(0, 40)}". List the widgets to see the boards.`);
    };
    const added = async (board, widget, extra = {}) => {
      await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "agent", action: "widget_added", board, widgetId: widget.id, ok: true }).catch(() => {});
      return { board, boardName: await boardName(board), widget, ...extra };
    };
    const addWidget = async (request, board = "sales") => {
      await known(board);
      const built = await asAgent({ agent: "sami", task: request }, () => builder.build(request)); // Layla hands the chart to Sami
      const { widget } = await addWidgetToBoard(board, built.widget);
      return added(board, widget, { preview: built.preview });
    };
    const addReadyWidget = async (board, kind) => {
      await known(board);
      const { widget, size } = widgetFromKind(kind);
      const out = await addWidgetToBoard(board, widget, size);
      return added(board, out.widget);
    };
    const addEmailWidget = async (board, spec) => {
      await known(board);
      const query = EmailCustomQuery.parse(spec.query);
      const problems = emailChartProblems(spec.chart, query);
      if (problems.length) throw new Error(problems.join(" "));
      const preview = await runEmailQuery(query);
      const out = await addWidgetToBoard(board, { type: "email-custom", title: spec.title, chart: spec.chart, query }, CUSTOM_SIZES[spec.chart]);
      return added(board, out.widget, { preview });
    };
    const createPage = async (name) => {
      const page = await createDashboardPage(name);
      await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "agent", action: "page_created", board: page.id, ok: true }).catch(() => {});
      return { board: page.id, name: page.name };
    };
    // Removing or resizing a widget the user names: list every board so the model can match the title.
    const listWidgets = async () => Promise.all((await boardList()).map(async ({ board, name }) => {
      const spec = await getDashboard(board);
      const size = new Map(spec.layout.map((l) => [l.i, l]));
      return { board, name, widgets: spec.widgets.map((w) => ({ id: w.id, title: w.title, type: w.type, w: size.get(w.id)?.w, h: size.get(w.id)?.h })) };
    }));
    const removeWidget = async (board, id) => {
      await known(board);
      const before = await getDashboard(board);
      const title = before.widgets.find((w) => w.id === id)?.title;
      if (!title) throw new Error("That widget is no longer on the dashboard. List the widgets again.");
      const saved = await removeWidgetFromBoard(board, id);
      await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "agent", action: "widget_removed", board, widgetId: id, ok: true }).catch(() => {});
      return { board, id, title, version: saved.version };
    };
    // Resizing a widget the user names (decision #54): saved as a new version, so the chat's Undo puts it back.
    const resizeWidget = async (board, id, size) => {
      await known(board);
      const out = await resizeWidgetOnBoard(board, id, size);
      if (!out.unchanged) await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "agent", action: "widget_resized", board, widgetId: id, from: out.from, to: out.to, ok: true }).catch(() => {});
      return { board, id, ...out };
    };
    agent = createSalesAgent({ generate: generateContent, tools, saveInvoice: (draft) => saveConfirmedInvoice(draft), changes: getChangeDesk(), addWidget, listWidgets, removeWidget, resizeWidget,
      searchDocuments: async (query) => searchDocs(await loadDocuments(), query), createPage, addReadyWidget, addEmailWidget });
  }
  return agent;
}

/** Errors in plain words for the chat panel (no connection strings, no stack traces). */
export function assistantError(err) {
  const code = err?.code;
  if (code === "ECONNREFUSED") return "I can't reach the sales database. Is Postgres running?";
  if (code === "42P01") return "The sales tables don't exist yet. Load the sales records on the Sales page first.";
  if (code === "28P01") return "Postgres refused the username or password in POSTGRES_URL.";
  return String(err?.message || err).replace(/postgres(ql)?:\/\/[^\s]+/gi, "[connection string]").slice(0, 300);
}
