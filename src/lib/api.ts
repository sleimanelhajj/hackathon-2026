import { ApiError, messageForStatus } from "./errors";
import type { z } from "zod";
import type {
  BreakdownRule as BreakdownRuleSchema,
  Category as CategorySchema,
  DashboardSpec,
  InsightFocus as InsightFocusSchema,
  LayoutItem as LayoutItemSchema,
  ListRule as ListRuleSchema,
  Priority as PrioritySchema,
  StatMetric as StatMetricSchema,
  Widget as WidgetSchema,
} from "../../shared/spec.js";

export type Category = z.infer<typeof CategorySchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type InsightFocus = z.infer<typeof InsightFocusSchema>;

export type AnalysisStatus = "never" | "not_configured" | "running" | "done" | "error";

export type AnalysisState = {
  status: AnalysisStatus;
  error: string | null;
  progress: { done: number; total: number } | null;
  lastRunAt: string | null;
  counts: { analysed: number; derived: number; unchanged: number; failed: number } | null;
};

export type GmailConnection = {
  mode: "live" | "sample";
  email: string;
  status: "connected" | "syncing" | "error";
  scopes: string[];
  lastSyncAt: string | null;
  lastSyncCount: number | null;
  error: string | null;
  connectedAt: string | null;
  syncProgress: { done: number; total: number; phase: string } | null;
  /** Automatic sync (decision #52): on unless turned off; the server checks every autoSyncEverySeconds. */
  autoSync?: boolean;
  autoSyncCheckedAt?: string | null;
  autoSyncEverySeconds?: number;
  mailbox: { messagesTotal: number; threadsTotal: number } | null;
  analysis: AnalysisState | null;
  /** True when Gmail granted the send scope (needed to send approved replies). */
  canSend: boolean;
};

export type Status = {
  database: boolean;
  googleConfigured: boolean;
  gemini: { configured: boolean; model: string };
  companyData: { configured: boolean; name: string };
  gmail: GmailConnection | null;
};

export type AgentSource = {
  id: string;
  label: string;
  url: string | null;
  kind: "company" | "customer" | "product" | "service" | "pricing" | "billing" | "order" | "project" | "other";
};

export type InvoiceDraft = {
  id: string;
  invoiceNumber: string;
  customer: { name: string; email: string | null; address: string | null };
  currency: string;
  issueDate: string;
  dueDate: string;
  lineItems: { description: string; quantity: number; unitPriceMinor: number; totalMinor: number }[];
  subtotalMinor: number;
  taxRateBps: number;
  taxMinor: number;
  totalMinor: number;
  notes: string | null;
  status: "draft" | "sending" | "sent";
  readiness: { ready: boolean; reasons: string[] };
  pdfUrl: string;
  sentAt?: string | null;
};

/** An invoice the assistant prepared from database facts, waiting for the user to confirm it (not created yet). */
export type InvoiceProposal = {
  customer: { name: string; email: string | null; address: string | null };
  currency: string;
  issueDate: string;
  dueDate: string;
  lineItems: { description: string; quantity: number; unitPriceMinor: number; totalMinor: number }[];
  subtotalMinor: number;
  taxRateBps: number;
  taxMinor: number;
  totalMinor: number;
  notes: string | null;
  warnings?: string[];
};

/** A widget the assistant added to a board (a custom chart, or a ready-made widget without a chart or summary). */
export type AddedWidget = { board: Board; boardName?: string; id: string; title: string; chart: "number" | "line" | "bar" | "table" | null; summary: string | null };

/** A change to the sales records the assistant proposes (decision #68): exactly what will change, waiting for Save. */
export type ChangeDraft = {
  id: string; kind: string; title: string; target: string; warnings: string[];
  fields: { label: string; before: string | number | null; after: string | number | null }[];
  lines?: { sku: string; name: string; quantity: number; unitPrice: number; amount: number }[];
  total?: number; number?: string | null;
};
/** A change the user saved; `id` undoes it. */
export type AppliedChange = { applied: true; id: string; kind: string; title: string; target: string; summary: string };

/** One turn of the assistant (POST /api/assistant/message or /confirm). */
export type AssistantReply = {
  reply: string;
  pendingInvoice: InvoiceProposal | null;
  /** A change to the records waiting for Save (decision #68). */
  pendingChange: ChangeDraft | null;
  /** Changes saved this turn. */
  applied: AppliedChange[];
  invoice: InvoiceDraft | null;
  toolsUsed: string[];
  widgets: AddedWidget[];
  /** Widgets the assistant removed; `version` is the board's version right after, so Undo can check nothing changed. */
  removed: { board: Board; id: string; title: string; version: number }[];
  /** Widgets the assistant resized (sizes in grid columns and rows); `limited` means the widget can't go further. */
  resized: ResizedWidget[];
  /** A new email the email writer drafted this turn (decision #69): shown to edit, rewrite or send. */
  emailDraft?: EmailDraft | null;
};

export type EmailDraft = { to: string; toName: string; subject: string; body: string; note: string | null };

export type ResizedWidget = { board: Board; id: string; title: string; version: number; from: { w: number; h: number }; to: { w: number; h: number }; limited: boolean };

/** One item of the email schedule (GET /api/schedule). Dates are ISO strings. */
export type ScheduleItem = {
  id: string;
  kind: "reply" | "follow-up" | "meeting" | "deadline";
  priority?: "high" | "medium" | "low";
  title: string;
  start: string;
  end: string;
  why: string;
  threadId: string;
  link: string | null;
  contact?: string | null;
  subject?: string;
  summary?: string | null;
  suggestedAction?: string | null;
  category?: string | null;
  overdue?: boolean;
  dueAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  /** Set for a meeting someone asked for (decision #55). */
  request?: { id: string; status: MeetingRequest["status"]; reason: MeetingRequest["reason"] };
};

/** One attachment with its AI summary and the figures it states (decision #56). */
export type DocFile = {
  _id: string; gmailId: string; threadId: string; attachmentId: string; partId: string; filename: string; mimeType: string | null; size: number | null;
  direction: "in" | "out"; sentAt: string; subject: string | null; status: "ok" | "no-text" | "failed";
  docType: string; title: string; summary: string | null; number: string | null; issueDate: string | null; dueDate: string | null;
  currency: string | null; total: number | null; issuer: string | null; billedTo: string | null;
  lines: { description: string; sku: string | null; quantity: number | null; unitPrice: number | null; total: number | null }[];
  contact: { key: string; name: string; kind: "company" | "person"; email: string; domain: string };
};
export type DocFolder = { key: string; name: string; kind: "company" | "person"; emails: string[]; count: number; lastAt: string | null; types: Record<string, number>; docs: DocFile[] };
export type FilesResponse = { folders: DocFolder[]; pending: number; reading: boolean; aiConfigured: boolean };

/** An invoice to pay or collect (decision #59). */
export type Payment = {
  id: string; source: "app" | "email"; direction: "to-pay" | "to-collect"; counterparty: string | null; number: string | null; total: number | null;
  currency: string | null; issueDate: string | null; dueDate: string | null; threadId: string | null; filename: string | null; ai: boolean;
  status: "overdue" | "due-soon" | "due" | "no-due-date" | "paid"; priority: "high" | "medium" | "low";
};
export type PaymentsResponse = { items: Payment[]; totals: { toPay: number; toCollect: number; overdue: number; currency: string }; generatedAt: string };

/** One invoice that moved stock (decision #58). */
export type StockChange = {
  key: string; kind: "sale" | "purchase"; number: string | null; counterparty: string | null; total: number | null; currency: string | null;
  invoiceDate: string | null; source: "app" | "email" | null; appliedAt: string; undoneAt: string | null;
  lines: { sku: string; name: string; change: number }[]; unmatched: { description: string; reason: string }[];
};

/** Wall-clock time slots ["09:00", "12:00"] per weekday, plus changes for dates ("2026-11-20": [] is a day off). */
export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type Availability = { weekly: Record<Weekday, [string, string][]>; dates: Record<string, [string, string][]> };

/** A meeting someone asked for, and what happened to it. */
export type MeetingRequest = {
  id: string;
  threadId: string;
  title: string;
  contact: string | null;
  source: "email-text" | "invite";
  start: string;
  end: string;
  receivedAt: string;
  status: "pending" | "accepted" | "confirmed" | "auto-declined" | "declined" | "superseded";
  reason: "past" | "clash" | "outside" | "before-setup" | null;
  clashWith: string | null;
  decidedAt: string;
  decidedBy: "rules" | "user";
  email: { kind: "past" | "clash" | "declined" | "accepted"; body: string; sentAt: string | null; error: string | null; dryRun: boolean } | null;
};

export type Schedule = {
  connected: boolean;
  sample?: boolean;
  timeZone: string;
  generatedAt?: string;
  account?: string;
  items: ScheduleItem[];
  analysis?: { status: string | null; analysed: number };
  calendar?: { canSync: boolean; name: string; lastSyncAt: string | null; syncedCount: number };
  meetings?: {
    /** null until the user saves it; after that, meeting requests are answered. */
    availability: Availability | null;
    defaultAvailability: Availability;
    timeZone: string;
    activatedAt: string | null;
    /** Replies are recorded but not sent (sample data, or MEETING_EMAILS=dry-run). */
    dryRun: boolean;
    requests: MeetingRequest[];
  };
};
export type ScheduleSyncResult = { created: number; updated: number; unchanged: number; removed: number; failed: number; total: number; calendarName: string; calendarId: string };

/** Data for a custom sales widget (POST /api/sales/custom). */
export type CustomResult = {
  metric: string;
  groupBy: string;
  unit: "USD" | "count" | "percent";
  period: { from: string; to: string; months: number };
  rows: { key: string; value: number | null }[];
  total: number;
  previousTotal: number | null;
  filters: string[];
};

/** Data for a list widget (POST /api/sales/records, decision #69). */
export type RecordsResult = {
  dataset: string;
  label: string;
  columns: { key: string; label: string; unit: "text" | "USD" | "count" | "percent" | "date" }[];
  rows: Record<string, string | number | null>[];
  total: number;
  period: { from: string; to: string; months: number };
  filters: string[];
};

export type AgentChatResponse = {
  answer: string;
  sources: AgentSource[];
  invoice: InvoiceDraft | null;
};

/** One thread as sorted by the AI analysis. Labels are inferred by a model (or derived by code for automated mail). */
export type InsightRow = {
  threadId: string;
  subject: string;
  contact: string;
  lastAt: string;
  waitingDays: number;
  link: string | null;
  category: Category;
  priority: Priority;
  needsReply: boolean;
  summary: string;
  reason: string;
  suggestedAction: string | null;
  certainty: "inferred" | "derived" | "confirmed";
  stale: boolean;
};

export type Insights = {
  configured: boolean;
  status: AnalysisStatus;
  error: string | null;
  progress: { done: number; total: number } | null;
  lastRunAt: string | null;
  model: string | null;
  analysedThreads: number;
  totalThreads: number;
  categories: { category: Category; count: number }[];
  rows: InsightRow[];
};

export type ThreadRow = {
  threadId: string;
  subject: string;
  snippet: string;
  contact: string;
  lastAt: string;
  waitingDays: number;
  messages: number;
  link: string | null;
};

export type Dashboard =
  | { connected: false }
  | {
      connected: true;
      mode: "live" | "sample";
      account: string;
      lastSyncAt: string | null;
      status: GmailConnection["status"];
      error: string | null;
      windowDays: number;
      /** Every stat metric; reply times are median hours (null when there's no data). */
      totals: Record<Exclude<StatMetric, "yourReplyHours" | "theirReplyHours">, number> & {
        yourReplyHours: number | null;
        theirReplyHours: number | null;
      };
      awaitingYou: ThreadRow[];
      awaitingThem: ThreadRow[];
      topPeople: { name: string; email: string; count: number }[];
      activity: { date: string; received: number; sent: number }[];
      rules: Record<ListRule, { count: number; items: RuleItem[] }>;
      breakdowns: Record<BreakdownRule, { key: string; label: string; value: number }[]>;
      insights: Insights;
      contacts: Contact[];
      attachments: { total: number; items: AttachmentFile[] };
    };

export type RuleItem = {
  id: string;
  threadId: string;
  contact: string;
  title: string;
  detail: string;
  at: string;
  link: string | null;
};
export type StatMetric = z.infer<typeof StatMetricSchema>;
export type ListRule = z.infer<typeof ListRuleSchema>;
export type BreakdownRule = z.infer<typeof BreakdownRuleSchema>;

export type Widget = z.infer<typeof WidgetSchema>;
export type WidgetType = Widget["type"];
export type GridItem = z.infer<typeof LayoutItemSchema>;
export type DashboardSpecInput = z.infer<typeof DashboardSpec>;
/** A dashboard with its own saved layout and widget catalogue (shared/spec.js BOARDS). */
/** "default" = Email dashboard, "sales" = Sales, "main" and "page-…" = the main Dashboard's pages (decision #60). */
export type Board = "default" | "sales" | "main" | `page-${string}`;
export type DashboardPageInfo = { id: Board; name: string };
export type EmailCustomResult = { rows: { key: string; value: number }[]; total: number; unit: "emails" | "conversations" | "people"; period: { from: string; to: string; days: number } };
export type SavedDashboard =DashboardSpecInput & { id: string; version: number; canUndo: boolean; updatedAt: string };

/** Every API call. Failures become an ApiError with a plain-language message (the server's own, when it sent one). */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(messageForStatus(0), 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof body?.error === "string" && body.error.trim() ? body.error : messageForStatus(res.status), res.status);
  return body as T;
}

export type Address = { name: string; email: string; domain?: string };
export type Attachment = { filename: string; mimeType: string; size: number; attachmentId: string | null; partId: string; inline: boolean };
/** One email exactly as stored after fetching it from Gmail (format=full). */
export type StoredMessage = {
  gmailId: string; threadId: string; historyId: string | null;
  date: string; sentAt: string | null; sizeEstimate: number | null;
  labelIds: string[]; category: string | null;
  from: Address; replyTo: Address | null; to: Address[]; cc: Address[]; bcc: Address[]; deliveredTo: string | null;
  subject: string; snippet: string;
  messageId: string | null; inReplyTo: string | null; references: string[];
  listUnsubscribe: string | null; listId: string | null; precedence: string | null; autoSubmitted: string | null; contentType: string | null;
  attachments: Attachment[]; hasAttachments: boolean; hasCalendarInvite: boolean; hasHtml: boolean; bodyTruncated: boolean;
  isUnread: boolean; isStarred: boolean; isImportant: boolean; direction: "in" | "out"; isInternal: boolean; isAutomated: boolean; isBulk: boolean;
  source: "gmail" | "sample"; syncedAt: string;
  /** From the AI analysis of this message's conversation (a guess), or null when it wasn't analysed. */
  ai?: { priority: Priority; category: Category; needsReply: boolean; certainty: InsightRow["certainty"] } | null;
};

/** One person you've emailed with, and their conversations (a "folder" in the Contacts widget). */
export type Contact = {
  email: string;
  name: string;
  domain: string;
  received: number;
  sent: number;
  lastAt: string;
  firstAt: string;
  isNew: boolean;
  isInternal: boolean;
  aiLead: boolean;
  needsReply: number;
  threadCount: number;
  threads: { threadId: string; subject: string; lastAt: string; link: string | null; category: Category | null; priority: Priority | null; needsReply: boolean }[];
};

export type AttachmentFile = {
  id: string;
  gmailId: string;
  attachmentId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  direction: "in" | "out";
  /** Who the file is filed under: the sender, or "You" for files you sent. */
  sender: { name: string; email: string };
  threadId: string;
  contact: string;
  subject: string;
  /** The conversation's topic from the AI, or null when it wasn't sorted. */
  topic: Category | null;
  /** One line on what the email says (the AI summary, else Gmail's preview). */
  summary: string;
  at: string;
  link: string | null;
  downloadable: boolean;
};

export type ReplyDraft = {
  threadId: string;
  to: { name: string; email: string }[];
  subject: string;
  body: string;
  note: string | null;
  model: string;
  /** Attachments whose text the draft was based on. */
  filesRead: string[];
  /** Live stock and list prices the draft was given (decision #57). */
  inventory?: { sku: string; name: string; inStock: number | null; unit: string | null; listPriceUSD: number; status: string }[];
  replyingTo: { from: string; date: string; snippet: string };
};

/** One conversation in full (GET /api/threads/:threadId). */
export type ThreadView = {
  threadId: string;
  subject: string;
  link: string | null;
  ai: { summary: string; category: Category; priority: Priority | null; needsReply: boolean; suggestedAction: string | null; reason: string | null } | null;
  messages: {
    gmailId: string;
    direction: "in" | "out";
    date: string;
    from: { name: string; email: string };
    to: { name: string; email: string }[];
    cc: { name: string; email: string }[];
    body: string;
    attachments: { filename: string; mimeType: string; size: number; gmailId: string; attachmentId: string | null; downloadable: boolean }[];
  }[];
};

/** Postgres connection state for the Sales page. */
export type SalesStatus = {
  configured: boolean;
  connected: boolean;
  counts: { customers: number; products: number; orders: number; deals: number; reps: number } | null;
  error: string | null;
};

/** Everything the Sales page shows (GET /api/sales/dashboard). `sample` is true while it's demo data. */
export type SalesDashboard = {
  sample: boolean;
  range: { from: string; to: string; months: number; prevFrom: string; prevTo: string };
  kpis: {
    revenue: number; revenuePrev: number; orders: number; ordersPrev: number; aov: number; aovPrev: number;
    marginPct: number; marginPctPrev: number; newCustomers: number; newCustomersPrev: number;
    winRate: number; winRatePrev: number; openPipeline: number; openDeals: number;
    /** Supplier invoices in the period (decision #58). */
    purchases?: number; purchasesPrev?: number; purchaseCount?: number;
  };
  monthly: { month: string; revenue: number; revenueLastYear: number; orders: number }[];
  byCategory: { key: string; revenue: number; share: number }[];
  byRegion: { key: string; revenue: number; share: number }[];
  topProducts: { name: string; category: string; revenue: number; units: number }[];
  topCustomers: { name: string; industry: string; region: string; revenue: number; orders: number }[];
  reps: { name: string; region: string; revenue: number; target: number; attainment: number; won: number }[];
  pipeline: { stage: "lead" | "qualified" | "proposal" | "negotiation" | "won" | "lost"; count: number; value: number; open: boolean }[];
  recentOrders: { number: string; customer: string; status: "paid" | "pending" | "refunded"; channel: string; orderedAt: string; total: number }[];
};

export type MessageFilters = {
  q?: string;
  page?: number;
  limit?: number;
  direction?: "in" | "out" | "";
  from?: string;
  status?: "" | "unread" | "starred" | "important" | "attachments" | "needsReply";
  priority?: "" | Priority;
  category?: "" | Category;
};
export type StoredMessageDetail = StoredMessage & { headers: { name: string; value: string }[]; bodyText: string | null };
export type MessagePage = { total: number; all: number; page: number; limit: number; messages: StoredMessage[] };

/** Telegram (decision #64): the account the user signed in with, and what was read. Read-only. */
export type TelegramStatus = {
  configured: boolean;
  connected: boolean;
  account: { id: string; name: string; username: string | null; phone: string | null } | null;
  status: "connected" | "syncing" | "error" | null;
  error: string | null;
  lastSyncAt: string | null;
  lastSyncCount: number | null;
  chatCount: number;
  /** A sign-in in progress: waiting for the code, or for the two-step password. */
  pending: "code" | "password" | null;
  /** The people the user follows, by name. Empty: the most recent chats. */
  people: string[];
  /** Whether the server can make AI insights (Gemini is set up). */
  insightsAvailable: boolean;
};
export type TelegramChat = { id: string; title: string; kind: "user" | "group" | "channel"; unread: number; lastMessageAt: string; messageCount: number };
export type TelegramMessage = { id: number; chatId: string; date: string; out: boolean; from: string | null; hasMedia: boolean; text: string };
/** One of the workspace's AI agents (server/agent/team.js, decision #67). */
export type Agent = {
  id: string; name: string; role: string; parent: string | null; relation: "sub-agent" | "team" | null;
  icon: string; hue: string; runs: string; does: string; reads: string[]; alsoFor?: string[];
};
/** Calls, tokens and cost of a group of Gemini calls. Output tokens include thinking. */
export type UsageTotals = { calls: number; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number; failed: number; unpriced: number };
export type LogCall = {
  at: string; agent: string; model: string; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number;
  priced: boolean; ok: boolean; error: string | null; fellBack: boolean; durationMs: number; runId: string; task: string;
};
export type LogUsage = {
  period: { days: number; from: string; to: string };
  totals: UsageTotals;
  byAgent: (UsageTotals & { agent: string })[];
  byModel: (UsageTotals & { model: string })[];
  byDay: (UsageTotals & { day: string })[];
  calls: LogCall[];
  prices: { source: string; checked: string; models: { model: string; from: string | null; until: string | null; inputPerMillion: number; outputPerMillion: number; note: string }[] };
};
export type RunStep = {
  seq: number; at: string; kind: "model" | "tool" | "agent"; name: string; ok: boolean; durationMs?: number; error?: string;
  model?: string; inputTokens?: number; outputTokens?: number; costUsd?: number; priced?: boolean; fellBack?: boolean;
  args?: string; detail?: string; task?: string; childRunId?: string;
};
/** One agent's task, with the runs of the agents it handed work to. */
export type AgentRun = {
  id: string; agent: string; task: string; trigger: "you" | "app" | "agent"; parentRunId: string | null; startedAt: string; endedAt: string;
  durationMs: number; ok: boolean; error: string | null; calls: number; inputTokens: number; outputTokens: number; costUsd: number;
  steps: RunStep[]; children: AgentRun[]; tree: { calls: number; inputTokens: number; outputTokens: number; costUsd: number; steps: number }; truncated?: boolean;
};

/** An AI guess about one chat; every promise and follow-up points at the message it comes from. */
export type TelegramInsight = {
  summary: string;
  topics: string[];
  waitingOn: "you" | "them" | "nobody";
  nextStep: string;
  promises: { by: "you" | "them"; what: string; due: string | null; messageId: number }[];
  followUps: { what: string; messageId: number }[];
  suggestedMessage: string;
  basedOn: number;
  generatedAt: string;
  model: string | null;
};

const postJson = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  agents: () => request<{ agents: Agent[]; other: Agent }>("/api/agents"),
  logUsage: (days: number) => request<LogUsage>(`/api/logs/usage?days=${days}`),
  logRuns: (days: number, limit = 30) => request<{ runs: AgentRun[] }>(`/api/logs/runs?days=${days}&limit=${limit}`),
  telegramStatus: () => request<TelegramStatus>("/api/integrations/telegram"),
  telegramSendCode: (phone: string) => postJson<{ sent: true; viaApp: boolean }>("/api/integrations/telegram/code", { phone }),
  telegramVerifyCode: (code: string) => postJson<{ connected?: true; needsPassword?: true }>("/api/integrations/telegram/verify", { code }),
  telegramVerifyPassword: (password: string) => postJson<{ connected: true }>("/api/integrations/telegram/password", { password }),
  telegramCancel: () => postJson<{ cancelled: true }>("/api/integrations/telegram/cancel", {}),
  telegramSync: () => postJson<{ chats: number; messages: number }>("/api/integrations/telegram/sync", {}),
  telegramDisconnect: () => request<{ disconnected: true }>("/api/integrations/telegram", { method: "DELETE" }),
  telegramChats: () => request<{ chats: TelegramChat[] }>("/api/telegram/chats"),
  telegramMessages: (chatId: string) => request<{ messages: TelegramMessage[] }>(`/api/telegram/chats/${encodeURIComponent(chatId)}/messages`),
  telegramSetPeople: (people: string[]) =>
    request<{ people: string[] }>("/api/integrations/telegram/people", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ people }) }),
  telegramInsight: (chatId: string) => request<TelegramInsight>(`/api/telegram/chats/${encodeURIComponent(chatId)}/insight`),
  telegramRefreshInsight: (chatId: string) => postJson<TelegramInsight>(`/api/telegram/chats/${encodeURIComponent(chatId)}/insight`, {}),
  /** Only after the user confirmed this exact text in the app's dialog. */
  telegramSend: (chatId: string, text: string) =>
    postJson<{ message: TelegramMessage }>(`/api/telegram/chats/${encodeURIComponent(chatId)}/send`, { text, confirmed: true }),
  messages: (p: MessageFilters) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "" && v !== 0) qs.set(k, String(v));
    return request<MessagePage>(`/api/messages?${qs}`);
  },
  message: (id: string) => request<StoredMessageDetail>(`/api/messages/${encodeURIComponent(id)}`),
  status: () => request<Status>("/api/status"),
  dashboard: () => request<Dashboard>("/api/dashboard"),
  sync: () => request<{ count: number }>("/api/integrations/gmail/sync", { method: "POST" }),
  loadSample: () => request<{ count: number }>("/api/integrations/gmail/sample", { method: "POST" }),
  disconnect: () => request<{ ok: true }>("/api/integrations/gmail", { method: "DELETE" }),
  runAnalysis: (force = false) =>
    request<{ started: boolean; queued?: boolean; reason?: string }>("/api/analysis/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    }),
  salesStatus: () => request<SalesStatus>("/api/sales/status"),
  salesDashboard: (months: number) => request<SalesDashboard>(`/api/sales/dashboard?months=${months}`),
  seedSales: () => request<{ ok: true; counts: NonNullable<SalesStatus["counts"]> }>("/api/sales/seed", { method: "POST" }),
  thread: (threadId: string) => request<ThreadView>(`/api/threads/${encodeURIComponent(threadId)}`),
  people: () => request<{ email: string; name: string; count: number }[]>("/api/messages/people"),
  /** A new AI draft; with `guidance` (the owner's instructions) it rewrites `current` to follow them (decision #69). */
  draftReply: (threadId: string, opts: { guidance?: string; current?: string } = {}) =>
    request<ReplyDraft>("/api/replies/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, ...opts }),
    }),
  /** The email writer rewrites a chat draft as asked. Nothing is sent. */
  rewriteEmail: (draft: { to: string; subject: string; body: string; instruction: string }) =>
    request<{ subject: string; body: string; note: string | null }>("/api/email/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }),
  /** Sends a new email for real. Only call this from a draft's Send button after the user confirmed it. */
  sendEmail: (email: { to: { name: string; email: string }[]; subject: string; body: string }) =>
    request<{ ok: true; id: string }>("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...email, approved: true }),
    }),
  /** Sends for real. Only call this from the Send button after the user has reviewed the reply. */
  sendReply: (reply: { threadId: string; to: { name: string; email: string }[]; subject: string; body: string }) =>
    request<{ ok: true; id: string }>("/api/replies/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...reply, approved: true }),
    }),
  attachmentUrl: (gmailId: string, attachmentId: string) =>
    `/api/attachments/${encodeURIComponent(gmailId)}/${encodeURIComponent(attachmentId)}`,
  connectUrl: "/api/auth/google/start",
  // Saved layouts, one per board ("default" = email dashboard, "sales" = Sales page).
  spec: (board: Board = "default") => request<SavedDashboard>(`/api/dashboards/${board}`),
  saveSpec: (spec: DashboardSpecInput & { version: number }, board: Board = "default") =>
    request<SavedDashboard>(`/api/dashboards/${board}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    }),
  undoSpec: (board: Board = "default") => request<SavedDashboard>(`/api/dashboards/${board}/undo`, { method: "POST" }),
  resetSpec: (board: Board = "default") => request<SavedDashboard>(`/api/dashboards/${board}/reset`, { method: "POST" }),
  agentChat: (messages: { role: "user" | "assistant"; text: string }[]) =>
    request<AgentChatResponse>("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages.slice(-10) }),
    }),
  setAutoSync: (enabled: boolean) =>
    request<{ autoSync: boolean }>("/api/integrations/gmail/auto-sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  schedule: (tz: string) => request<Schedule>(`/api/schedule?tz=${encodeURIComponent(tz)}`),
  /** Writes the schedule to the app's own Google calendar. Only called from the confirm dialog. */
  syncSchedule: (tz: string) =>
    request<ScheduleSyncResult>("/api/schedule/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true, tz }),
    }),
  files: () => request<FilesResponse>("/api/files"),
  pages: () => request<{ pages: DashboardPageInfo[] }>("/api/dashboard-pages"),
  createPage: (name: string) => request<DashboardPageInfo>("/api/dashboard-pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  renamePage: (id: Board, name: string) => request<DashboardPageInfo>(`/api/dashboard-pages/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  deletePage: (id: Board) => request<{ id: Board; deleted: true }>(`/api/dashboard-pages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  emailCustom: (query: Extract<Widget, { type: "email-custom" }>["query"]) =>
    request<EmailCustomResult>("/api/email/custom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) }),
  payments: () => request<PaymentsResponse>("/api/payments"),
  stockChanges: () => request<{ configured: boolean; changes: StockChange[] }>("/api/inventory/changes"),
  /** Reverses one invoice's stock change; only from the widget's confirm step. */
  undoStockChange: (key: string) =>
    request<{ key: string; undone: true }>(`/api/inventory/changes/${encodeURIComponent(key)}/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true }),
    }),
  saveAvailability: (availability: Availability, tz: string) =>
    request<{ ok: true }>("/api/meetings/availability", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ availability, tz }),
    }),
  /** Sends an email to the person who asked, so only from the request card's confirm step. */
  answerMeetingRequest: (id: string, accept: boolean) =>
    request<MeetingRequest>(`/api/meetings/requests/${encodeURIComponent(id)}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept, approved: true }),
    }),
  retryMeetingEmail: (id: string) =>
    request<MeetingRequest>(`/api/meetings/requests/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true }),
    }),
  salesCustom: (query: Extract<Widget, { type: "sales-custom" }>["query"]) =>
    request<CustomResult>("/api/sales/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }),
  salesRecords: (query: Extract<Widget, { type: "sales-records" }>["query"]) =>
    request<RecordsResult>("/api/sales/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }),
  removeWidget: (board: Board, id: string) =>
    request<SavedDashboard>(`/api/dashboards/${board}/widgets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  assistantMessage: (threadId: string, message: string) =>
    request<AssistantReply>("/api/assistant/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, message }),
    }),
  assistantUndoChange: (id: string) => postJson<{ undone: true; id: string; summary: string }>(`/api/assistant/changes/${encodeURIComponent(id)}/undo`, {}),
  assistantConfirm: (threadId: string, approve: boolean, message?: string) =>
    request<AssistantReply>("/api/assistant/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, approve, message }),
    }),
  sendInvoice: (id: string, input: { subject: string; body: string }) =>
    request<InvoiceDraft>(`/api/invoices/${encodeURIComponent(id)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, approved: true }),
    }),
};

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
