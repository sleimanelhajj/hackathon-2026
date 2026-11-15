import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { AlertTriangle, ArrowRight, Download, ExternalLink, Paperclip, Reply } from "lucide-react";
import { categoryInfo } from "../../shared/spec.js";
import { api, type ThreadView } from "../lib/api";
import { useReply } from "./ReplyModal";
import { reflowEmail, splitQuoted } from "../lib/emailText";
import { errorMessage } from "../lib/errors";
import { Modal } from "./Modal";

// Read a whole conversation without leaving the app. Any widget opens it with useViewer.getState().open(threadId).

type ViewerState = { threadId: string | null; open: (threadId: string) => void; close: () => void };
export const useViewer = create<ViewerState>((set) => ({
  threadId: null,
  open: (threadId) => set({ threadId }),
  close: () => set({ threadId: null }),
}));

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const who = (a: { name: string; email: string }) => a.name || a.email;
const initials = (name: string) => name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

export function EmailViewer() {
  const threadId = useViewer((s) => s.threadId);
  const close = useViewer((s) => s.close);
  const { data, isLoading, error } = useQuery({ queryKey: ["thread", threadId], queryFn: () => api.thread(threadId!), enabled: Boolean(threadId) });

  const reply = () => {
    if (!threadId) return;
    const lastIn = data && [...data.messages].reverse().find((m) => m.direction === "in");
    close();
    useReply.getState().open(threadId, lastIn ? who(lastIn.from) : "");
  };

  return (
    <Modal
      open={Boolean(threadId)}
      onClose={close}
      size="lg"
      className="viewer-modal"
      title={data?.subject ?? (isLoading ? "Opening conversation…" : "Conversation")}
      footer={
        data ? (
          <>
            {data.link ? (
              <a className="btn btn-ghost" href={data.link} target="_blank" rel="noreferrer">Open in Gmail <ExternalLink size={14} aria-hidden /></a>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={reply}><Reply size={15} aria-hidden /> Reply</button>
          </>
        ) : undefined
      }
    >
      {isLoading ? <div className="skeleton" style={{ height: 240 }} aria-label="Loading the conversation" /> : null}
      {error ? <p className="ui-modal-error" role="alert"><AlertTriangle size={15} aria-hidden /><span>Couldn't open this conversation. {errorMessage(error)}</span></p> : null}
      {data?.ai ? <Summary ai={data.ai} /> : null}
      {data ? (
        <ol className="viewer-messages">
          {data.messages.map((m) => (
            <li key={m.gmailId} className="viewer-message" data-direction={m.direction}>
              <div className="viewer-message-head">
                <span className="viewer-avatar" aria-hidden>{initials(m.direction === "out" ? "You" : who(m.from))}</span>
                <span className="viewer-people">
                  <span className="viewer-from">{m.direction === "out" ? "You" : who(m.from)}</span>
                  <span className="viewer-to">to {m.to.map(who).join(", ") || "—"}{m.cc.length ? `, cc ${m.cc.map(who).join(", ")}` : ""}</span>
                </span>
                <time className="viewer-date" dateTime={m.date} title={new Date(m.date).toLocaleString()}>{when(m.date)}</time>
              </div>
              <MessageBody text={m.body} />
              {m.attachments.length > 0 ? (
                <ul className="viewer-files" aria-label="Attachments">
                  {m.attachments.map((a) => (
                    <li key={`${a.filename}-${a.attachmentId}`}>
                      {a.downloadable && a.attachmentId ? (
                        <a className="viewer-file" href={api.attachmentUrl(a.gmailId, a.attachmentId)} download={a.filename}>
                          <Paperclip size={14} aria-hidden /> <span className="viewer-file-name">{a.filename}</span>
                          <span className="muted small">{size(a.size)}</span> <Download size={14} aria-hidden />
                        </a>
                      ) : (
                        <span className="viewer-file"><Paperclip size={14} aria-hidden /> <span className="viewer-file-name">{a.filename}</span> <span className="muted small">{size(a.size)}</span></span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </Modal>
  );
}

/** The email as paragraphs; the quoted earlier conversation is folded away. */
function MessageBody({ text }: { text: string }) {
  const { main, quoted } = splitQuoted(text || "");
  const paragraphs = reflowEmail(main);
  return (
    <div className="viewer-body">
      {paragraphs.length ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p className="muted">This email has no text.</p>}
      {quoted && (
        <details className="viewer-quoted">
          <summary>Show earlier messages</summary>
          <div className="viewer-quoted-text">{quoted}</div>
        </details>
      )}
    </div>
  );
}

function Summary({ ai }: { ai: NonNullable<ThreadView["ai"]> }) {
  return (
    <section className="viewer-summary" aria-label="Summary">
      <p className="viewer-summary-text">{ai.summary}</p>
      {ai.suggestedAction && <p className="viewer-next"><ArrowRight size={14} aria-hidden /> {ai.suggestedAction}</p>}
      <p className="viewer-summary-meta">
        {categoryInfo(ai.category).title}
        {ai.priority === "high" && " · Urgent"}
        {ai.needsReply && " · Needs a reply"}
        <span className="muted"> · Summary by AI, can be wrong</span>
      </p>
    </section>
  );
}
