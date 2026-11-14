import type { z } from "zod";
import type {
  BreakdownRule as BreakdownRuleSchema,
  DashboardSpec,
  LayoutItem as LayoutItemSchema,
  ListRule as ListRuleSchema,
  StatMetric as StatMetricSchema,
  Widget as WidgetSchema,
} from "../../shared/spec.js";

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
};

export type Status = {
  database: boolean;
  googleConfigured: boolean;
  gmail: GmailConnection | null;
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
export type SavedDashboard = DashboardSpecInput & { id: string; version: number; canUndo: boolean; updatedAt: string };

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
};
export type StoredMessageDetail = StoredMessage & { headers: { name: string; value: string }[]; bodyText: string | null };
export type MessagePage = { total: number; all: number; page: number; limit: number; messages: StoredMessage[] };

export const api = {
  messages: (p: { q?: string; page?: number; limit?: number; direction?: "in" | "out" | "" }) => {
    const qs = new URLSearchParams();
    if (p.q) qs.set("q", p.q);
    if (p.page) qs.set("page", String(p.page));
    if (p.limit) qs.set("limit", String(p.limit));
    if (p.direction) qs.set("direction", p.direction);
    return request<MessagePage>(`/api/messages?${qs}`);
  },
  message: (id: string) => request<StoredMessageDetail>(`/api/messages/${encodeURIComponent(id)}`),
  status: () => request<Status>("/api/status"),
  dashboard: () => request<Dashboard>("/api/dashboard"),
  sync: () => request<{ count: number }>("/api/integrations/gmail/sync", { method: "POST" }),
  loadSample: () => request<{ count: number }>("/api/integrations/gmail/sample", { method: "POST" }),
  disconnect: () => request<{ ok: true }>("/api/integrations/gmail", { method: "DELETE" }),
  connectUrl: "/api/auth/google/start",
  spec: () => request<SavedDashboard>("/api/dashboards/default"),
  saveSpec: (spec: DashboardSpecInput & { version: number }) =>
    request<SavedDashboard>("/api/dashboards/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    }),
  undoSpec: () => request<SavedDashboard>("/api/dashboards/default/undo", { method: "POST" }),
  resetSpec: () => request<SavedDashboard>("/api/dashboards/default/reset", { method: "POST" }),
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
