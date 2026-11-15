// Dashboard spec shared by the API (server/) and the web app (src/).
// A dashboard is data: a list of widgets from a fixed catalogue plus a grid layout.
// Everything (including anything an AI produces later) must pass DashboardSpec before it's saved.
import { z } from "zod";

export const GRID_COLS = 12;

// Declared inline in z.enum so TypeScript keeps the literal values.
export const StatMetric = z.enum([
  "awaitingYou", "awaitingThem", "received", "sent", "people",
  "unreadImportant", "starred", "newContacts", "attachments",
  "meetingInvites", "ccOnly", "newsletters", "yourReplyHours", "theirReplyHours",
]);
export const ThreadList = z.enum(["awaitingYou", "awaitingThem"]);
export const ListRule = z.enum([
  "unreadImportant", "starred", "newContacts", "attachments", "meetingInvites", "ccOnly",
]);
export const BreakdownRule = z.enum(["topDomains", "newsletters", "busiestHours", "labels"]);

// AI email analysis (server/agent/classify.js). Every value here is *inferred* by a model and labelled so in the UI,
// except "automated", which code can also detect on its own (then it's *derived*).
export const Category = z.enum(["lead", "proposal", "request", "scheduling", "billing", "support", "internal", "automated", "other"]);
export const Priority = z.enum(["high", "medium", "low"]);
/** What an "AI-sorted emails" list shows: one category, or everything marked high priority. */
export const InsightFocus = z.enum(["high-priority", "lead", "proposal", "request", "scheduling", "billing", "support", "internal", "automated", "other"]);

export const CATEGORY_LABELS = {
  lead: { title: "Potential leads", hint: "Someone new who may want to buy or work with you" },
  proposal: { title: "Proposals and deals", hint: "Quotes, pricing, contracts, negotiations" },
  request: { title: "Customer requests", hint: "An existing customer or partner asking for something" },
  scheduling: { title: "Scheduling", hint: "Meetings, calls, demos, rescheduling" },
  billing: { title: "Billing and invoices", hint: "Invoices, payments, receipts" },
  support: { title: "Problems and complaints", hint: "Something is broken or someone is unhappy" },
  internal: { title: "Internal", hint: "Your own team" },
  automated: { title: "Automated", hint: "Newsletters, notifications, no-reply senders" },
  other: { title: "Other", hint: "Personal or doesn't fit elsewhere" },
};

/**
 * Title and hint for a category. The shared database can hold categories from a newer version of the analysis
 * (e.g. a teammate's branch); show those by name instead of crashing.
 * @param {string} c
 * @returns {{ title: string, hint: string }}
 */
export function categoryInfo(c) {
  return CATEGORY_LABELS[c] ?? { title: c ? c[0].toUpperCase() + c.slice(1) : "Unknown", hint: "A category added by a newer version of the AI analysis" };
}

/** @type {Record<z.infer<typeof InsightFocus>, string>} */
export const INSIGHT_FOCUS_LABELS = {
  "high-priority": "Needs your attention",
  ...Object.fromEntries(Object.entries(CATEGORY_LABELS).map(([k, v]) => [k, v.title])),
};

// Sales board widgets
export const SalesMetric = z.enum(["revenue", "orders", "aov", "marginPct", "newCustomers", "winRate", "openPipeline", "purchases"]);
export const SalesBreakdownBy = z.enum(["category", "region"]);
export const SalesTable = z.enum(["topProducts", "topCustomers", "recentOrders"]);
export const SALES_METRIC_LABELS = {
  revenue: "Revenue", orders: "Orders", aov: "Average order", marginPct: "Gross margin",
  newCustomers: "New customers", winRate: "Win rate", openPipeline: "Open pipeline", purchases: "Purchases",
};
export const SALES_BREAKDOWN_LABELS = { category: "Revenue by category", region: "Revenue by region" };
export const SALES_TABLE_LABELS = { topProducts: "Top products", topCustomers: "Top customers", recentOrders: "Recent orders" };

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const title = z.string().trim().min(1).max(60);

// Custom sales widgets, made by the assistant's widget builder (decision #48). The widget stores a typed query, never
// SQL and never data: server/sales/custom.js turns it into fixed, parameterized SQL each time the widget loads.
export const CustomMetric = z.enum(["revenue", "orders", "units", "aov", "marginPct", "customers"]);
export const CustomGroupBy = z.enum(["none", "month", "week", "day", "category", "product", "branch", "staff", "channel", "segment", "customer"]);
export const CustomChart = z.enum(["number", "line", "bar", "table"]);
export const TIME_GROUPS = ["month", "week", "day"];
export const CUSTOM_METRIC_LABELS = { revenue: "Revenue", orders: "Orders", units: "Units sold", aov: "Average order", marginPct: "Gross margin", customers: "Customers" };
export const CUSTOM_GROUP_LABELS = { none: "Total", month: "Month", week: "Week", day: "Day", category: "Category", product: "Product", branch: "Branch", staff: "Staff", channel: "Channel", segment: "Customer type", customer: "Customer" };
const names = z.array(z.string().trim().min(1).max(80)).max(10).default([]);
export const CustomQuery = z.object({
  metric: CustomMetric,
  groupBy: CustomGroupBy.default("none"),
  months: z.number().int().min(1).max(24).default(12),
  limit: z.number().int().min(1).max(20).default(10),
  filters: z.object({
    products: names, // SKUs
    categories: names,
    branches: names,
    segments: names,
    channels: names,
    customers: z.array(z.number().int().positive()).max(10).default([]),
  }).prefault({}),
});

/** Plain-language reasons a custom widget's chart doesn't suit its query (empty when it's fine). */
export function customWidgetProblems(widget) {
  const { chart, query } = widget;
  const time = TIME_GROUPS.includes(query.groupBy);
  const problems = [];
  if (chart === "number" && query.groupBy !== "none") problems.push("A single number can't be grouped; use groupBy 'none', or a bar or table chart.");
  if (chart === "line" && !time) problems.push("A line chart shows change over time; group by month, week or day.");
  if ((chart === "bar" || chart === "table") && query.groupBy === "none") problems.push("Bars and tables need a group (month, product, branch…); use a number chart for a single total.");
  if (query.groupBy === "day" && query.months > 3) problems.push("Daily figures are limited to the last 3 months; group by week or month for longer periods.");
  return problems;
}

// Custom email widgets the assistant builds (decision #60): a typed query over the synced mail, never code.
export const EmailCustomQuery = z.object({
  metric: z.enum(["emails", "conversations", "people"]),
  groupBy: z.enum(["none", "sender", "company", "category", "priority", "direction", "day", "week"]),
  days: z.number().int().min(1).max(30).default(30),
  limit: z.number().int().min(3).max(20).default(10),
  filters: z.object({
    direction: z.enum(["any", "in", "out"]).default("any"),
    categories: z.array(Category).max(10).default([]),
    priorities: z.array(Priority).max(3).default([]),
    needsReply: z.boolean().nullable().default(null),
    from: z.string().trim().max(80).default(""),
    withAttachments: z.boolean().default(false),
  }).default(() => ({ direction: "any", categories: [], priorities: [], needsReply: null, from: "", withAttachments: false })),
});
export const EMAIL_METRIC_LABELS = { emails: "Emails", conversations: "Conversations", people: "People" };
/** Why a chart doesn't suit an email query, in plain words; [] when it does. */
export function emailChartProblems(chart, query) {
  const time = query.groupBy === "day" || query.groupBy === "week";
  const problems = [];
  if (chart === "number" && query.groupBy !== "none") problems.push("A number chart shows a single total; use groupBy none, or a bar or table for groups.");
  if (chart === "line" && !time) problems.push("A line chart shows change over time; group by day or week.");
  if ((chart === "bar" || chart === "table") && query.groupBy === "none") problems.push("Bars and tables need a group (sender, company, category…); use a number chart for a single total.");
  return problems;
}

export const Widget = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("stat"), title, metric: StatMetric }),
  z.object({ id, type: z.literal("thread-list"), title, list: ThreadList }),
  z.object({ id, type: z.literal("rule-list"), title, rule: ListRule }),
  z.object({ id, type: z.literal("breakdown"), title, rule: BreakdownRule }),
  z.object({ id, type: z.literal("activity-chart"), title, days: z.number().int().min(7).max(30) }),
  z.object({ id, type: z.literal("top-people"), title, limit: z.number().int().min(3).max(10) }),
  z.object({ id, type: z.literal("insight-list"), title, focus: InsightFocus }),
  z.object({ id, type: z.literal("category-breakdown"), title }),
  z.object({ id, type: z.literal("contacts"), title, show: z.enum(["all", "new"]) }),
  z.object({ id, type: z.literal("attachments"), title }),
  z.object({ id, type: z.literal("email-custom"), title, chart: CustomChart, query: EmailCustomQuery, note: z.string().trim().max(160).optional() }),
  // Invoices to pay and to collect, from email attachments and the app's invoices (decision #59)
  z.object({ id, type: z.literal("payments"), title, show: z.enum(["all", "to-pay", "to-collect"]) }),
  // Sales board (Postgres, decision #36)
  z.object({ id, type: z.literal("sales-kpi"), title, metric: SalesMetric }),
  z.object({ id, type: z.literal("sales-trend"), title }),
  z.object({ id, type: z.literal("sales-breakdown"), title, by: SalesBreakdownBy }),
  z.object({ id, type: z.literal("sales-pipeline"), title }),
  z.object({ id, type: z.literal("sales-reps"), title }),
  z.object({ id, type: z.literal("sales-table"), title, table: SalesTable }),
  z.object({ id, type: z.literal("sales-custom"), title, chart: CustomChart, query: CustomQuery, note: z.string().trim().max(160).optional() }),
  // Every invoice that moved stock, with Undo (decision #58)
  z.object({ id, type: z.literal("stock-changes"), title }),
]);
export const PAYMENTS_SHOW_LABELS = { all: "Payments", "to-pay": "Invoices to pay", "to-collect": "Invoices to collect" };

// ---------------------------------------------------------------------------
// Default business rules. Computed on the server in server/dashboard.js.
// `how` is shown under each widget so users know exactly what's counted.
// ---------------------------------------------------------------------------
export const LIST_RULES = {
  unreadImportant: { title: "Unread and important", how: "Unread, marked Important by Gmail, newsletters left out.", empty: "Nothing important is unread." },
  starred: { title: "Starred", how: "Emails you starred in Gmail.", empty: "No starred emails." },
  newContacts: { title: "New contacts this week", how: "People who emailed you for the first time in the last 7 days (external only).", empty: "No new contacts this week." },
  attachments: { title: "Emails with attachments", how: "Received emails with real attachments (inline images left out).", empty: "No attachments received." },
  meetingInvites: { title: "Meeting invites", how: "Emails that carry a calendar invite (.ics attachment).", empty: "No meeting invites." },
  ccOnly: { title: "You're only Cc'd", how: "You're in Cc but not in To, usually lower priority.", empty: "No Cc-only emails." },
};

export const BREAKDOWN_RULES = {
  topDomains: { title: "Top companies", how: "External sender domains by number of emails." },
  newsletters: { title: "Newsletters and notifications", how: "Bulk senders (unsubscribe link, mailing list, Promotions/Updates tabs)." },
  busiestHours: { title: "When email arrives", how: "Emails from people by hour of day (your computer's time zone)." },
  labels: { title: "Unread by label", how: "Gmail's own unread counts per label, across your whole mailbox." },
};


export const LayoutItem = z.object({
  i: id,
  x: z.number().int().min(0).max(GRID_COLS - 1),
  y: z.number().int().min(0).max(500),
  w: z.number().int().min(1).max(GRID_COLS),
  h: z.number().int().min(2).max(30),
});

export const DashboardSpec = z
  .object({
    title: title,
    widgets: z.array(Widget).max(24),
    layout: z.array(LayoutItem).max(24),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set(spec.widgets.map((w) => w.id));
    if (ids.size !== spec.widgets.length) ctx.addIssue({ code: "custom", message: "Widget ids must be unique" });
    const placed = new Set(spec.layout.map((l) => l.i));
    for (const wid of ids) if (!placed.has(wid)) ctx.addIssue({ code: "custom", message: `Widget ${wid} has no position` });
    for (const l of spec.layout) {
      if (!ids.has(l.i)) ctx.addIssue({ code: "custom", message: `Layout item ${l.i} has no widget` });
      if (l.x + l.w > GRID_COLS) ctx.addIssue({ code: "custom", message: `Widget ${l.i} is wider than the grid` });
    }
  });

/**
 * The catalogue: what users can add from the widget library.
 * size: default/min grid size (12 columns, row unit = 24px + 16px gap).
 */
export const CATALOG = {
  stat: {
    label: "Number",
    description: "One number: waiting on you, unread important, reply time…",
    size: { w: 3, h: 3, minW: 2, minH: 3, maxH: 4 },
    create: () => ({ type: "stat", title: "Waiting on you", metric: "awaitingYou" }),
  },
  "thread-list": {
    label: "Conversation list",
    description: "Threads waiting on you or on them",
    size: { w: 6, h: 9, minW: 4, minH: 5 },
    create: () => ({ type: "thread-list", title: "Waiting on your reply", list: "awaitingYou" }),
  },
  "rule-list": {
    label: "Rule list",
    description: "Emails matching a rule: starred, attachments, invites…",
    size: { w: 6, h: 9, minW: 4, minH: 5 },
    create: () => ({ type: "rule-list", title: "Unread and important", rule: "unreadImportant" }),
  },
  breakdown: {
    label: "Breakdown",
    description: "Top companies, newsletters, busiest hours, labels",
    size: { w: 4, h: 8, minW: 3, minH: 5 },
    create: () => ({ type: "breakdown", title: "Top companies", rule: "topDomains" }),
  },
  "activity-chart": {
    label: "Activity chart",
    description: "Emails received and sent per day",
    size: { w: 6, h: 8, minW: 4, minH: 6 },
    create: () => ({ type: "activity-chart", title: "Email activity", days: 14 }),
  },
  "top-people": {
    label: "Top people",
    description: "Who emails you most",
    size: { w: 4, h: 8, minW: 3, minH: 5 },
    create: () => ({ type: "top-people", title: "Who emails you most", limit: 5 }),
  },
  "insight-list": {
    label: "AI-sorted emails",
    description: "Leads, requests, invoices… sorted by AI, with the reason",
    size: { w: 8, h: 10, minW: 4, minH: 6 },
    create: () => ({ type: "insight-list", title: "Needs your attention", focus: "high-priority" }),
  },
  "category-breakdown": {
    label: "What your email is about",
    description: "How many threads fall into each AI category",
    size: { w: 4, h: 10, minW: 3, minH: 6 },
    create: () => ({ type: "category-breakdown", title: "What your email is about" }),
  },
  contacts: {
    label: "Contacts",
    description: "A folder per person with their conversations; new contacts marked",
    size: { w: 6, h: 10, minW: 4, minH: 6 },
    create: () => ({ type: "contacts", title: "Contacts", show: "all" }),
  },
  attachments: {
    label: "Attachments",
    description: "Every file you received or sent, with download",
    size: { w: 6, h: 9, minW: 4, minH: 5 },
    create: () => ({ type: "attachments", title: "Attachments" }),
  },
  // Made by the assistant from a plain-language request (decision #60), so it isn't offered in "Add widgets".
  "email-custom": {
    label: "Custom email chart",
    description: "Made by the assistant from your question",
    size: { w: 6, h: 9, minW: 3, minH: 3 },
    hidden: true,
    create: () => ({ type: "email-custom", title: "Emails by sender", chart: "bar", query: { metric: "emails", groupBy: "sender", days: 30, limit: 10, filters: {} } }),
  },
  payments: {
    label: "Payments",
    description: "Invoices to pay and to collect, by due date and priority",
    size: { w: 6, h: 10, minW: 4, minH: 6 },
    create: () => ({ type: "payments", title: "Payments", show: "all" }),
  },
};

/** format: "count" (default) or "hours" (shown as a duration). */
export const STAT_LABELS = {
  awaitingYou: { title: "Waiting on you", note: "Last message is theirs" },
  awaitingThem: { title: "Waiting on them", note: "No reply for 3+ days" },
  received: { title: "Received", note: "Emails in, last 30 days" },
  sent: { title: "Sent", note: "Emails out, last 30 days" },
  people: { title: "People", note: "Wrote to you" },
  unreadImportant: { title: "Unread important", note: "Gmail's Important + unread" },
  starred: { title: "Starred", note: "Your own follow-up list" },
  newContacts: { title: "New contacts", note: "First email in the last 7 days" },
  attachments: { title: "With attachments", note: "Received, last 30 days" },
  meetingInvites: { title: "Meeting invites", note: "Calendar invites received" },
  ccOnly: { title: "Cc only", note: "You're not in To" },
  newsletters: { title: "Newsletters", note: "Bulk emails received" },
  yourReplyHours: { title: "Your reply time", note: "Median, last 30 days", format: "hours" },
  theirReplyHours: { title: "Their reply time", note: "Median, last 30 days", format: "hours" },
};

export const DEFAULT_SPEC = {
  title: "Gmail overview",
  widgets: [
    { id: "stat-awaiting-you", type: "stat", title: "Waiting on you", metric: "awaitingYou" },
    { id: "stat-unread-important", type: "stat", title: "Unread important", metric: "unreadImportant" },
    { id: "stat-starred", type: "stat", title: "Starred", metric: "starred" },
    { id: "stat-reply-time", type: "stat", title: "Your reply time", metric: "yourReplyHours" },
    { id: "ai-attention", type: "insight-list", title: "Needs your attention", focus: "high-priority" },
    { id: "ai-categories", type: "category-breakdown", title: "What your email is about" },
    { id: "list-awaiting-you", type: "thread-list", title: "Waiting on your reply", list: "awaitingYou" },
    { id: "rule-unread-important", type: "rule-list", title: "Unread and important", rule: "unreadImportant" },
    { id: "list-awaiting-them", type: "thread-list", title: "Waiting on their reply", list: "awaitingThem" },
    { id: "rule-meeting-invites", type: "rule-list", title: "Meeting invites", rule: "meetingInvites" },
    { id: "activity", type: "activity-chart", title: "Email activity", days: 14 },
    { id: "breakdown-domains", type: "breakdown", title: "Top companies", rule: "topDomains" },
    { id: "attachments", type: "attachments", title: "Attachments" },
    { id: "contacts", type: "contacts", title: "Contacts", show: "all" },
    { id: "breakdown-newsletters", type: "breakdown", title: "Newsletters and notifications", rule: "newsletters" },
  ],
  layout: [
    { i: "stat-awaiting-you", x: 0, y: 0, w: 3, h: 3 },
    { i: "stat-unread-important", x: 3, y: 0, w: 3, h: 3 },
    { i: "stat-starred", x: 6, y: 0, w: 3, h: 3 },
    { i: "stat-reply-time", x: 9, y: 0, w: 3, h: 3 },
    { i: "ai-attention", x: 0, y: 3, w: 8, h: 10 },
    { i: "ai-categories", x: 8, y: 3, w: 4, h: 10 },
    { i: "list-awaiting-you", x: 0, y: 13, w: 7, h: 9 },
    { i: "rule-unread-important", x: 7, y: 13, w: 5, h: 9 },
    { i: "list-awaiting-them", x: 0, y: 22, w: 7, h: 9 },
    { i: "rule-meeting-invites", x: 7, y: 22, w: 5, h: 9 },
    { i: "activity", x: 0, y: 31, w: 8, h: 8 },
    { i: "breakdown-domains", x: 8, y: 31, w: 4, h: 8 },
    { i: "attachments", x: 0, y: 39, w: 7, h: 8 },
    { i: "contacts", x: 0, y: 47, w: 12, h: 10 },
    { i: "breakdown-newsletters", x: 7, y: 39, w: 5, h: 8 },
  ],
};

/** What users can add to the sales board (same shape as CATALOG). */
export const SALES_CATALOG = {
  "sales-kpi": {
    label: "Sales number",
    description: "One headline figure: revenue, orders, margin, win rate…",
    size: { w: 2, h: 3, minW: 2, minH: 3, maxH: 4 },
    create: () => ({ type: "sales-kpi", title: "Revenue", metric: "revenue" }),
  },
  "sales-trend": {
    label: "Revenue by month",
    description: "This period against the same months last year",
    size: { w: 8, h: 10, minW: 4, minH: 7 },
    create: () => ({ type: "sales-trend", title: "Revenue by month" }),
  },
  "sales-breakdown": {
    label: "Revenue breakdown",
    description: "Revenue by product category or by region",
    size: { w: 4, h: 9, minW: 3, minH: 5 },
    create: () => ({ type: "sales-breakdown", title: "Revenue by category", by: "category" }),
  },
  "sales-pipeline": {
    label: "Pipeline",
    description: "Open deals by stage, plus won and lost",
    size: { w: 6, h: 9, minW: 4, minH: 6 },
    create: () => ({ type: "sales-pipeline", title: "Pipeline" }),
  },
  "sales-reps": {
    label: "Reps vs target",
    description: "Each sales rep's revenue against their target",
    size: { w: 6, h: 10, minW: 4, minH: 6 },
    create: () => ({ type: "sales-reps", title: "Sales reps vs target" }),
  },
  "sales-table": {
    label: "Sales table",
    description: "Top products, top customers or recent orders",
    size: { w: 6, h: 9, minW: 4, minH: 5 },
    create: () => ({ type: "sales-table", title: "Top products", table: "topProducts" }),
  },
  "stock-changes": {
    label: "Stock from invoices",
    description: "Every invoice that changed stock (sent or received), with Undo",
    size: { w: 6, h: 10, minW: 4, minH: 6 },
    create: () => ({ type: "stock-changes", title: "Stock changes from invoices" }),
  },
  // Made by the assistant from a plain-language request, so it isn't offered in the manual "Add widgets" panel.
  "sales-custom": {
    label: "Custom chart",
    description: "Made by the assistant from your question",
    size: { w: 6, h: 9, minW: 3, minH: 3 },
    hidden: true,
    create: () => ({ type: "sales-custom", title: "Revenue by month", chart: "line", query: { metric: "revenue", groupBy: "month", months: 12, limit: 10, filters: {} } }),
  },
};

export const DEFAULT_SALES_SPEC = {
  title: "Sales overview",
  widgets: [
    { id: "kpi-revenue", type: "sales-kpi", title: "Revenue", metric: "revenue" },
    { id: "kpi-orders", type: "sales-kpi", title: "Orders", metric: "orders" },
    { id: "kpi-aov", type: "sales-kpi", title: "Average order", metric: "aov" },
    { id: "kpi-margin", type: "sales-kpi", title: "Gross margin", metric: "marginPct" },
    { id: "kpi-win-rate", type: "sales-kpi", title: "Win rate", metric: "winRate" },
    { id: "kpi-pipeline", type: "sales-kpi", title: "Open pipeline", metric: "openPipeline" },
    { id: "revenue-trend", type: "sales-trend", title: "Revenue by month" },
    { id: "by-category", type: "sales-breakdown", title: "Revenue by category", by: "category" },
    { id: "pipeline", type: "sales-pipeline", title: "Pipeline" },
    { id: "reps", type: "sales-reps", title: "Sales reps vs target" },
    { id: "top-products", type: "sales-table", title: "Top products", table: "topProducts" },
    { id: "top-customers", type: "sales-table", title: "Top customers", table: "topCustomers" },
    { id: "by-region", type: "sales-breakdown", title: "Revenue by region", by: "region" },
    { id: "recent-orders", type: "sales-table", title: "Recent orders", table: "recentOrders" },
    { id: "stock-changes", type: "stock-changes", title: "Stock changes from invoices" },
  ],
  layout: [
    { i: "kpi-revenue", x: 0, y: 0, w: 2, h: 3 },
    { i: "kpi-orders", x: 2, y: 0, w: 2, h: 3 },
    { i: "kpi-aov", x: 4, y: 0, w: 2, h: 3 },
    { i: "kpi-margin", x: 6, y: 0, w: 2, h: 3 },
    { i: "kpi-win-rate", x: 8, y: 0, w: 2, h: 3 },
    { i: "kpi-pipeline", x: 10, y: 0, w: 2, h: 3 },
    { i: "revenue-trend", x: 0, y: 3, w: 8, h: 10 },
    { i: "by-category", x: 8, y: 3, w: 4, h: 10 },
    { i: "pipeline", x: 0, y: 13, w: 6, h: 10 },
    { i: "reps", x: 6, y: 13, w: 6, h: 10 },
    { i: "top-products", x: 0, y: 23, w: 6, h: 10 },
    { i: "top-customers", x: 6, y: 23, w: 6, h: 10 },
    { i: "by-region", x: 0, y: 33, w: 5, h: 9 },
    { i: "recent-orders", x: 5, y: 33, w: 7, h: 9 },
    { i: "stock-changes", x: 0, y: 42, w: 12, h: 10 },
  ],
};

/** Every dashboard ("board"): its widget catalogue and its default layout. */
/** The main board and extra pages take any widget, email or sales (decision #60). */
export const MAIN_CATALOG = { ...CATALOG, ...SALES_CATALOG };

export const DEFAULT_MAIN_SPEC = {
  title: "Overview",
  widgets: [
    { id: "kpi-revenue", type: "sales-kpi", title: "Revenue", metric: "revenue" },
    { id: "kpi-orders", type: "sales-kpi", title: "Orders", metric: "orders" },
    { id: "stat-awaiting-you", type: "stat", title: "Waiting on you", metric: "awaitingYou" },
    { id: "kpi-purchases", type: "sales-kpi", title: "Purchases", metric: "purchases" },
    { id: "payments", type: "payments", title: "Payments", show: "all" },
    { id: "ai-attention", type: "insight-list", title: "Needs your attention", focus: "high-priority" },
    { id: "revenue-trend", type: "sales-trend", title: "Revenue by month" },
    { id: "list-awaiting-you", type: "thread-list", title: "Waiting on your reply", list: "awaitingYou" },
  ],
  layout: [
    { i: "kpi-revenue", x: 0, y: 0, w: 3, h: 3 },
    { i: "kpi-orders", x: 3, y: 0, w: 3, h: 3 },
    { i: "stat-awaiting-you", x: 6, y: 0, w: 3, h: 3 },
    { i: "kpi-purchases", x: 9, y: 0, w: 3, h: 3 },
    { i: "payments", x: 0, y: 3, w: 6, h: 10 },
    { i: "ai-attention", x: 6, y: 3, w: 6, h: 10 },
    { i: "revenue-trend", x: 0, y: 13, w: 8, h: 10 },
    { i: "list-awaiting-you", x: 8, y: 13, w: 4, h: 10 },
  ],
};

export const BOARDS = {
  default: { catalog: CATALOG, spec: DEFAULT_SPEC },
  sales: { catalog: SALES_CATALOG, spec: DEFAULT_SALES_SPEC },
  main: { catalog: MAIN_CATALOG, spec: DEFAULT_MAIN_SPEC },
};

/** Extra dashboard pages: "page-" and six lowercase letters or digits (server/pages.js). */
export const PAGE_ID = /^page-[a-z0-9]{6}$/;
/** A board's catalogue and default layout; extra pages are main boards. null for anything else. */
export function boardDef(board) {
  const key = String(board ?? "");
  if (Object.hasOwn(BOARDS, key)) return BOARDS[key];
  return PAGE_ID.test(key) ? BOARDS.main : null;
}

/** Every widget type on any board, for size lookups that only need the type. */
export const WIDGET_CATALOG = { ...CATALOG, ...SALES_CATALOG };
