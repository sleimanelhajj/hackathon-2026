import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Building2, Download, FileImage, FileSpreadsheet, FileText, FolderOpen, Info, Loader2, Mail, Search, Sparkles, User,
} from "lucide-react";
import { api, type DocFile, type DocFolder } from "../lib/api";
import { Callout } from "../components/ui";
import { PageSkeleton } from "../components/Skeletons";
import { useViewer } from "../components/EmailViewer";
import { errorMessage } from "../lib/errors";

const TYPE_LABEL: Record<string, string> = {
  invoice: "Invoice", quote: "Quote", "purchase-order": "Purchase order", receipt: "Receipt", statement: "Statement", "delivery-note": "Delivery note",
  contract: "Contract", "price-list": "Price list", report: "Report", other: "Other",
};
const typeLabel = (t: string) => TYPE_LABEL[t] ?? "Other";
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const day = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);
const money = (value: number | null, currency: string | null) => {
  if (value === null || value === undefined) return null;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(value); } catch { return `${currency ?? ""} ${value.toFixed(2)}`.trim(); }
};
const fileIcon = (f: DocFile) => (/image/.test(f.mimeType ?? "") ? FileImage : /sheet|excel|csv/.test(f.mimeType ?? "") || /\.(xlsx?|csv)$/i.test(f.filename) ? FileSpreadsheet : FileText);
/** Words a folder or file matches when searching. */
const haystack = (f: DocFile) => [f.filename, f.title, f.summary, f.number, f.subject, f.docType, ...f.lines.map((l) => l.description)].join(" ").toLowerCase();

function FileCard({ file }: { file: DocFile }) {
  const Icon = fileIcon(file);
  const total = money(file.total, file.currency);
  return (
    <article className="doc-card surface" aria-label={file.title}>
      <header className="doc-head">
        <span className="doc-icon" data-type={file.docType} aria-hidden><Icon size={18} /></span>
        <div className="doc-titles">
          <h3>{file.title}</h3>
          <p className="muted small">{file.filename} · {file.direction === "out" ? "sent" : "received"} {day(file.sentAt)}</p>
        </div>
        <span className="doc-type" data-type={file.docType}>{typeLabel(file.docType)}</span>
      </header>
      {file.summary
        ? <p className="doc-summary"><Sparkles size={13} aria-hidden /> <span>{file.summary}</span></p>
        : <p className="doc-summary muted"><Info size={13} aria-hidden /> <span>No readable text in this file, so there's no summary.</span></p>}
      {(file.number || total || file.issueDate || file.dueDate) && (
        <dl className="doc-facts">
          {file.number && <div><dt>Number</dt><dd>{file.number}</dd></div>}
          {total && <div><dt>Total</dt><dd className="num">{total}</dd></div>}
          {file.issueDate && <div><dt>Dated</dt><dd>{day(file.issueDate)}</dd></div>}
          {file.dueDate && <div><dt>Due</dt><dd>{day(file.dueDate)}</dd></div>}
        </dl>
      )}
      {file.lines.length > 0 && (
        <details className="doc-lines">
          <summary>{plural(file.lines.length, "line")}</summary>
          <ul>{file.lines.map((l, i) => <li key={i}>{l.quantity !== null ? `${l.quantity} × ` : ""}{l.description}{l.total !== null ? ` · ${money(l.total, file.currency)}` : ""}</li>)}</ul>
        </details>
      )}
      <div className="doc-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => useViewer.getState().open(file.threadId)}><Mail size={14} aria-hidden /> Read the email</button>
        <a className="btn btn-secondary btn-sm" href={`/api/attachments/${encodeURIComponent(file.gmailId)}/${encodeURIComponent(file.attachmentId)}`}><Download size={14} aria-hidden /> Download</a>
      </div>
    </article>
  );
}

/**
 * The attachment library: a folder per contact (a company by its domain, a person on a free-mail address), each file
 * with an AI summary of what it is about and the figures it states. The assistant can search the same files.
 */
export default function FilesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["files"], queryFn: api.files,
    refetchInterval: (q) => (q.state.data?.reading ? 8_000 : 60_000),
  });
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const folders = useMemo<DocFolder[]>(() => {
    const all = data?.folders ?? [];
    if (!q) return all;
    return all
      .map((f) => (f.name.toLowerCase().includes(q) || f.emails.some((e) => e.includes(q)) ? f : { ...f, docs: f.docs.filter((d) => haystack(d).includes(q)) }))
      .filter((f) => f.docs.length)
      .map((f) => ({ ...f, count: f.docs.length }));
  }, [data, q]);
  const open = folders.find((f) => f.key === openKey) ?? null;

  if (isLoading) return <PageSkeleton kind="data" />;
  if (error) return <div className="page"><Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load your files" text={errorMessage(error)} /></div>;
  const total = (data?.folders ?? []).reduce((n, f) => n + f.count, 0);

  return (
    <div className="page page-wide files-page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Files</h1>
          <p className="page-sub">Every attachment, filed by who sent it or who you sent it to, with what it's about.</p>
        </div>
      </header>

      {data?.reading && data.pending > 0 && (
        <p className="cal-note" role="status"><Loader2 size={14} className="spin" aria-hidden /> Reading {plural(data.pending, "file")}… summaries appear as they're done.</p>
      )}
      {data && !data.aiConfigured && (
        <Callout tone="warn" icon={<Info size={18} />} title="Summaries need Gemini" text="Add GEMINI_API_KEY to .env and restart the server; files are listed once they're read." />
      )}

      {total === 0 && !data?.pending ? (
        <div className="surface empty">
          <div className="empty-icon"><FolderOpen size={24} /></div>
          <h2 className="empty-title">No attachments yet</h2>
          <p className="empty-text">Files people send you, and files you send, show up here in a folder per contact once Gmail is synced.</p>
          <div className="empty-actions"><a className="btn btn-primary btn-lg" href="#/integrations">Check Gmail <ArrowRight size={16} /></a></div>
        </div>
      ) : (
        <div className="files-layout">
          <aside className="files-side surface">
            <label className="files-search">
              <Search size={15} aria-hidden />
              <input type="search" className="input" placeholder="Search names, invoices, products…" aria-label="Search files" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <ul className="folder-list" aria-label="Folders">
              {folders.map((f) => (
                <li key={f.key}>
                  <button type="button" className="folder-item" aria-current={open?.key === f.key ? "true" : undefined} onClick={() => setOpenKey(f.key)}>
                    <span className="folder-icon" aria-hidden>{f.kind === "company" ? <Building2 size={16} /> : <User size={16} />}</span>
                    <span className="folder-text">
                      <strong>{f.name}</strong>
                      <span className="muted small">{plural(f.count, "file")}{f.types.invoice ? ` · ${plural(f.types.invoice, "invoice")}` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
              {!folders.length && <li className="muted small folder-none">No files match "{query}".</li>}
            </ul>
          </aside>
          <section className="files-main" aria-label={open ? `Files from ${open.name}` : "Files"}>
            {open ? (
              <>
                <header className="files-folder-head">
                  <h2>{open.name}</h2>
                  <p className="muted small">{open.emails.join(", ")} · {plural(open.count, "file")}</p>
                </header>
                <div className="doc-list">{open.docs.map((d) => <FileCard key={d._id} file={d} />)}</div>
              </>
            ) : (
              <div className="surface empty files-pick">
                <div className="empty-icon"><FolderOpen size={24} /></div>
                <h2 className="empty-title">Pick a folder</h2>
                <p className="empty-text">Or ask the assistant, e.g. "what was the invoice from Haddad Plumbing on 12 November?"</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
