import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, type AgentSource, type InvoiceDraft, type Status } from "../lib/api";
import { useStatus } from "../lib/queries";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: AgentSource[];
  invoice?: InvoiceDraft | null;
  error?: boolean;
};

const suggestions = [
  "Which customers need my attention?",
  "Summarize the latest billing activity",
  "Create an invoice from the customer and pricing records",
];

const formatMoney = (minor: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
};

function Sources({ sources }: { sources: AgentSource[] }) {
  if (!sources.length) return null;
  return (
    <div className="agent-sources" aria-label="Sources">
      <span className="agent-sources-label">Sources</span>
      {sources.map((source) =>
        source.url ? (
          <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="agent-source">
            {source.label} <ExternalLink size={11} aria-hidden />
          </a>
        ) : (
          <span key={source.id} className="agent-source">{source.label}</span>
        )
      )}
    </div>
  );
}

function InvoiceCard({ initial, status }: { initial: InvoiceDraft; status: Status | undefined }) {
  const [invoice, setInvoice] = useState(initial);
  const [reviewing, setReviewing] = useState(false);
  const [subject, setSubject] = useState(`Invoice ${initial.invoiceNumber}`);
  const [body, setBody] = useState(`Hello ${initial.customer.name},\n\nPlease find invoice ${initial.invoiceNumber} attached for your review.\n\nThank you.`);
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
        <span className="tag" data-tone={sent ? "ok" : invoice.readiness.ready ? "accent" : "warn"}>
          {sent ? "Sent" : invoice.readiness.ready ? "Ready to review" : "Needs details"}
        </span>
      </header>

      <div className="invoice-lines">
        {invoice.lineItems.map((item, index) => (
          <div className="invoice-line" key={`${item.description}-${index}`}>
            <span>{item.description} · <span className="num">{item.quantity}</span></span>
            <span className="num">{formatMoney(item.totalMinor, invoice.currency)}</span>
          </div>
        ))}
        {invoice.taxMinor > 0 && <div className="invoice-line muted"><span>Tax</span><span className="num">{formatMoney(invoice.taxMinor, invoice.currency)}</span></div>}
        <div className="invoice-total"><span>Total</span><span className="num">{formatMoney(invoice.totalMinor, invoice.currency)}</span></div>
      </div>

      {!invoice.readiness.ready && (
        <ul className="invoice-reasons">
          {invoice.readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}

      <div className="invoice-actions">
        <a className="btn btn-secondary btn-sm" href={invoice.pdfUrl} download>
          <Download size={14} aria-hidden /> Download invoice PDF
        </a>
        {!sent && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setReviewing(true)}
            disabled={!invoice.readiness.ready || !canSend}
            title={!invoice.readiness.ready ? invoice.readiness.reasons[0] : !canSend ? "Connect Gmail with sending permission first" : undefined}
          >
            <Mail size={14} aria-hidden /> Review sending
          </button>
        )}
      </div>

      {!sent && invoice.readiness.ready && !canSend && (
        <p className="invoice-delivery-note"><ShieldCheck size={13} aria-hidden /> The PDF is ready. Connect Gmail with sending permission to deliver it from this app.</p>
      )}
      {sent && <p className="invoice-sent"><CheckCircle2 size={14} aria-hidden /> Sent to {invoice.customer.email}</p>}

      {reviewing && (
        <div className="invoice-review">
          <p><strong>Review before sending</strong><br /><span className="muted small">To {invoice.customer.email}. The PDF above will be attached.</span></p>
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

function Message({ message, status }: { message: ChatMessage; status: Status | undefined }) {
  return (
    <article className="agent-message" data-role={message.role} data-error={message.error || undefined}>
      <div className="agent-message-content">
        {message.text.split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
      {message.sources && <Sources sources={message.sources} />}
      {message.invoice && <InvoiceCard initial={message.invoice} status={status} />}
    </article>
  );
}

export function AgentAssistant() {
  const { data: status } = useStatus();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  useEffect(() => endRef.current?.scrollIntoView?.({ block: "end" }), [messages, working]);

  const history = useMemo(
    () => messages.filter((message) => !message.error).map(({ role, text }) => ({ role, text })).slice(-9),
    [messages]
  );

  const ask = async (value = draft) => {
    const question = value.trim();
    if (!question || working) return;
    const user: ChatMessage = { id: crypto.randomUUID(), role: "user", text: question };
    setMessages((current) => [...current, user]);
    setDraft("");
    setWorking(true);
    try {
      const result = await api.agentChat([...history, { role: "user", text: question }]);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: result.answer, sources: result.sources, invoice: result.invoice },
      ]);
    } catch (err) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: (err as Error).message, error: true },
      ]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="agent-root" data-open={open}>
      {!open && (
        <button
          type="button"
          className="agent-bubble"
          aria-label="Open workspace assistant"
          aria-expanded="false"
          onClick={() => setOpen(true)}
        >
          <MessageCircle size={22} aria-hidden />
          <span>Ask</span>
        </button>
      )}

      {open && (
        <aside className="agent-panel" role="dialog" aria-modal="false" aria-label="Workspace assistant">
          <header className="agent-head">
            <span className="agent-avatar"><Bot size={18} aria-hidden /></span>
            <div>
              <h2>Workspace assistant</h2>
              <p>Answers from approved company data</p>
            </div>
            <button type="button" className="icon-btn" aria-label="Close workspace assistant" onClick={() => setOpen(false)}>
              <X size={18} aria-hidden />
            </button>
          </header>

          <div className="agent-connection" data-connected={status?.companyData.configured || undefined}>
            <Database size={13} aria-hidden />
            {status?.companyData.configured
              ? `${status.companyData.name} connected`
              : "Company data adapter ready; database connection pending"}
          </div>

          <div className="agent-thread" aria-live="polite">
            {messages.length === 0 && (
              <div className="agent-empty">
                <span className="agent-empty-icon"><MessageCircle size={20} aria-hidden /></span>
                <h3>What would you like to know?</h3>
                <p>I can answer from connected company records and prepare reviewed invoice PDFs without inventing missing details.</p>
                <div className="agent-prompts">
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => void ask(suggestion)}>{suggestion}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => <Message key={message.id} message={message} status={status} />)}
            {working && (
              <div className="agent-thinking" role="status"><Loader2 size={15} className="spin" aria-hidden /> Checking approved company data…</div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void ask();
            }}
          >
            <label className="sr-only" htmlFor="agent-question">Ask about your workspace</label>
            <textarea
              ref={inputRef}
              id="agent-question"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder="Ask about customers, work, pricing or an invoice…"
              disabled={working}
            />
            <button type="submit" className="agent-send" aria-label="Send question" disabled={working || !draft.trim()}>
              {working ? <Loader2 size={17} className="spin" aria-hidden /> : <Send size={17} aria-hidden />}
            </button>
          </form>
          <p className="agent-footnote">AI can make mistakes. Company answers include their available sources.</p>
        </aside>
      )}
    </div>
  );
}
