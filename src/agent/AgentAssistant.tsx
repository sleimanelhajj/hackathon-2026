import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, Bot, CheckCircle2, Download, FileCheck2, FileText, Loader2, Mail, MessageCircle, Pencil, RotateCcw, Send, ShieldCheck, X,
} from "lucide-react";
import { api, type AssistantReply, type InvoiceDraft, type InvoiceProposal, type Status } from "../lib/api";
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
  error?: boolean;
};

const SUGGESTIONS = [
  "How did sales go this month compared with last month?",
  "Which items need reordering?",
  "I'm repainting a 12 by 12 ft bedroom. What do I need?",
  "Create an invoice for a trade customer",
];

/** Plain words for the tools the agent used, shown under its answer. */
const TOOL_LABELS: Record<string, string> = {
  sales_summary: "sales summary", sales_breakdown: "sales breakdown", find_products: "product catalogue",
  find_customers: "customer list", customer_history: "customer history", low_stock: "stock levels",
  store_profile: "store profile", staff_performance: "staff targets", quote_pipeline: "trade quotes", propose_invoice: "invoice draft",
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

  const addReply = (result: AssistantReply) =>
    setMessages((current) => [...current, {
      id: crypto.randomUUID(), role: "assistant", text: result.reply, toolsUsed: result.toolsUsed,
      proposal: result.pendingInvoice, proposalState: result.pendingInvoice ? "waiting" : undefined, invoice: result.invoice,
    }]);
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
