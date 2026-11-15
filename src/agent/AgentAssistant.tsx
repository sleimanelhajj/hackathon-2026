import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowRight, Scaling, BarChart3, Bot, CheckCircle2, Download, FileCheck2, FileText, Hash, LineChart, Loader2, Mail, MessageCircle, Pencil, RotateCcw, Send, ShieldCheck, Table2, Trash2, Undo2, X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type AddedWidget, type AssistantReply, type Board, type InvoiceDraft, type InvoiceProposal, type ResizedWidget, type Status } from "../lib/api";
import { useHighlight } from "../lib/store";
import { useStatus } from "../lib/queries";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolsUsed?: string[];
  proposal?: InvoiceProposal | null;
  /** What happened to the proposal on this message: still waiting, confirmed, or handed back for changes. */
  proposalState?: "waiting" | "confirmed" | "changed";
  invoice?: InvoiceDraft | null;
  widgets?: AddedWidget[];
  removed?: AssistantReply["removed"];
  resized?: AssistantReply["resized"];
  error?: boolean;
};

const SUGGESTIONS = [
  "How did sales go this month compared with last month?",
  "Which items need reordering?",
  "I'm repainting a 12 by 12 ft bedroom. What do I need?",
  "Show me monthly sales of the cordless drill",
  "Create an invoice for a trade customer",
];

/** Plain words for the tools the agent used, shown under its answer. */
const TOOL_LABELS: Record<string, string> = {
  sales_summary: "sales summary", sales_breakdown: "sales breakdown", find_products: "product catalogue",
  find_customers: "customer list", customer_history: "customer history", low_stock: "stock levels", lapsed_customers: "customer activity", sales_figures: "sales data",
  store_profile: "store profile", staff_performance: "staff targets", quote_pipeline: "trade quotes", propose_invoice: "invoice draft",
  add_dashboard_widget: "dashboard builder", list_dashboard_widgets: "dashboard widgets", remove_dashboard_widget: "dashboard widgets", resize_dashboard_widget: "dashboard widgets", create_dashboard_page: "dashboard pages", add_ready_widget: "dashboard widgets",
  add_email_widget: "email data", search_documents: "email files",
};

const newThread = () => crypto.randomUUID();
const formatMoney = (minor: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
};

/** **bold** inside a line. Text only: nothing from the model is ever rendered as HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
  );
}

/** Paragraphs and "- " / "* " / "1. " bullet lists from the model's plain text. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) { list.push(bullet[1]); continue; }
    flush();
    if (line) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

function ProposalCard({ proposal, state, busy, onConfirm, onChange }: {
  proposal: InvoiceProposal; state: ChatMessage["proposalState"]; busy: boolean; onConfirm: () => void; onChange: () => void;
}) {
  const money = (minor: number) => formatMoney(minor, proposal.currency);
  return (
    <section className="invoice-card" role="region" aria-label={`Invoice draft for ${proposal.customer.name}`}>
      <header className="invoice-card-head">
        <span className="invoice-icon"><FileText size={16} aria-hidden /></span>
        <div>
          <strong>{proposal.customer.name}</strong>
          <span>Issued {proposal.issueDate} · due {proposal.dueDate}</span>
        </div>
        <span className="tag" data-tone={state === "confirmed" ? "ok" : state === "changed" ? undefined : "accent"}>
          {state === "confirmed" ? "Confirmed" : state === "changed" ? "Being changed" : "Draft, not created"}
        </span>
      </header>
      <div className="invoice-lines">
        {proposal.lineItems.map((item, index) => (
          <div className="invoice-line" key={`${item.description}-${index}`}>
            <span>{item.description}<span className="invoice-line-sub"><span className="num">{item.quantity}</span> × <span className="num">{money(item.unitPriceMinor)}</span></span></span>
            <span className="num">{money(item.totalMinor)}</span>
          </div>
        ))}
        <div className="invoice-line muted"><span>Subtotal</span><span className="num">{money(proposal.subtotalMinor)}</span></div>
        <div className="invoice-line muted"><span>Tax {(proposal.taxRateBps / 100).toFixed(2)}%</span><span className="num">{money(proposal.taxMinor)}</span></div>
        <div className="invoice-total"><span>Total</span><span className="num">{money(proposal.totalMinor)}</span></div>
      </div>
      {proposal.notes && <p className="invoice-note">{proposal.notes}</p>}
      {!!proposal.warnings?.length && (
        <ul className="invoice-reasons">{proposal.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      {state === "waiting" && (
        <div className="invoice-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={onConfirm} disabled={busy}>
            <FileCheck2 size={14} aria-hidden /> Confirm and create PDF
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onChange} disabled={busy}>
            <Pencil size={14} aria-hidden /> Change something
          </button>
        </div>
      )}
      {state === "waiting" && <p className="invoice-delivery-note"><ShieldCheck size={13} aria-hidden /> Prices, discount, tax and due date come from the store's records. Nothing is created until you confirm.</p>}
    </section>
  );
}

const CHART_ICON = { number: Hash, line: LineChart, bar: BarChart3, table: Table2 } as const;
/** "Sales", "email", "main", or a page's name: how a board is named in the chat cards. */
const BOARD_NAME: Record<string, string> = { sales: "Sales", default: "email", main: "main" };
const boardLabel = (board: Board, name?: string): string => BOARD_NAME[board] ?? name ?? "your";
/** Where a board lives (decision #60): Sales, the Email dashboard, or the main Dashboard and its pages. */
const boardHref = (board: Board) => (board === "sales" ? "#/sales" : board === "default" ? "#/email" : board === "main" ? "#/dashboard" : `#/dashboard/${board}`);
const addedTo = (board: Board, name?: string) => (board.startsWith("page-") ? `Added to the ${name ?? "new"} page` : `Added to ${boardLabel(board, name)} dashboard`);

/** A widget the dashboard builder added: what it shows, where it went, and a way to open or undo it. */
function WidgetCard({ widget }: { widget: AddedWidget }) {
  const qc = useQueryClient();
  const [state, setState] = useState<"added" | "removing" | "removed">("added");
  const [error, setError] = useState<string | null>(null);
  const Icon = (widget.chart && CHART_ICON[widget.chart]) || BarChart3;
  const href = boardHref(widget.board);
  const remove = async () => {
    setState("removing");
    setError(null);
    try {
      await api.removeWidget(widget.board, widget.id);
      setState("removed");
      void qc.invalidateQueries({ queryKey: ["dashboard-spec", widget.board] });
    } catch (err) {
      setState("added");
      setError((err as Error).message);
    }
  };
  return (
    <section className="widget-card" role="region" aria-label={`Widget ${widget.title}`} data-state={state}>
      <span className="widget-card-icon"><Icon size={18} aria-hidden /></span>
      <div className="widget-card-text">
        <strong>{widget.title}</strong>
        {widget.summary && <span>{widget.summary}</span>}
        <span className="widget-card-status">
          {state === "removed" ? "Removed from the dashboard" : <><CheckCircle2 size={12} aria-hidden /> {addedTo(widget.board, widget.boardName)}</>}
        </span>
      </div>
      {state !== "removed" && (
        <div className="widget-card-actions">
          <a className="btn btn-secondary btn-sm" href={href} onClick={() => useHighlight.getState().set(widget.id)}>Open <ArrowRight size={13} aria-hidden /></a>
          <button type="button" className="icon-btn icon-btn-sm" onClick={remove} disabled={state === "removing"} aria-label={`Remove ${widget.title}`} title="Remove from the dashboard">
            {state === "removing" ? <Loader2 size={14} className="spin" aria-hidden /> : <Trash2 size={14} aria-hidden />}
          </button>
        </div>
      )}
      {error && <p className="agent-error" role="alert"><AlertTriangle size={13} aria-hidden /> {error}</p>}
    </section>
  );
}

/**
 * Undo for a change the assistant made to a board. It restores the board's previous version, so it only runs when the
 * board hasn't changed since; otherwise it would roll back something else, and it says so instead.
 */
function useBoardUndo(item: { board: Board; id: string; version: number }, redo: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<"done" | "working" | "restored">("done");
  const [error, setError] = useState<string | null>(null);
  const undo = async () => {
    setState("working");
    setError(null);
    try {
      const current = await api.spec(item.board);
      if (current.version !== item.version) {
        setState("done");
        setError(`The ${boardLabel(item.board)} dashboard changed after this, so Undo here would undo that instead. ${redo}`);
        return;
      }
      await api.undoSpec(item.board);
      setState("restored");
      useHighlight.getState().set(item.id);
      void qc.invalidateQueries({ queryKey: ["dashboard-spec", item.board] });
    } catch (err) {
      setState("done");
      setError((err as Error).message);
    }
  };
  return { state, error, undo };
}

/** A widget the assistant removed, with Undo. */
function RemovedCard({ item }: { item: AssistantReply["removed"][number] }) {
  const { state, error, undo } = useBoardUndo(item, "Ask me to add it again.");
  const board = boardLabel(item.board);
  return (
    <section className="widget-card" role="region" aria-label={`Removed ${item.title}`} data-state={state === "restored" ? "added" : "removed-card"}>
      <span className="widget-card-icon" data-tone={state === "restored" ? undefined : "muted"}>{state === "restored" ? <CheckCircle2 size={18} aria-hidden /> : <Trash2 size={18} aria-hidden />}</span>
      <div className="widget-card-text">
        <strong>{item.title}</strong>
        <span className="widget-card-status" data-tone={state === "restored" ? undefined : "muted"}>
          {state === "restored" ? `Put back on ${board} dashboard` : `Removed from ${board} dashboard`}
        </span>
      </div>
      {state !== "restored" && (
        <div className="widget-card-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={undo} disabled={state === "working"}>
            {state === "working" ? <Loader2 size={13} className="spin" aria-hidden /> : <Undo2 size={13} aria-hidden />} Undo
          </button>
        </div>
      )}
      {error && <p className="agent-error" role="alert"><AlertTriangle size={13} aria-hidden /> {error}</p>}
    </section>
  );
}

/** Plain words for a size change: "full width", "wider and taller"… (the grid is 12 columns wide). */
function describeResize({ from, to }: ResizedWidget) {
  const parts: string[] = [];
  if (to.w !== from.w) parts.push(to.w === 12 ? "full width" : to.w === 6 ? "half width" : to.w > from.w ? "wider" : "narrower");
  if (to.h !== from.h) parts.push(to.h > from.h ? "taller" : "shorter");
  return parts.join(" and ") || "resized";
}

/** A widget the assistant resized, with Undo (puts the old size back). */
function ResizedCard({ item }: { item: ResizedWidget }) {
  const { state, error, undo } = useBoardUndo(item, "Ask me to resize it again.");
  const restored = state === "restored";
  return (
    <section className="widget-card" role="region" aria-label={`Resized ${item.title}`} data-state="added">
      <span className="widget-card-icon">{restored ? <CheckCircle2 size={18} aria-hidden /> : <Scaling size={18} aria-hidden />}</span>
      <div className="widget-card-text">
        <strong>{item.title}</strong>
        <span className="widget-card-status">
          {restored ? "Back to its old size" : `Now ${describeResize(item)} on ${boardLabel(item.board)} dashboard`}
        </span>
        {!restored && item.limited && <span className="widget-card-status" data-tone="muted">That's as far as this widget goes.</span>}
      </div>
      {!restored && (
        <div className="widget-card-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={undo} disabled={state === "working"}>
            {state === "working" ? <Loader2 size={13} className="spin" aria-hidden /> : <Undo2 size={13} aria-hidden />} Undo
          </button>
        </div>
      )}
      {error && <p className="agent-error" role="alert"><AlertTriangle size={13} aria-hidden /> {error}</p>}
    </section>
  );
}

function InvoiceCard({ initial, status }: { initial: InvoiceDraft; status: Status | undefined }) {
  const [invoice, setInvoice] = useState(initial);
  const [reviewing, setReviewing] = useState(false);
  const [subject, setSubject] = useState(`Invoice ${initial.invoiceNumber}`);
  const [body, setBody] = useState(`Hello ${initial.customer.name},\n\nPlease find invoice ${initial.invoiceNumber} attached.\n\nThank you for your business.`);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gmail = status?.gmail;
  const canSend = gmail?.mode === "live" && gmail.canSend;
  const sent = invoice.status === "sent";

  const deliver = async () => {
    setSending(true);
    setError(null);
    try {
      setInvoice(await api.sendInvoice(invoice.id, { subject: subject.trim(), body: body.trim() }));
      setReviewing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="invoice-card" aria-label={`Invoice ${invoice.invoiceNumber}`}>
      <header className="invoice-card-head">
        <span className="invoice-icon"><FileText size={16} aria-hidden /></span>
        <div>
          <strong>{invoice.invoiceNumber}</strong>
          <span>{invoice.customer.name} · due {invoice.dueDate}</span>
        </div>
        <span className="tag" data-tone={sent ? "ok" : "accent"}>{sent ? "Sent" : "PDF ready"}</span>
      </header>
      <div className="invoice-lines">
        <div className="invoice-total"><span>Total</span><span className="num">{formatMoney(invoice.totalMinor, invoice.currency)}</span></div>
      </div>
      <div className="invoice-actions">
        <a className="btn btn-secondary btn-sm" href={invoice.pdfUrl} download>
          <Download size={14} aria-hidden /> Download invoice PDF
        </a>
        {!sent && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReviewing(true)} disabled={!invoice.readiness.ready || !canSend}
            title={!invoice.readiness.ready ? invoice.readiness.reasons[0] : !canSend ? "Connect Gmail with sending permission first" : undefined}>
            <Mail size={14} aria-hidden /> Review sending
          </button>
        )}
      </div>
      {!sent && !canSend && <p className="invoice-delivery-note"><ShieldCheck size={13} aria-hidden /> Connect Gmail with sending permission to email it from here.</p>}
      {sent && <p className="invoice-sent"><CheckCircle2 size={14} aria-hidden /> Sent to {invoice.customer.email}</p>}
      {reviewing && (
        <div className="invoice-review">
          <p><strong>Review before sending</strong><br /><span className="muted small">To {invoice.customer.email}. The PDF is attached.</span></p>
          <label className="field">
            <span className="field-label">Subject</span>
            <input className="input" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Message</span>
            <textarea className="input textarea invoice-message" rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <p className="invoice-delivery-note"><ShieldCheck size={13} aria-hidden /> Nothing is sent until you click Send invoice.</p>
          <div className="invoice-review-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReviewing(false)} disabled={sending}>Back</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={deliver} disabled={sending || !subject.trim() || !body.trim()}>
              {sending ? <Loader2 size={14} className="spin" aria-hidden /> : <Send size={14} aria-hidden />} Send invoice
            </button>
          </div>
        </div>
      )}
      {error && <p className="agent-error" role="alert"><AlertTriangle size={13} aria-hidden /> {error}</p>}
    </section>
  );
}

export function AgentAssistant() {
  const { data: status } = useStatus();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState(newThread);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an effect must return nothing or a cleanup.
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }); }, [messages, working]);

  /** A new turn settles any draft still waiting above it (the server treats a typed message as "change something"). */
  const settleWaiting = (state: "confirmed" | "changed") =>
    setMessages((current) => current.map((m) => (m.proposalState === "waiting" ? { ...m, proposalState: state } : m)));

  const addReply = (result: AssistantReply) => {
    // A widget was added: refresh that board and highlight the newest one when it opens.
    for (const board of new Set([...(result.widgets ?? []), ...(result.removed ?? []), ...(result.resized ?? [])].map((w) => w.board))) void qc.invalidateQueries({ queryKey: ["dashboard-spec", board] });
    // A page the assistant created shows up as a tab right away (decision #60).
    if (result.toolsUsed?.includes("create_dashboard_page")) void qc.invalidateQueries({ queryKey: ["dashboard-pages"] });
    if (result.widgets?.length) useHighlight.getState().set(result.widgets.at(-1)!.id);
    setMessages((current) => [...current, {
      id: crypto.randomUUID(), role: "assistant", text: result.reply, toolsUsed: result.toolsUsed,
      proposal: result.pendingInvoice, proposalState: result.pendingInvoice ? "waiting" : undefined, invoice: result.invoice, widgets: result.widgets, removed: result.removed, resized: result.resized,
    }]);
  };
  const addError = (err: unknown) =>
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: (err as Error).message, error: true }]);

  const run = async (call: () => Promise<AssistantReply>) => {
    setWorking(true);
    try { addReply(await call()); } catch (err) { addError(err); } finally { setWorking(false); }
  };

  const ask = async (value = draft) => {
    const text = value.trim();
    if (!text || working) return;
    settleWaiting("changed");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);
    setDraft("");
    await run(() => api.assistantMessage(threadId, text));
  };

  const answerDraft = async (approve: boolean) => {
    if (working) return;
    settleWaiting(approve ? "confirmed" : "changed");
    await run(() => api.assistantConfirm(threadId, approve, undefined));
    if (!approve) inputRef.current?.focus();
  };

  const restart = () => {
    setThreadId(newThread());
    setMessages([]);
    setDraft("");
    inputRef.current?.focus();
  };

  return (
    <div className="agent-root" data-open={open}>
      {!open && (
        <button type="button" className="agent-bubble" aria-label="Open assistant" aria-expanded="false" onClick={() => setOpen(true)}>
          <MessageCircle size={22} aria-hidden />
          <span>Ask</span>
        </button>
      )}

      {open && (
        <aside className="agent-panel" role="dialog" aria-modal="false" aria-label="Assistant">
          <header className="agent-head">
            <span className="agent-avatar"><Bot size={18} aria-hidden /></span>
            <div>
              <h2>Assistant</h2>
              <p>Answers from your sales database</p>
            </div>
            <button type="button" className="icon-btn" aria-label="New chat" title="New chat" onClick={restart} disabled={working}>
              <RotateCcw size={16} aria-hidden />
            </button>
            <button type="button" className="icon-btn" aria-label="Close assistant" onClick={() => setOpen(false)}>
              <X size={18} aria-hidden />
            </button>
          </header>

          <div className="agent-thread" aria-live="polite">
            {messages.length === 0 && (
              <div className="agent-empty">
                <span className="agent-empty-icon"><MessageCircle size={20} aria-hidden /></span>
                <h3>What would you like to know?</h3>
                <p>Ask about sales, stock and customers, describe a job to get product picks, or ask for an invoice.</p>
                <div className="agent-prompts">
                  {SUGGESTIONS.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => void ask(suggestion)}>{suggestion}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className="agent-message" data-role={message.role} data-error={message.error || undefined}>
                <div className="agent-message-content">
                  {message.role === "assistant" && !message.error ? <RichText text={message.text} /> : <p>{message.text}</p>}
                </div>
                {!!message.toolsUsed?.length && (
                  <p className="agent-checked">Checked: {[...new Set(message.toolsUsed.map((t) => TOOL_LABELS[t] ?? t.replace(/_/g, " ")))].join(", ")}</p>
                )}
                {message.proposal && (
                  <ProposalCard proposal={message.proposal} state={message.proposalState} busy={working}
                    onConfirm={() => void answerDraft(true)} onChange={() => void answerDraft(false)} />
                )}
                {message.widgets?.map((w) => <WidgetCard key={w.id} widget={w} />)}
                {message.removed?.map((w) => <RemovedCard key={w.id} item={w} />)}
                {message.resized?.map((w, i) => <ResizedCard key={`${w.id}-${i}`} item={w} />)}
                {message.invoice && <InvoiceCard initial={message.invoice} status={status} />}
              </article>
            ))}
            {working && <div className="agent-thinking" role="status"><Loader2 size={15} className="spin" aria-hidden /> Looking at your data…</div>}
            <div ref={endRef} />
          </div>

          <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
            <label className="sr-only" htmlFor="agent-question">Ask the assistant</label>
            <textarea
              ref={inputRef}
              id="agent-question"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); }
              }}
              placeholder="Ask about sales, products, stock or an invoice…"
              disabled={working}
            />
            <button type="submit" className="agent-send" aria-label="Send message" disabled={working || !draft.trim()}>
              {working ? <Loader2 size={17} className="spin" aria-hidden /> : <Send size={17} aria-hidden />}
            </button>
          </form>
          <p className="agent-footnote">AI can make mistakes. Figures come from the store's sales database (demo data).</p>
        </aside>
      )}
    </div>
  );
}
