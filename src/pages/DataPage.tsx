import { useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Code2, Database, Paperclip, Search, SlidersHorizontal, X } from "lucide-react";
import { Reply } from "lucide-react";
import { CATEGORY_LABELS, categoryInfo } from "../../shared/spec.js";
import { useReply } from "../components/ReplyModal";
import { Select } from "../components/Select";
import type { Address, Category, MessageFilters, StoredMessage, StoredMessageDetail } from "../lib/api";
import { useMessage, useMessages, usePeople, useStatus } from "../lib/queries";
import { Callout } from "../components/ui";
import { errorMessage } from "../lib/errors";
import { TableSkeleton } from "../components/Skeletons";

const PAGE_SIZE = 25;

// Older imports stored recipients as a string and omitted full-format arrays.
// Keep the raw record intact; adapt only its presentation.
const addr = (a: Address | string | null | undefined) => typeof a === "string" ? a : (a ? (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email) : "");
const addressList = (value: Address[] | string | null | undefined): (Address | string)[] => Array.isArray(value) ? value : value ? [value] : [];
const addrs = (value: Address[] | string | null | undefined) => addressList(value).map(addr).join(", ");
const kb = (n: number | null | undefined) => (n == null ? "—" : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** Gmail label ids → readable names (system labels only; user labels show their id). */
const labelName = (l: string) => l.replace(/^CATEGORY_/, "").replace(/^Label_/, "").toLowerCase();

const STATUSES: { value: NonNullable<MessageFilters["status"]>; label: string }[] = [
  { value: "", label: "Any status" },
  { value: "unread", label: "Unread" },
  { value: "important", label: "Important" },
  { value: "starred", label: "Starred" },
  { value: "attachments", label: "Has attachments" },
  { value: "needsReply", label: "Needs reply (AI)" },
];
const PRIORITIES: { value: NonNullable<MessageFilters["priority"]>; label: string }[] = [
  { value: "", label: "Any priority" },
  { value: "high", label: "High priority" },
  { value: "medium", label: "Medium priority" },
  { value: "low", label: "Low priority" },
];
const PRIORITY_TONE = { high: "warn", medium: "accent", low: undefined } as const;

/** Person filter from the URL (#/data?from=a@b.com), so the Contacts widget can link here. */
const fromInHash = () => new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("from") ?? "";

/** Every email stored after the Gmail sync, as fetched, with the AI's labels shown separately and marked as guesses. */
export default function DataPage() {
  const { data: status } = useStatus();
  const { data: people } = usePeople();
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<"" | "in" | "out">("");
  const [from, setFrom] = useState(fromInHash);
  const [mailStatus, setMailStatus] = useState<NonNullable<MessageFilters["status"]>>("");
  const [priority, setPriority] = useState<NonNullable<MessageFilters["priority"]>>("");
  const [category, setCategory] = useState<NonNullable<MessageFilters["category"]>>("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDeferredValue(query.trim());

  useEffect(() => {
    const onHash = () => setFrom(fromInHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => setPage(0), [q, direction, from, mailStatus, priority, category]);
  const { data, isLoading, isFetching, error } = useMessages({ q, direction, from, status: mailStatus, priority, category, page, limit: PAGE_SIZE });

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filtered = Boolean(q || direction || from || mailStatus || priority || category);
  const clearFilters = () => {
    setQuery("");
    setDirection("");
    setFrom("");
    setMailStatus("");
    setPriority("");
    setCategory("");
    if (window.location.hash.includes("?")) history.replaceState(null, "", "#/data");
  };
  // Keep a person chosen from a link selectable even if they aren't in the top-200 list.
  const personOptions = people && from && !people.some((p) => p.email === from) ? [{ email: from, name: "", count: 0 }, ...people] : people ?? [];

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1 className="page-title">All email</h1>
          <p className="page-sub">
            Every email from the last 30 days{data ? ` (${data.all})` : ""}. Priority and topic are suggested by AI and can be wrong.
          </p>
        </div>
      </header>

      {!status?.gmail && status && (
        <Callout icon={<Database size={18} />} title="No email yet" text="Connect Gmail to see your email here." action={<a className="btn btn-primary" href="#/integrations">Go to Integrations</a>} />
      )}
      {error && <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load emails" text={errorMessage(error)} />}

      <div className="data-toolbar">
        <label className="search data-search">
          <Search size={15} aria-hidden />
          <span className="sr-only">Search emails</span>
          <input type="search" placeholder="Search subject, sender, recipient, attachment…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="segmented" role="group" aria-label="Direction">
          {([["", "All"], ["in", "Received"], ["out", "Sent"]] as const).map(([v, l]) => (
            <button key={v} aria-pressed={direction === v} onClick={() => setDirection(v)}>{l}</button>
          ))}
        </div>
        <span className="data-count num">{data ? `${data.total} matching` : ""}</span>
      </div>

      <div className="filter-bar" role="group" aria-label="Filters">
        <SlidersHorizontal size={15} className="muted" aria-hidden />
        <Select
          label="Person"
          value={from}
          onChange={setFrom}
          options={[
            { value: "", label: "Anyone" },
            ...personOptions.map((p) => ({
              value: p.email,
              label: p.name && p.name !== p.email ? p.name : p.email,
              hint: `${p.name && p.name !== p.email ? p.email : ""}${p.count ? `${p.name && p.name !== p.email ? " · " : ""}${p.count} emails` : ""}` || undefined,
            })),
          ]}
        />
        <Select label="Status" value={mailStatus} onChange={(v) => setMailStatus(v as typeof mailStatus)} options={STATUSES} />
        <Select label="Priority" value={priority} onChange={(v) => setPriority(v as typeof priority)} options={PRIORITIES} />
        <Select
          label="Topic"
          value={category}
          onChange={(v) => setCategory(v as typeof category)}
          options={[
            { value: "", label: "Any topic" },
            ...(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => ({ value: c, label: categoryInfo(c).title })),
          ]}
        />
        {filtered && <button className="btn btn-ghost btn-sm" onClick={clearFilters}><X size={14} /> Clear filters</button>}
      </div>

      <div className="surface data-table-wrap" aria-busy={isFetching}>
        {isLoading ? (
          <TableSkeleton rows={9} label="Loading emails" />
        ) : data && data.messages.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>From</th>
                <th>To</th>
                <th>Email</th>
                <th title="From the AI analysis of the conversation. It can be wrong.">Priority</th>
                <th>Labels</th>

              </tr>
            </thead>
            <tbody>
              {data.messages.map((m) => (
                <Row key={m.gmailId} m={m} active={openId === m.gmailId} onOpen={() => setOpenId(m.gmailId)} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="data-empty">
            {filtered ? <>No email matches these filters. <button className="link-btn" onClick={clearFilters}>Clear filters</button></> : "No emails stored."}
          </p>
        )}
      </div>

      {data && data.total > PAGE_SIZE && (
        <nav className="pager" aria-label="Pages">
          <button className="btn btn-secondary btn-sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}><ChevronLeft size={14} /> Previous</button>
          <span className="num">Page {page + 1} of {pages}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pages}>Next <ChevronRight size={14} /></button>
        </nav>
      )}

      {openId && <DetailPanel id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Row({ m, active, onOpen }: { m: StoredMessage; active: boolean; onOpen: () => void }) {
  return (
    <tr
      className="data-row"
      data-active={active}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      aria-label={`Open email: ${m.subject}`}
    >
      <td className="num nowrap">{dt(m.date)}</td>
      <td className="clip" title={addr(m.from)}>{typeof m.from === "string" ? m.from : m.from?.name || m.from?.email || "—"}</td>
      <td className="clip" title={addrs(m.to)}>{addressList(m.to).map((a) => typeof a === "string" ? a : a.name || a.email).join(", ") || "—"}{addressList(m.cc).length ? <span className="muted"> +{addressList(m.cc).length} cc</span> : null}</td>
      <td className="clip wide">
        <span className="data-subject">{m.subject}</span>
        {(m.attachments ?? []).length > 0 && <Paperclip size={12} className="data-clip" aria-label={`${(m.attachments ?? []).length} attachments`} />}
        <span className="data-snippet">{m.snippet}</span>
      </td>
      <td className="labels-cell">
        {m.ai ? (
          <>
            {/* Labels written by other versions of the analysis may lack fields: show what's there. */}
            {m.ai.priority && (
              <span className="tag tag-sm" data-tone={PRIORITY_TONE[m.ai.priority]}>{m.ai.priority[0].toUpperCase() + m.ai.priority.slice(1)}</span>
            )}
            {m.ai.category && <span className="tag tag-sm">{categoryInfo(m.ai.category).title}</span>}
            {m.ai.needsReply && <span className="tag tag-sm" data-tone="accent">Reply</span>}
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className="labels-cell">
        {(m.labelIds ?? []).slice(0, 3).map((l) => <span key={l} className="tag tag-sm">{labelName(l)}</span>)}
        {(m.labelIds ?? []).length > 3 && <span className="muted"> +{(m.labelIds ?? []).length - 3}</span>}
      </td>

    </tr>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children ?? <span className="muted">—</span>}</dd>
    </div>
  );
}

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: m, isLoading, error } = useMessage(id);
  const [json, setJson] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("side-panel")), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!slot) return null;
  return createPortal(
    <section className="side-panel detail-panel" aria-label="Email details">
      <header className="detail-head">
        <h2 className="side-panel-title">{m?.subject ?? "Email"}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close details"><X size={18} /></button>
      </header>
      {isLoading && <div className="skeleton" style={{ height: 240 }} />}
      {error && <p className="error-text">{errorMessage(error)}</p>}
      {m && (
        <div className="detail-body">
          <div className="detail-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => useReply.getState().open(m.threadId, typeof m.from === "string" ? m.from : m.from?.name || m.from?.email)}>
              <Reply size={14} /> Reply
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setJson((v) => !v)} aria-pressed={json}><Code2 size={14} /> {json ? "Show fields" : "Show raw JSON"}</button>
          </div>
          {json ? <pre className="code-block">{JSON.stringify(m, null, 2)}</pre> : <Detail m={m} />}
        </div>
      )}
    </section>,
    slot
  );
}

function Detail({ m }: { m: StoredMessageDetail }) {
  return (
    <>
      <h3 className="detail-section">From Gmail</h3>
      <dl className="kv-list">
        <Field label="From">{addr(m.from)}</Field>
        <Field label="To">{addrs(m.to) || null}</Field>
        {addressList(m.cc).length > 0 && <Field label="Cc">{addrs(m.cc)}</Field>}
        {addressList(m.bcc).length > 0 && <Field label="Bcc">{addrs(m.bcc)}</Field>}
        {m.replyTo && <Field label="Reply-To">{addr(m.replyTo)}</Field>}
        <Field label="Subject">{m.subject}</Field>
        <Field label="Received">{dt(m.date)}</Field>
        <Field label="Date header">{m.sentAt ? dt(m.sentAt) : null}</Field>
        <Field label="Labels">{(m.labelIds ?? []).length ? (m.labelIds ?? []).join(", ") : null}</Field>
        <Field label="Size">{kb(m.sizeEstimate)}</Field>
        <Field label="Message id">{m.gmailId}</Field>
        <Field label="Thread id">{m.threadId}</Field>
        <Field label="Message-ID">{m.messageId}</Field>
        {m.inReplyTo && <Field label="In-Reply-To">{m.inReplyTo}</Field>}
        {m.listUnsubscribe && <Field label="List-Unsubscribe">{m.listUnsubscribe}</Field>}
        {m.autoSubmitted && <Field label="Auto-Submitted">{m.autoSubmitted}</Field>}
      </dl>

      <h3 className="detail-section">Attachments ({Array.isArray(m.attachments) ? m.attachments.length : "not imported"})</h3>
      {(m.attachments ?? []).length ? (
        <ul className="att-list">
          {(m.attachments ?? []).map((a) => (
            <li key={a.partId}>
              <Paperclip size={13} aria-hidden /> <span className="clip">{a.filename}</span>
              <span className="muted">{a.mimeType} · {kb(a.size)}{a.inline ? " · inline" : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{Array.isArray(m.attachments) ? "None" : "Not included in this import."}</p>
      )}

      <h3 className="detail-section">Body text {m.bodyTruncated ? "(first 20,000 characters)" : ""}</h3>
      <pre className="body-block">{m.bodyText || "No body text stored."}</pre>

      <h3 className="detail-section">All headers ({Array.isArray(m.headers) ? m.headers.length : "not imported"})</h3>
      <dl className="kv-list headers-list">
        {(m.headers ?? []).map((h, i) => <Field key={`${h.name}-${i}`} label={h.name}>{h.value}</Field>)}
      </dl>

      <h3 className="detail-section">Computed by AI Workspace OS</h3>
      <p className="muted small">Read from the fields above, not guessed from the text.</p>
      <dl className="kv-list">
        <Field label="Direction">{m.direction === "in" ? "Received" : "Sent"} <span className="muted">(SENT label or sender is you)</span></Field>
        <Field label="Bulk">{m.isBulk == null ? "Not imported" : m.isBulk ? "Yes" : "No"} <span className="muted">(unsubscribe / list header or Promotions-type tab)</span></Field>
        <Field label="Automated">{m.isAutomated == null ? "Not imported" : m.isAutomated ? "Yes" : "No"} <span className="muted">(auto-reply header or no-reply address)</span></Field>
        <Field label="Internal">{m.isInternal == null ? "Not imported" : m.isInternal ? "Yes" : "No"} <span className="muted">(same company domain)</span></Field>
      </dl>
    </>
  );
}
