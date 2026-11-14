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

/** One turn of the assistant (POST /api/assistant/message or /confirm). */
export type AssistantReply = {
  reply: string;
  pendingInvoice: InvoiceProposal | null;
  invoice: InvoiceDraft | null;
  toolsUsed: string[];
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
export type Board = "default" | "sales";
export type SavedDashboard =DashboardSpecInput & { id: string; version: number; canUndo: boolean; updatedAt: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error("Can't reach the server. Is `npm run dev` running?");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
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

export const api = {
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
  draftReply: (threadId: string) =>
    request<ReplyDraft>("/api/replies/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId }),
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
  assistantMessage: (threadId: string, message: string) =>
    request<AssistantReply>("/api/assistant/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, message }),
    }),
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
