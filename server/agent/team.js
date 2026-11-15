// The agents of the workspace (decision #67): each one that uses Gemini has a name, a role, a plain description, an
// avatar (colour and icon, drawn by the app) and the agent above it. "sub-agent" means the agent above calls it
// directly as part of its own work; "team" means it works on its own when the app needs it, under the lead.
// Shared with the client through GET /api/agents.

export const TEAM = [
  {
    id: "layla", name: "Layla", role: "Lead assistant", parent: null, relation: null, icon: "sparkles", hue: "sky", reads: [],
    runs: "When you ask her something in the chat",
    does: "Answers your questions about sales, stock and customers from the database, recommends products, prepares invoices, updates your records (sales, purchases, expenses, customers, products, quotes, targets, settings) after you confirm each change, and changes your dashboards. Hands chart requests to Sami.",
  },
  {
    id: "sami", name: "Sami", role: "Dashboard builder", parent: "layla", relation: "sub-agent", icon: "chart", hue: "lavender", reads: ["Sales database"],
    runs: "When Layla asks for a chart",
    does: "Turns a request like \"monthly sales of the 5 kWh battery\" into a chart: finds the product, picks the measure and the chart, and checks the numbers before it goes on the board.",
  },
  {
    id: "nadia", name: "Nadia", role: "Email analyst", parent: "layla", relation: "team", icon: "mail", hue: "rose", reads: ["Gmail"],
    runs: "After each Gmail sync",
    does: "Sorts new email threads by topic and priority, writes a summary, the reason and a next step for each, and spots meetings, deadlines and meeting requests for the Schedule.",
  },
  {
    id: "lina", name: "Lina", role: "Document reader", parent: "nadia", relation: "sub-agent", alsoFor: ["hadi"], icon: "scan", hue: "teal", reads: ["Attachments"],
    runs: "When an attachment is a photo or a scanned PDF",
    does: "Reads images and scanned documents (photos of invoices, receipts, delivery notes) that have no text inside, so Nadia and Hadi can use what they say.",
  },
  {
    id: "hadi", name: "Hadi", role: "Files clerk", parent: "layla", relation: "team", icon: "folder", hue: "amber", reads: ["Attachments"],
    runs: "After each Gmail sync, for new attachments",
    does: "Files every attachment under its contact with a short summary and the figures it holds (invoice numbers, totals, dates), which feed Payments and stock.",
  },
  {
    id: "rayan", name: "Rayan", role: "Email writer", parent: "layla", relation: "team", icon: "pen", hue: "indigo", reads: ["Gmail", "Sales database"],
    runs: "When you ask for a suggested reply, rewrite one with your instructions, or ask the assistant to write an email",
    does: "Drafts email replies (checking live stock first so he never promises what isn't there) and new emails the assistant asks for, and rewrites them as you instruct. You edit and approve every one before anything is sent.",
  },
  {
    id: "tala", name: "Tala", role: "Telegram analyst", parent: "layla", relation: "team", icon: "send", hue: "green", reads: ["Telegram"],
    runs: "When you open a followed Telegram chat",
    does: "Reads a Telegram chat and notes what was discussed, promises on both sides, follow-ups, who is waiting on whom, and a message you could send next.",
  },
];

/** Work that isn't any agent's (a Gemini call made outside a run). */
export const APP_AGENT = { id: "app", name: "Workspace", role: "Other AI work", parent: null, relation: null, icon: "cpu", hue: "slate", reads: [], runs: "", does: "Gemini calls made outside an agent's task." };

const byId = new Map([...TEAM, APP_AGENT].map((a) => [a.id, a]));
export const agentById = (id) => byId.get(id) ?? APP_AGENT;
