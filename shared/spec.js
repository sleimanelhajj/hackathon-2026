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

/** @type {Record<z.infer<typeof InsightFocus>, string>} */
export const INSIGHT_FOCUS_LABELS = {
  "high-priority": "Needs your attention",
  ...Object.fromEntries(Object.entries(CATEGORY_LABELS).map(([k, v]) => [k, v.title])),
};

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const title = z.string().trim().min(1).max(60);

export const Widget = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("stat"), title, metric: StatMetric }),
  z.object({ id, type: z.literal("thread-list"), title, list: ThreadList }),
  z.object({ id, type: z.literal("rule-list"), title, rule: ListRule }),
  z.object({ id, type: z.literal("breakdown"), title, rule: BreakdownRule }),
  z.object({ id, type: z.literal("activity-chart"), title, days: z.number().int().min(7).max(30) }),
  z.object({ id, type: z.literal("top-people"), title, limit: z.number().int().min(3).max(10) }),
  z.object({ id, type: z.literal("insight-list"), title, focus: InsightFocus }),
  z.object({ id, type: z.literal("category-breakdown"), title }),
]);

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
    { id: "rule-attachments", type: "rule-list", title: "Emails with attachments", rule: "attachments" },
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
    { i: "rule-attachments", x: 0, y: 39, w: 7, h: 8 },
    { i: "breakdown-newsletters", x: 7, y: 39, w: 5, h: 8 },
  ],
};
