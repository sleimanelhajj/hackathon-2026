import { memo, useMemo, useState } from "react";
import { Download, ExternalLink, File, FileArchive, FileImage, FileSpreadsheet, FileText, Info, type LucideIcon } from "lucide-react";
import { api, timeAgo, type AttachmentFile, type Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";

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

/** Every real file attached to your email in the last 30 days (inline images and calendar files left out). */
export const AttachmentsWidget = memo(function AttachmentsWidget(_props: Props) {
  const { attachments } = useDashboardData();
  const [kind, setKind] = useState<Kind>("all");
  const counts = useMemo(() => {
    const c: Record<Kind, number> = { all: attachments.items.length, pdf: 0, image: 0, doc: 0, other: 0 };
    for (const f of attachments.items) c[kindOf(f)] += 1;
    return c;
  }, [attachments.items]);
  const shown = kind === "all" ? attachments.items : attachments.items.filter((f) => kindOf(f) === kind);

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
      <ul className="files">
        {shown.map((f) => {
          const Icon = iconOf(f);
          return (
            <li key={f.id} className="file">
              <span className="file-icon" data-kind={kindOf(f)}><Icon size={16} aria-hidden /></span>
              <div className="file-main">
                <p className="file-name" title={f.filename}>{f.filename}</p>
                <p className="file-meta" title={f.subject}>
                  {f.direction === "in" ? "From" : "To"} {f.contact} · {f.subject}
                </p>
              </div>
              <span className="file-side muted small num">{size(f.size)}<br />{timeAgo(f.at)}</span>
              {f.downloadable && f.attachmentId ? (
                <a className="btn btn-ghost btn-sm" href={api.attachmentUrl(f.gmailId, f.attachmentId)} download={f.filename} aria-label={`Download ${f.filename}`}>
                  <Download size={14} aria-hidden />
                </a>
              ) : f.link ? (
                <a className="btn btn-ghost btn-sm" href={f.link} target="_blank" rel="noreferrer" aria-label={`Open the email with ${f.filename} in Gmail`}>
                  <ExternalLink size={14} aria-hidden />
                </a>
              ) : (
                <span className="thread-sample" title="Sample files aren't real">Sample</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="howto">
        <Info size={13} aria-hidden />
        <span>{attachments.total} files in the last 30 days, sent and received. Inline images and calendar files are left out.</span>
      </p>
    </div>
  );
});
