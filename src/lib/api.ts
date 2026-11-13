import type { z } from "zod";
import type {
  Category as CategorySchema,
  DashboardSpec,
  InsightFocus as InsightFocusSchema,
  LayoutItem as LayoutItemSchema,
  Priority as PrioritySchema,
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
  analysis: AnalysisState | null;
};

export type Status = {
  database: boolean;
  googleConfigured: boolean;
  gemini: { configured: boolean; model: string };
  gmail: GmailConnection | null;
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
      totals: { received: number; sent: number; people: number; awaitingYou: number; awaitingThem: number };
      awaitingYou: ThreadRow[];
      awaitingThem: ThreadRow[];
      topPeople: { name: string; email: string; count: number }[];
      activity: { date: string; received: number; sent: number }[];
      insights: Insights;
    };

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

export const api = {
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
