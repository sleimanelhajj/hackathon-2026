// Builds the submission report PDF from the project itself, so every figure in it has a source:
//   - test results: the server suite's TAP output and the UI suite's JSON output, with each test file's own description;
//   - what the agents can run: the tool declarations in server/agent (the same ones Gemini is given);
//   - the AI team and measured AI costs, and the sales figures: from the running server's API.
// Business-model text comes from context/product-blueprint.md and PRODUCT.md; pricing there is a hypothesis and is
// labelled as one. Drawn with pdf-lib (already used for invoices), standard fonts, A4.
//
//   node --test --test-reporter=tap scripts/dashboard-layout.test.mjs "tests/server/*.test.mjs" > .report/server.tap
//   npx vitest run --reporter=json --outputFile=.report/ui.json
//   node scripts/build-report.mjs --server .report/server.tap --ui .report/ui.json [--api http://localhost:8787] [--out docs/AI-Workspace-OS-Report.pdf]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { TOOL_DECLARATIONS } from "../server/agent/sales-tools.js";
import { WIDGET_TOOL_DECLARATIONS } from "../server/agent/widget-builder.js";
import * as salesAgent from "../server/agent/sales-agent.js";
import { PRICES, PRICE_SOURCE } from "../server/agent/pricing.js";
import { CHANGE_DECLARATIONS, EXPENSES_DECLARATION } from "../server/sales/changes.js";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_TAP = arg("server"), UI_JSON = arg("ui"), API = arg("api", "http://localhost:8787");
const OUT = path.resolve(ROOT, arg("out", "docs/AI-Workspace-OS-Report.pdf"));
if (!SERVER_TAP || !UI_JSON) { console.error("Pass --server <tap file> and --ui <vitest json file>."); process.exit(1); }

// ---------------------------------------------------------------- data
const unescapeTap = (s) => s.replace(/\\#/g, "#").replace(/\\\\/g, "\\");
function serverResults() {
  const tap = fs.readFileSync(SERVER_TAP, "utf8");
  const tests = [];
  for (const line of tap.split(/\r?\n/)) {
    const m = line.match(/^(\s*)(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/);
    if (!m || m[1].length) continue; // top-level tests only
    tests.push({ title: unescapeTap(m[3]), status: m[4] === "SKIP" ? "skipped" : m[2] === "ok" ? "passed" : "failed" });
  }
  // Which file each test is in: read the titles from the sources.
  const files = ["scripts/dashboard-layout.test.mjs", ...fs.readdirSync(path.join(ROOT, "tests/server")).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => `tests/server/${f}`)];
  const owners = new Map();
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(/\btest\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
      const title = m[2].replace(/\\(["'`\\])/g, "$1");
      (owners.get(title) ?? owners.set(title, []).get(title)).push(file);
    }
  }
  for (const t of tests) t.file = owners.get(t.title)?.shift() ?? "tests/server (other)";
  return tests;
}
function uiResults() {
  const r = JSON.parse(fs.readFileSync(UI_JSON, "utf8"));
  return r.testResults.flatMap((f) => f.assertionResults.map((a) => ({
    file: path.relative(ROOT, f.name).replace(/\\/g, "/"), title: [...a.ancestorTitles, a.title].join(" > "), status: a.status === "passed" ? "passed" : a.status === "skipped" || a.status === "pending" ? "skipped" : "failed",
  })));
}
function describeFile(file) {
  const special = {
    "scripts/dashboard-layout.test.mjs": "The free-position dashboard layout model: saved positions, moving and resizing cards, collapsing, and phone/tablet layouts.",
    "tests/dashboard-editor.test.tsx": "Editing a dashboard with the real GridStack grid: Save, Cancel and Reset as transactions; adding widgets from the library.",
  };
  if (special[file]) return special[file];
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const lines = [];
  for (const l of src.split(/\r?\n/)) { if (/^\/\//.test(l)) lines.push(l.replace(/^\/\/\s?/, "")); else if (lines.length) break; }
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  const cut = text.slice(0, 240);
  const end = cut.lastIndexOf(". ");
  return text.length <= 240 ? text : end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}
const AREAS = [
  ["AI agents, models and logs", /agent-log|sales-agent|widget-builder|classify|content|vision|files\.test|llm-timeout|telegram-insight|reply-inventory|company-data|agent-assistant|logs\.test/],
  ["Gmail, email, schedule and replies", /autosync|auto-sync|email-text|threads|schedule|meeting|gcal|attachment|conversations|thread-list|reply/],
  ["Sales, stock, invoices and money", /sales-|inventory|invoice|payments|documents|backup|money-widgets|cost-widget|custom-widget|files-page/],
  ["Dashboards and export", /dashboard|boards|pages\.test|widget-kinds|email-custom|export|widget-remove|widget-frame|main-dashboard/],
  ["Telegram", /telegram/],
  ["Security, deployment and UI quality", /env\.test|http\.test|theme|ui-rules|ui-speed|select|sidebar|skeletons|ui-primitives/],
];
const areaOf = (file) => AREAS.find(([, re]) => re.test(file))?.[0] ?? "Other";

async function api(p) {
  try { const r = await fetch(`${API}${p}`); return r.ok ? await r.json() : null; } catch { return null; }
}

const server = serverResults(), ui = uiResults();
const all = [...server.map((t) => ({ ...t, suite: "Server" })), ...ui.map((t) => ({ ...t, suite: "UI" }))];
const count = (list, s) => list.filter((t) => t.status === s).length;
const [sales, team, usage] = await Promise.all([api("/api/sales/dashboard?months=12"), api("/api/agents"), api("/api/logs/usage?days=30")]);
const layla = Object.entries(salesAgent).filter(([key, d]) => key.endsWith("_DECLARATION") && d?.name).map(([, d]) => d);
const runDate = new Date();
const dateLong = runDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const usd = (v) => (!v ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

// ---------------------------------------------------------------- layout engine
const W = 595.28, H = 841.89, M = 54, CW = W - 2 * M;
const C = {
  ink: rgb(0.06, 0.11, 0.18), muted: rgb(0.31, 0.36, 0.44), faint: rgb(0.55, 0.6, 0.67), accent: rgb(0.118, 0.227, 0.541),
  accentSoft: rgb(0.91, 0.93, 0.98), line: rgb(0.85, 0.88, 0.93), zebra: rgb(0.97, 0.975, 0.99), white: rgb(1, 1, 1),
  ok: rgb(0.06, 0.48, 0.33), okSoft: rgb(0.9, 0.96, 0.93), warn: rgb(0.62, 0.38, 0.03), warnSoft: rgb(0.99, 0.95, 0.88), lav: rgb(0.42, 0.3, 0.75),
};
const pdf = await PDFDocument.create();
const F = {
  reg: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  it: await pdf.embedFont(StandardFonts.HelveticaOblique),
};
// The standard fonts only know Windows-1252; spell out the few symbols the project's text uses.
const SWAP = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≈": "~", "✓": "OK", "×": "x", "−": "-", " ": " ", " ": " ", " ": " ", "²": "2" };
const safe = (s) => [...String(s ?? "")].map((ch) => {
  if (SWAP[ch]) return SWAP[ch];
  try { F.reg.encodeText(ch); return ch; } catch { return "?"; }
}).join("");

let page, y;
const pages = [];
const toc = [];
function newPage() { page = pdf.addPage([W, H]); pages.push(page); y = H - M - 16; }
function ensure(h) { if (y - h < M + 22) newPage(); }

/** "plain **bold** _italic_" → runs */
function runs(text, base = F.reg) {
  const out = [];
  for (const part of safe(text).split(/(\*\*[^*]+\*\*|_[^_]+_)/g)) {
    if (!part) continue;
    if (part.startsWith("**")) out.push({ t: part.slice(2, -2), f: F.bold });
    else if (/^_.+_$/.test(part)) out.push({ t: part.slice(1, -1), f: F.it });
    else out.push({ t: part, f: base });
  }
  return out;
}
/** Wraps runs to lines no wider than `width`. */
function wrap(rs, size, width) {
  const words = [];
  for (const r of rs) for (const w of r.t.split(/(\s+)/)) if (w) words.push({ t: w, f: r.f });
  const lines = [[]];
  let lineW = 0;
  for (const w of words) {
    const ww = w.f.widthOfTextAtSize(w.t, size);
    if (/^\s+$/.test(w.t)) { if (lines.at(-1).length) { lines.at(-1).push({ ...w, w: ww }); lineW += ww; } continue; }
    if (lineW + ww > width && lines.at(-1).length) {
      while (lines.at(-1).length && /^\s+$/.test(lines.at(-1).at(-1).t)) lines.at(-1).pop();
      lines.push([]); lineW = 0;
    }
    if (ww > width) { // a very long word (a path): split it
      let chunk = "";
      for (const ch of w.t) {
        if (w.f.widthOfTextAtSize(chunk + ch, size) > width) { lines.at(-1).push({ t: chunk, f: w.f, w: w.f.widthOfTextAtSize(chunk, size) }); lines.push([]); chunk = ""; }
        chunk += ch;
      }
      w.t = chunk;
    }
    const wNow = w.f.widthOfTextAtSize(w.t, size);
    lines.at(-1).push({ ...w, w: wNow }); lineW += wNow;
  }
  return lines;
}
function drawLine(line, x, yy, size, color) {
  let cx = x;
  for (const w of line) { if (w.t) page.drawText(w.t, { x: cx, y: yy, size, font: w.f, color }); cx += w.w; }
}
function para(text, { size = 10.2, color = C.ink, indent = 0, gap = 7, lh = 1.45, font = F.reg } = {}) {
  const lines = wrap(runs(text, font), size, CW - indent);
  for (const line of lines) { ensure(size * lh); drawLine(line, M + indent, y - size, size, color); y -= size * lh; }
  y -= gap;
}
function h1(text, { fresh = true } = {}) {
  if (fresh) newPage(); else ensure(60);
  toc.push({ title: text, page: pages.length - 1 });
  page.drawRectangle({ x: M, y: y - 4, width: 34, height: 4, color: C.accent });
  y -= 14;
  page.drawText(safe(text), { x: M, y: y - 20, size: 21, font: F.bold, color: C.ink });
  y -= 40;
}
function h2(text) {
  ensure(46);
  y -= 6;
  page.drawText(safe(text), { x: M, y: y - 13, size: 13.5, font: F.bold, color: C.accent });
  y -= 23;
}
function h3(text) { ensure(34); page.drawText(safe(text), { x: M, y: y - 11, size: 11, font: F.bold, color: C.ink }); y -= 18; }
function bullets(items, { size = 10.2, indent = 0 } = {}) {
  for (const item of items) {
    const lines = wrap(runs(item), size, CW - indent - 14);
    lines.forEach((line, i) => {
      ensure(size * 1.45);
      if (i === 0) page.drawCircle({ x: M + indent + 4, y: y - size + 3.3, size: 1.9, color: C.accent });
      drawLine(line, M + indent + 14, y - size, size, C.ink);
      y -= size * 1.45;
    });
    y -= 2.5;
  }
  y -= 5;
}
function note(text, { tone = "info" } = {}) {
  const size = 9.6, pad = 10;
  const lines = wrap(runs(text), size, CW - 2 * pad - 6);
  const h = lines.length * size * 1.45 + 2 * pad - 3;
  ensure(h + 8);
  const [bg, edge] = tone === "warn" ? [C.warnSoft, C.warn] : tone === "ok" ? [C.okSoft, C.ok] : [C.accentSoft, C.accent];
  page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: bg });
  page.drawRectangle({ x: M, y: y - h, width: 3, height: h, color: edge });
  let yy = y - pad - size + 2;
  for (const line of lines) { drawLine(line, M + pad + 6, yy, size, C.ink); yy -= size * 1.45; }
  y -= h + 12;
}
function stats(boxes) {
  const gap = 10, w = (CW - gap * (boxes.length - 1)) / boxes.length, h = 62;
  ensure(h + 12);
  boxes.forEach((b, i) => {
    const x = M + i * (w + gap);
    page.drawRectangle({ x, y: y - h, width: w, height: h, color: b.tone === "ok" ? C.okSoft : C.accentSoft });
    page.drawText(safe(b.value), { x: x + 10, y: y - 30, size: 19, font: F.bold, color: b.tone === "ok" ? C.ok : C.accent });
    const lines = wrap(runs(b.label), 8.4, w - 20);
    lines.slice(0, 2).forEach((line, k) => drawLine(line, x + 10, y - 44 - k * 10.5, 8.4, C.muted));
  });
  y -= h + 14;
}
/** cols: [{ head, w (fraction) , bold? }], rows: string[][] */
function table(cols, rows, { size = 8.8, head = true, statusCol = -1 } = {}) {
  const pad = 5, lh = size * 1.38;
  const widths = cols.map((c) => c.w * CW);
  const drawHead = () => {
    const lines = cols.map((c, i) => wrap(runs(c.head, F.bold), size, widths[i] - 2 * pad));
    const hh = Math.max(...lines.map((l) => l.length)) * lh + 2 * pad - 2;
    ensure(hh + lh * 2);
    page.drawRectangle({ x: M, y: y - hh, width: CW, height: hh, color: C.accent });
    let x = M;
    lines.forEach((ls, i) => { ls.forEach((line, k) => drawLine(line.map((w) => ({ ...w, f: F.bold })), x + pad, y - pad - size + 1 - k * lh, size, C.white)); x += widths[i]; });
    y -= hh;
  };
  if (head) drawHead();
  rows.forEach((row, r) => {
    const lines = row.map((cell, i) => wrap(runs(cell, cols[i].bold ? F.bold : F.reg), size, widths[i] - 2 * pad));
    const rh = Math.max(...lines.map((l) => l.length)) * lh + 2 * pad - 2;
    if (y - rh < M + 22) { newPage(); if (head) drawHead(); }
    if (r % 2 === 1) page.drawRectangle({ x: M, y: y - rh, width: CW, height: rh, color: C.zebra });
    let x = M;
    lines.forEach((ls, i) => {
      const color = i === statusCol ? (/fail/i.test(row[i]) ? C.warn : /skip/i.test(row[i]) ? C.muted : C.ok) : C.ink;
      ls.forEach((line, k) => drawLine(line, x + pad, y - pad - size + 1 - k * lh, size, color));
      x += widths[i];
    });
    page.drawLine({ start: { x: M, y: y - rh }, end: { x: M + CW, y: y - rh }, thickness: 0.5, color: C.line });
    y -= rh;
  });
  y -= 12;
}

// ---------------------------------------------------------------- cover
newPage();
page.drawRectangle({ x: 0, y: H - 330, width: W, height: 330, color: C.accent });
page.drawRectangle({ x: 0, y: H - 330, width: W, height: 6, color: C.lav });
page.drawText("ALPHAHACK 2026 · SUBMISSION REPORT", { x: M, y: H - 92, size: 10, font: F.bold, color: rgb(0.78, 0.84, 0.98) });
page.drawText("AI Workspace OS", { x: M, y: H - 150, size: 40, font: F.bold, color: C.white });
for (const [i, line] of wrap(runs("Connect your tools, describe what matters, and get a workspace that understands your business, answers your questions and helps you act, with a team of AI agents that never acts without your approval."), 13.5, CW).entries()) {
  drawLine(line, M, H - 192 - i * 20, 13.5, rgb(0.9, 0.93, 1));
}
page.drawText(safe(`Business model · Solution · AI agents · Test cases · ${dateLong}`), { x: M, y: H - 300, size: 10, font: F.reg, color: rgb(0.78, 0.84, 0.98) });
y = H - 370;
stats([
  { value: String(all.length), label: "automated test cases" },
  { value: `${count(all, "passed")}`, label: `passed (${count(all, "failed")} failed, ${count(all, "skipped")} skipped)`, tone: "ok" },
  { value: String(team?.agents?.length ?? 7), label: "named AI agents" },
  { value: String(TOOL_DECLARATIONS.length + layla.length + WIDGET_TOOL_DECLARATIONS.length + CHANGE_DECLARATIONS.length + 1), label: "tools the agents can run" },
]);
h2("At a glance");
bullets([
  "**The problem:** small businesses run on email and chat, so leads, invoices, promises and follow-ups get lost across Gmail, Telegram, spreadsheets and attachments.",
  "**The solution:** one workspace that connects Gmail, Google Calendar, Telegram and the sales database, sorts and summarises what arrives, builds dashboards from plain requests, and drafts replies and invoices that are sent only after the user approves.",
  "**The AI:** a team of seven named agents led by Layla, each with a clear job and the agent above it; every model call is logged with its tokens and cost.",
  "**The evidence:** every number on screen is computed from synced data or shown as missing; the test results in this report come from the automated suites run on " + dateLong + ".",
]);
note("Demo data: the sales database holds a fictional Lebanese solar shop (Cedar Solar Supply), generated from a seed. Pricing and packaging in the business model are hypotheses to test with pilot customers, not validated prices.", { tone: "warn" });

// ---------------------------------------------------------------- 1. problem
h1("1. The problem");
para("Business information is scattered across Gmail, calendars, chat apps, spreadsheets, CRMs and the files attached to emails. People hunt for updates by hand, copy figures into trackers, rebuild the same reports every week and lose follow-ups in long threads. For a small business owner the cost is concrete: a customer's request that waits too long, an invoice nobody chased, a promise made in a chat and forgotten.");
h2("Pains we observed");
bullets([
  "**Fragmented context:** an opportunity is discussed in Gmail, the meeting is in a calendar, the price in a spreadsheet and the agreement in a Telegram chat.",
  "**Manual dashboards:** recurring reports are rebuilt by copying data between applications.",
  "**Follow-up leakage:** unanswered proposals, deadlines and approvals disappear in long threads.",
  "**Passive analytics:** dashboards show information but don't help take the next step safely.",
  "**One-size-fits-all software:** a founder, a salesperson and an operator need different views.",
]);
h2("Jobs to be done");
table([{ head: "Job", w: 0.22, bold: true }, { head: "In the user's words", w: 0.78 }], [
  ["Understand", "\"Tell me what is happening across my connected workspace.\""],
  ["Prioritise", "\"Show me what needs my attention today.\""],
  ["Organise", "\"Create a workspace for my specific job.\""],
  ["Find", "\"Show the original conversation or record behind this number.\""],
  ["Act", "\"Draft the right response, prepare the invoice, schedule the follow-up.\""],
  ["Monitor", "\"Tell me when something changes or stalls.\""],
]);

// ---------------------------------------------------------------- 2. business model
h1("2. Business model");
h2("Who it is for");
para("**Beachhead:** founders, small-business operators and sales teams who run their business through Gmail (and, in markets like Lebanon, Telegram). The pain is visible with one data source and the product grows with each connector the customer adds.");
table([{ head: "Persona", w: 0.22, bold: true }, { head: "Main frustration", w: 0.4 }, { head: "What their workspace shows", w: 0.38 }], [
  ["Founder / SMB owner", "Too many inbox requests and disconnected operating data", "Priority inbox, customer follow-ups, meetings, payments and stock"],
  ["Sales manager / rep", "Prospects lost in email, proposals left unanswered", "Leads, pipeline, unanswered proposals, next meetings, targets"],
  ["Operations lead", "Status updates spread through email and chat", "Deadlines, blockers, files per contact, what is waiting on whom"],
]);
h2("Value proposition");
bullets([
  "**Goal to workspace:** a plain request (\"show monthly sales of the 5 kWh battery\") becomes a working, checked dashboard widget.",
  "**Source-backed intelligence:** every insight links to the email, chat or record it came from and is labelled as observed, derived or an AI guess.",
  "**Actionable, safely:** replies, invoices and messages are drafted for the user and sent only after explicit approval.",
  "**Transparent AI:** the Logs page shows what each agent did and exactly what it cost.",
]);
h2("How it makes money (hypotheses to test)");
table([{ head: "Offering", w: 0.2, bold: true }, { head: "Buyer", w: 0.2 }, { head: "Main value", w: 0.36 }, { head: "Model to test", w: 0.24 }], [
  ["Personal Workspace", "Individual professional", "One user, a few connectors, personal dashboards and assistant", "Per-user subscription"],
  ["Team Workspace", "SMB / startup", "Shared views, tasks, cross-tool insight, team automations", "Per seat + usage tier"],
  ["Embedded Dashboard API", "SaaS vendor", "AI dashboard generation inside another product", "API calls / active workspaces"],
  ["Enterprise", "Mid-market", "Governance, custom connectors, deployment options", "Annual contract + support"],
]);
note("All pricing models above are hypotheses from the product blueprint, not researched market prices. No customers, pilots or revenue exist yet (PRODUCT.md, 'Evidence on hand').", { tone: "warn" });
h2("Cost to serve: measured, not estimated");
const priceRows = PRICES.map((p) => [p.model, `$${p.input.toFixed(2)}`, `$${p.output.toFixed(2)}`, p.note]);
para(`AI is the main variable cost. Every Gemini call is recorded with Google's own token counts and priced at Google's list price for the paid tier (source: ${PRICE_SOURCE.url}, checked ${PRICE_SOURCE.checked}). Output prices include the model's thinking tokens, as Google bills them.`);
table([{ head: "Model", w: 0.3, bold: true }, { head: "Input / 1M tokens", w: 0.18 }, { head: "Output / 1M tokens", w: 0.18 }, { head: "Note", w: 0.34 }], priceRows);
if (usage?.totals?.calls) {
  const t = usage.totals;
  para(`**Measured in this workspace (last 30 days):** ${t.calls} Gemini calls, ${t.inputTokens.toLocaleString("en-US")} input and ${t.outputTokens.toLocaleString("en-US")} output tokens, **${usd(t.costUsd)}** in total, about **${usd(t.costUsd / t.calls)}** per call. For example, a Telegram chat summary cost about $0.0003 and a sales question to the assistant about $0.004.`);
} else {
  para("No AI calls were recorded in the last 30 days when this report was built.");
}
para("Other running costs are hosting for one Node.js process, a MongoDB database (the app's data, encrypted where it holds message content) and a PostgreSQL database (the sales records). Gmail, Google Calendar and Telegram access use the customer's own accounts.");
h2("Go-to-market");
bullets([
  "Start with founder-led pilots among small businesses that live in Gmail and Telegram.",
  "Sell one measurable job first (no missed follow-ups, invoices chased on time), not 'AI' in general.",
  "Offer two or three role templates (Sales, Founder, Operations); expand connectors as pilots ask for them.",
  "Charge only after showing time saved or better follow-up; release developer APIs once the connector and widget contracts are stable.",
]);
h2("Risks and how we handle them");
table([{ head: "Risk", w: 0.26, bold: true }, { head: "Mitigation in the product", w: 0.74 }], [
  ["AI makes up numbers", "Agents answer only from tool results over the database; numbers are computed by code; certainty labels; the Logs page shows every step. One known miss is listed in section 5.4."],
  ["Prompt injection in emails or chats", "Message content is treated as untrusted data, kept in the user turn of the prompt and never allowed to steer tools; schema-checked answers."],
  ["Sending the wrong message", "Nothing leaves the workspace without the user's explicit confirmation of the exact text and recipient."],
  ["Privacy of email and chat content", "Email bodies and Telegram text are stored encrypted (AES-256-GCM); the AI log stores no message content."],
  ["Model cost and outages", "Cheaper fallback model, per-attempt time limits, caching of summaries, cost visible per agent."],
  ["OAuth review for Gmail scopes", "Least privilege: read-only plus send for approved replies; authorised test users until review."],
]);

// ---------------------------------------------------------------- 3. solution
h1("3. The solution");
para("The product follows one loop: **Connect → Understand → Visualise → Ask → Act → Monitor.** It is a web app (React 19, Vite, TypeScript) with a Node.js and Express server. MongoDB holds the workspace (synced email, files, dashboards, logs); PostgreSQL holds the business's sales records. Google Gemini powers the agents, on the server only.");
h2("What is built");
table([{ head: "Area", w: 0.2, bold: true }, { head: "What the user can do", w: 0.8 }], [
  ["Integrations", "Connect Gmail (read-only, plus send for approved replies), Google Calendar (the app's own calendar), Telegram (sign in with their own phone) and the sales database; automatic Gmail sync every minute when something arrived."],
  ["Dashboard", "A free-position grid (GridStack): drag, drop, resize, add widgets from a library, pages as tabs, undo and reset; email and sales widgets side by side; export any dashboard as PNG or a paginated PDF report."],
  ["Email dashboard", "Every thread sorted by the AI into a category and priority, with a summary, the reason and a next step; 'Needs your attention' and 'What your email is about'; open any email in full."],
  ["Replies", "A suggested reply that checks live stock first; the user edits it and confirms before it is sent from Gmail."],
  ["Schedule", "A calendar built from email: reply tasks by urgency, follow-ups, meetings and deadlines, each saying why; availability and meeting requests with automatic answers for clashes (capped and listed)."],
  ["Files", "Every attachment filed per contact with an AI summary and its figures; invoices feed a Payments widget and move stock and sales automatically, with undo."],
  ["Sales", "A customisable board over the sales database: revenue, orders, categories, branches, staff targets, quotes, stock; custom charts built by the assistant."],
  ["Telegram", "Follow chosen people; read their chats; an AI summary of each chat with promises, follow-ups, who is waiting on whom and a suggested message; send a message after confirming it."],
  ["Assistant", "Layla, in a chat bubble on every page: questions about sales and customers, product recommendations, invoice PDFs after confirmation, dashboard changes."],
  ["Logs", "Every AI call with tokens and cost; the AI team with who is above whom; an agent map in a space field with a guided demo; a step-by-step replay of each task."],
]);
h2("Safety rules built into the product");
bullets([
  "**No fabricated numbers:** every metric is computed by code from synced data or shown as missing.",
  "**Evidence before confidence:** insights link to their source and say how they were counted; AI output is labelled as a guess.",
  "**Human approval for anything that leaves the workspace:** emails, invoices and Telegram messages are sent only after the user confirms the exact content; destructive actions ask first.",
  "**Least privilege:** Gmail read-only plus send for approved messages; Telegram via the user's own session; the AI never sees a database client or SQL.",
  "**Untrusted content:** email and chat text never steers an agent or a tool.",
  "**Encryption and bounded work:** message bodies, chat text and sign-in sessions are encrypted at rest; syncs are capped (30 days, 300 emails, 30 chats).",
  "**Honest status:** the app shows 'last synced', never claims real time.",
]);
h2("Deployment");
para("One process serves the API and the built app (`npm run build`, then `npm start`), with security headers (CSP, nosniff, frame protection, HSTS on HTTPS), a health check at `/api/health`, and a configuration check at start that names missing settings without printing values. Database backups exclude personal email data.");
if (sales?.kpis) {
  h2("Demo business in the sales database");
  para(`The sales database is loaded with a fictional Lebanese solar shop, **Cedar Solar Supply** (a Beirut store, a Jounieh store and an online shop; panels, inverters, lithium batteries, mounting, cable, protection, power stations and pump kits), sized like a real niche shop. Figures from the running app for the last 12 months:`);
  stats([
    { value: money(sales.kpis.revenue), label: "sales, last 12 months" },
    { value: String(sales.kpis.orders), label: "orders" },
    { value: money(sales.kpis.revenue / Math.max(1, sales.kpis.orders)), label: "average order" },
    { value: money(sales.kpis.revenuePrev ?? 0), label: "the 12 months before" },
  ]);
  if (sales.topProducts?.length) table([{ head: "Top products (12 months)", w: 0.55, bold: true }, { head: "Category", w: 0.25 }, { head: "Revenue", w: 0.2 }], sales.topProducts.slice(0, 5).map((p) => [p.name, p.category, money(p.revenue)]));
}

// ---------------------------------------------------------------- 4. agents
h1("4. The AI agents and what they can run");
para("Every piece of AI work is done by a named agent. Each has one job and an agent above it. A **sub-agent** is called directly by the agent above it as part of its own work; a **team member** works on its own when the app needs it, under the lead. Every model call, tool and hand-over is recorded on the Logs page.");
const agents = team?.agents ?? [];
table([{ head: "Agent", w: 0.12, bold: true }, { head: "Role", w: 0.15 }, { head: "Above", w: 0.15 }, { head: "When it runs", w: 0.2 }, { head: "What it does", w: 0.38 }],
  agents.map((a) => {
    const above = agents.find((b) => b.id === a.parent);
    return [a.name, a.role, above ? `${above.name} (${a.relation === "sub-agent" ? "sub-agent" : "team"})` : "Lead", a.runs, a.does];
  }));
h2("Layla: tools over the sales database (read-only)");
para("Layla is a LangGraph agent with Gemini function calling. She never sees SQL or a database client: each tool runs a fixed, bounded query and returns rows. Invoices are only drafts until the user confirms.");
table([{ head: "Tool", w: 0.24, bold: true }, { head: "What it returns", w: 0.76 }], TOOL_DECLARATIONS.map((t) => [t.name, t.description]), { size: 8.4 });
h2("Layla: dashboard and file tools");
table([{ head: "Tool", w: 0.27, bold: true }, { head: "What it does", w: 0.73 }], layla.map((t) => [t.name, t.description]), { size: 8.4 });
h2("Layla: updating the records (each change confirmed by the user)");
para("Every change is proposed first: the chat shows exactly what will change (before → after, with warnings) and nothing is written until the user presses Save. Saved changes are logged and can be undone; an undo is refused if the record changed again since. Sales and supplier purchases go through the same invoice log as emailed invoices, so stock, revenue and the Sales page's Undo stay consistent.");
table([{ head: "Tool", w: 0.27, bold: true }, { head: "What it proposes", w: 0.73 }], [...CHANGE_DECLARATIONS, EXPENSES_DECLARATION].map((t) => [t.name, t.description.replace(/ The user sees exactly.*$/, "")]), { size: 8.4 });
h2("Sami: the dashboard builder (Layla's sub-agent)");
table([{ head: "Tool", w: 0.24, bold: true }, { head: "What it does", w: 0.76 }], WIDGET_TOOL_DECLARATIONS.map((t) => [t.name, t.description]), { size: 8.4 });
para("Sami's widget is checked by code (valid measure, grouping, filters, period) and its numbers are run before it goes on the board; if a check fails he gets the reason back and tries again.");
h2("Work the other agents run on their own");
table([{ head: "Agent", w: 0.14, bold: true }, { head: "What it produces", w: 0.86 }], [
  ["Nadia", "For each new email thread: category, priority, summary, the reason, a suggested next step, and dates (meetings, deadlines, meeting requests) for the Schedule. Reads bodies and attachments (PDF, Word, Excel, PowerPoint, calendar invites, ZIP)."],
  ["Lina", "Description and text of images and scanned PDFs (photos of invoices, receipts, delivery notes) through Gemini vision, for Nadia and Hadi."],
  ["Hadi", "For each attachment: document type, title, summary and key figures (invoice number, totals, due date), filed under its contact; invoices feed Payments and move stock."],
  ["Rayan", "A reply draft for one thread, in the sender's language, using only facts in the thread and live stock levels; placeholders for anything the user must fill in."],
  ["Tala", "For one followed Telegram chat: summary, topics, who is waiting on whom, next step, promises by either side with due dates, follow-ups (each linked to its message) and a suggested message."],
]);
h2("Guardrails and logging");
bullets([
  "Agents answer only from tool results; message content is untrusted and kept out of the instructions.",
  "Answers are schema-constrained and validated with zod before use; a promise or follow-up that does not cite a real message is dropped.",
  "Every send (email, invoice, Telegram) needs the user's confirmation of the exact content; the AI never sends.",
  "Every Gemini call is logged with model, input/output tokens, cost and time, under the agent that made it; runs keep the order of model calls, tools and hand-overs for the replay. No message content is stored in the log.",
  "If the main model is overloaded, a cheaper fallback answers; per-attempt time limits keep waiting screens short.",
]);

// ---------------------------------------------------------------- 5. testing
h1("5. Testing");
para("The project is built test-first: a failing test, then the code that makes it pass. Two suites run before every push: **server and shared logic** with Node's built-in test runner, some of it against a real PostgreSQL database in a throw-away schema, and **user interface behaviour** with Vitest and Testing Library in a simulated browser. AI calls are tested with scripted fake models, so the control flow, the guardrails and the parsing are checked without depending on Gemini.");
h2(`Results (run on ${dateLong})`);
stats([
  { value: `${count(server, "passed")}/${server.length}`, label: `server tests passed (${count(server, "skipped")} skipped, ${count(server, "failed")} failed)`, tone: count(server, "failed") ? undefined : "ok" },
  { value: `${count(ui, "passed")}/${ui.length}`, label: `UI tests passed (${count(ui, "failed")} failed)`, tone: count(ui, "failed") ? undefined : "ok" },
  { value: String(new Set(all.map((t) => t.file)).size), label: "test files" },
  { value: String(count(all, "failed")), label: "failing tests" },
]);
const skipped = all.filter((t) => t.status === "skipped");
if (skipped.length) note(`Skipped in this run: ${skipped.map((t) => `"${t.title}" (${t.file})`).join("; ")}. Tests that need the PostgreSQL database skip when POSTGRES_URL is not set.`);
h2("Coverage by area");
const byArea = new Map();
for (const t of all) { const a = areaOf(t.file); const v = byArea.get(a) ?? { files: new Set(), n: 0, pass: 0 }; v.files.add(t.file); v.n++; if (t.status === "passed") v.pass++; byArea.set(a, v); }
table([{ head: "Area", w: 0.46, bold: true }, { head: "Files", w: 0.14 }, { head: "Tests", w: 0.14 }, { head: "Passed", w: 0.26 }],
  [...byArea].map(([a, v]) => [a, String(v.files.size), String(v.n), `${v.pass} of ${v.n}`]));
h2("What each test file checks");
const files = [...new Set(all.map((t) => t.file))].sort((a, b) => areaOf(a).localeCompare(areaOf(b)) || a.localeCompare(b));
table([{ head: "File", w: 0.27, bold: true }, { head: "What it checks", w: 0.6 }, { head: "Result", w: 0.13 }],
  files.map((f) => { const ts = all.filter((t) => t.file === f); return [f.replace(/^tests\//, ""), describeFile(f), `${count(ts, "passed")}/${ts.length} passed`]; }), { size: 8.2, statusCol: 2 });
h2("Scenarios the tests cover (examples)");
bullets([
  "**Safety:** nothing is sent without two explicit clicks; disconnect and delete ask first; confirmation dialogs run the action and show errors inside.",
  "**Agents:** the assistant's LangGraph flow (tools, invoice interrupt and resume, step limits) with a scripted model; the widget builder's checks; insight evidence filtering; prompt-injection text stays inside its block.",
  "**AI log:** costs use the price in force on the day; thinking counts as output; sub-agent runs nest under their caller; failures cost nothing; no message content is stored.",
  "**Data:** the sales data's stories and realistic size; dashboard numbers matched against hand counts on real PostgreSQL; backups round-trip exactly.",
  "**Integrations:** Gmail sync bounds and deduplication; Google Calendar writes only to the app's calendar; Telegram sign-in steps, country codes, time limits, encrypted storage, followed people and confirmed sending.",
  "**Interface quality:** contrast (WCAG AA) on glass, no nested blur, dropdowns accessible, layouts at desktop and phone widths, export page breaks between widgets.",
]);
h2("Known gaps and honest notes");
bullets([
  "The visual design is reviewed by the team in the browser; there are no automated screenshot tests.",
  "Sending a Telegram message has been tested with a fake client, not yet with a real recipient.",
  "Assistant accuracy: asked for 'last month', the assistant once gave $24,082 for October when the database says $15,210, because no tool returns a full previous month. Fix planned: a calendar-month option on the sales tools.",
  "Not built yet: role-based access (super admin, admin, member), user corrections to AI labels, push-based Gmail updates.",
  "AI costs are list prices for Google's paid tier; on the free tier Google charges nothing.",
]);

// ---------------------------------------------------------------- 6. running
h1("6. Running the project");
table([{ head: "Command", w: 0.36, bold: true }, { head: "What it does", w: 0.64 }], [
  ["npm install", "Install the dependencies."],
  ["npm run dev", "API on port 8787 and the web app on 5173 (Vite proxies /api)."],
  ["npm test", "Both test suites: server (Node test runner) and UI (Vitest)."],
  ["npm run build", "Type-check and production build."],
  ["npm start", "Serve the built app and the API from one process."],
  ["npm run db:restore -- --yes", "Load the demo sales data and dashboard layouts from backups/."],
  ["node scripts/build-report.mjs ...", "Rebuild this report from fresh test results and the running server."],
]);
para("Settings live in `.env` (never committed): MongoDB and PostgreSQL addresses, the token-encryption secret, Google OAuth, the Gemini key, and the Telegram api_id and api_hash. A missing optional setting turns that feature off and says so.");

// ---------------------------------------------------------------- appendix
h1("Appendix A. Every test case");
para(`All ${all.length} automated test cases from the run on ${dateLong}, grouped by file, with their result.`, { size: 9.6 });
for (const f of files) {
  const ts = all.filter((t) => t.file === f);
  h3(`${f}  ·  ${count(ts, "passed")} of ${ts.length} passed`);
  table([{ head: "#", w: 0.06 }, { head: "Test case", w: 0.8 }, { head: "Result", w: 0.14 }], ts.map((t, i) => [String(i + 1), t.title, t.status]), { size: 8, statusCol: 2, head: false });
}

// ---------------------------------------------------------------- contents, headers and footers
const contents = pdf.insertPage(1, [W, H]);
pages.splice(1, 0, contents);
contents.drawRectangle({ x: M, y: H - M - 20, width: 34, height: 4, color: C.accent });
contents.drawText("Contents", { x: M, y: H - M - 50, size: 21, font: F.bold, color: C.ink });
let cy = H - M - 92;
for (const entry of toc) {
  const label = safe(entry.title), num = String(entry.page + 2);
  contents.drawText(label, { x: M, y: cy, size: 12, font: F.reg, color: C.ink });
  const lw = F.reg.widthOfTextAtSize(label, 12), nw = F.bold.widthOfTextAtSize(num, 12);
  let dots = "";
  while (F.reg.widthOfTextAtSize(`${dots} .`, 12) < CW - lw - nw - 16) dots += " .";
  contents.drawText(dots, { x: M + lw + 6, y: cy, size: 12, font: F.reg, color: C.faint });
  contents.drawText(num, { x: M + CW - nw, y: cy, size: 12, font: F.bold, color: C.accent });
  cy -= 26;
}
contents.drawText(safe(`Built from the project's own documents, code, live data and test results on ${dateLong}.`), { x: M, y: cy - 14, size: 9.5, font: F.it, color: C.muted });

pages.forEach((p, i) => {
  if (i === 0) return;
  p.drawText("AI Workspace OS · Submission report", { x: M, y: H - M + 14, size: 8.5, font: F.bold, color: C.muted });
  const right = "AlphaHack 2026";
  p.drawText(right, { x: W - M - F.reg.widthOfTextAtSize(right, 8.5), y: H - M + 14, size: 8.5, font: F.reg, color: C.muted });
  p.drawLine({ start: { x: M, y: H - M + 8 }, end: { x: W - M, y: H - M + 8 }, thickness: 0.6, color: C.line });
  const label = `Page ${i + 1} of ${pages.length}`;
  p.drawText(label, { x: W / 2 - F.reg.widthOfTextAtSize(label, 8.5) / 2, y: M - 26, size: 8.5, font: F.reg, color: C.faint });
});

pdf.setTitle("AI Workspace OS: Submission report");
pdf.setSubject("Business model, solution, AI agents and test cases");
pdf.setProducer("AI Workspace OS");
pdf.setCreationDate(runDate);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, await pdf.save());
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${pages.length} pages, ${all.length} test cases (${count(all, "passed")} passed, ${count(all, "failed")} failed, ${count(all, "skipped")} skipped).`);
