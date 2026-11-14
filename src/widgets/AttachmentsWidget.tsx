import { memo, useMemo, useState } from "react";
import { ChevronRight, Download, ExternalLink, File, FileArchive, FileImage, FileSpreadsheet, FileText, Folder, FolderOpen, Info, type LucideIcon } from "lucide-react";
import { categoryInfo } from "../../shared/spec.js";
import { api, type AttachmentFile, type Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";
import { useViewer } from "../components/EmailViewer";

type Props = { widget: Extract<Widget, { type: "attachments" }> };

type Kind = "all" | "pdf" | "image" | "doc" | "other";
const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pdf", label: "PDF" },
  { value: "doc", label: "Docs" },
  { value: "image", label: "Images" },
  { value: "other", label: "Other" },
];

function kindOf(f: AttachmentFile): Exclude<Kind, "all"> {
  const name = f.filename.toLowerCase();
  if (f.mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (f.mimeType.startsWith("image/")) return "image";
  if (/(word|excel|spreadsheet|presentation|powerpoint|opendocument|text\/|csv)/.test(f.mimeType) || /\.(docx?|xlsx?|pptx?|csv|txt|odt|ods)$/.test(name)) return "doc";
  return "other";
}

function iconOf(f: AttachmentFile): LucideIcon {
  if (f.mimeType.startsWith("image/")) return FileImage;
  if (/(excel|spreadsheet|csv)/.test(f.mimeType) || /\.(xlsx?|csv|ods)$/i.test(f.filename)) return FileSpreadsheet;
  if (/(zip|compressed|tar|rar|7z)/.test(f.mimeType)) return FileArchive;
  if (kindOf(f) === "pdf" || kindOf(f) === "doc") return FileText;
  return File;
}

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const sentOn = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const OTHER = "__other__";

type TopicGroup = { key: string; title: string; files: AttachmentFile[] };
type SenderGroup = { key: string; name: string; email: string; files: AttachmentFile[]; topics: TopicGroup[] };

/** Files grouped by who sent them, then by the topic of their email. Biggest groups first; "Other" last. */
function group(files: AttachmentFile[]): SenderGroup[] {
  const senders = new Map<string, SenderGroup>();
  for (const f of files) {
    const key = f.sender.email || f.sender.name;
    const g = senders.get(key) ?? { key, name: f.sender.name, email: f.sender.email, files: [], topics: [] };
    g.files.push(f);
    senders.set(key, g);
  }
  for (const g of senders.values()) {
    const topics = new Map<string, TopicGroup>();
    for (const f of g.files) {
      const key = f.topic ?? OTHER;
      const t = topics.get(key) ?? { key, title: f.topic ? categoryInfo(f.topic).title : "Other", files: [] };
      t.files.push(f);
      topics.set(key, t);
    }
    g.topics = [...topics.values()].sort((a, b) => Number(a.key === OTHER) - Number(b.key === OTHER) || b.files.length - a.files.length);
  }
  return [...senders.values()].sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
}

/** Every real file attached to your email in the last 30 days, filed by sender and then by topic. */
export const AttachmentsWidget = memo(function AttachmentsWidget(_props: Props) {
  const { attachments } = useDashboardData();
  const [kind, setKind] = useState<Kind>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { all: attachments.items.length, pdf: 0, image: 0, doc: 0, other: 0 };
    for (const f of attachments.items) c[kindOf(f)] += 1;
    return c;
  }, [attachments.items]);
  const senders = useMemo(
    () => group(kind === "all" ? attachments.items : attachments.items.filter((f) => kindOf(f) === kind)),
    [attachments.items, kind]
  );

  if (!attachments.items.length) return <div className="widget-empty"><p>No attachments in the last 30 days.</p></div>;

  return (
    <div className="thread-widget">
      <div className="segmented segmented-sm" role="group" aria-label="File type">
        {KINDS.filter((k) => k.value === "all" || counts[k.value] > 0).map((k) => (
          <button key={k.value} aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
            {k.label} <span className="num muted">{counts[k.value]}</span>
          </button>
        ))}
      </div>

      <ul className="file-senders">
        {senders.map((s) => {
          const sOpen = Boolean(open[s.key]);
          return (
            <li key={s.key} className="file-sender" data-open={sOpen}>
              <button className="topic-head" aria-expanded={sOpen} onClick={() => toggle(s.key)} aria-label={`${s.name}, ${s.files.length} files from them`}>
                <ChevronRight size={14} className="folder-chevron" aria-hidden />
                {sOpen ? <FolderOpen size={16} className="folder-icon" aria-hidden /> : <Folder size={16} className="folder-icon" aria-hidden />}
                <span className="file-sender-name">
                  <span className="topic-title">{s.name}</span>
                  {s.email && <span className="file-sender-email">{s.email}</span>}
                </span>
                <span className="topic-count num">{s.files.length}</span>
              </button>
              {sOpen && (
                <ul className="file-topics">
                  {s.topics.map((t) => {
                    const key = `${s.key}/${t.key}`;
                    const tOpen = Boolean(open[key]);
                    return (
                      <li key={t.key} className="file-topic" data-open={tOpen}>
                        <button className="topic-head topic-head-sm" aria-expanded={tOpen} onClick={() => toggle(key)} aria-label={`${t.title}, ${t.files.length} files about this topic`}>
                          <ChevronRight size={14} className="folder-chevron" aria-hidden />
                          <span className="topic-title">{t.title}</span>
                          <span className="file-topic-count num">{t.files.length}</span>
                        </button>
                        {tOpen && (
                          <ul className="files">
                            {t.files.map((f) => <FileRow key={f.id} f={f} />)}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <p className="howto">
        <Info size={13} aria-hidden />
        <span>{attachments.total} files in the last 30 days, filed by sender and topic. Topics and summaries are by AI and can be wrong.</span>
      </p>
    </div>
  );
});

function FileRow({ f }: { f: AttachmentFile }) {
  const openViewer = useViewer((s) => s.open);
  const Icon = iconOf(f);
  return (
    <li className="file">
      <span className="file-icon" data-kind={kindOf(f)}><Icon size={16} aria-hidden /></span>
      <button className="file-main" onClick={() => openViewer(f.threadId)} title="Open the email">
        <span className="file-line">
          <span className="file-name">{f.filename}</span>
          <span className="file-date num">{sentOn(f.at)}</span>
        </span>
        <span className="file-summary">{f.summary}</span>
      </button>
      <span className="file-size muted small num">{size(f.size)}</span>
      {f.downloadable && f.attachmentId ? (
        <a className="icon-btn" href={api.attachmentUrl(f.gmailId, f.attachmentId)} download={f.filename} aria-label={`Download ${f.filename}`} title="Download">
          <Download size={16} aria-hidden />
        </a>
      ) : f.link ? (
        <a className="icon-btn" href={f.link} target="_blank" rel="noreferrer" aria-label={`Open the email with ${f.filename} in Gmail`}>
          <ExternalLink size={16} aria-hidden />
        </a>
      ) : (
        <span className="thread-sample" title="Sample files aren't real">Sample</span>
      )}
    </li>
  );
}
