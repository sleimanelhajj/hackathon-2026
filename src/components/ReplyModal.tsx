import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { AlertTriangle, CheckCircle2, Info, Loader2, Paperclip, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { api, type ReplyDraft } from "../lib/api";
import { useSendReply, useStatus } from "../lib/queries";

// One reply dialog for the whole app. Any widget opens it with useReply.getState().open(threadId, label).
// Flow: AI drafts → the user edits → the user clicks Send. Nothing is sent without that click (AGENTS.md rule 4).

type ReplyState = { threadId: string | null; label: string; open: (threadId: string, label?: string) => void; close: () => void };
export const useReply = create<ReplyState>((set) => ({
  threadId: null,
  label: "",
  open: (threadId, label = "") => set({ threadId, label }),
  close: () => set({ threadId: null, label: "" }),
}));

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const formatTo = (to: ReplyDraft["to"]) => to.map((a) => a.email).join(", ");
const parseTo = (text: string) =>
  text.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean).map((email) => ({ name: "", email }));

export function ReplyModal() {
  const threadId = useReply((s) => s.threadId);
  const label = useReply((s) => s.label);
  const close = useReply((s) => s.close);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (threadId && !d.open) d.showModal();
    if (!threadId && d.open) d.close();
  }, [threadId]);

  return (
    <dialog ref={ref} className="modal modal-reply" aria-labelledby="reply-title" onClose={close} onCancel={close}>
      {threadId && <ReplyForm key={threadId} threadId={threadId} label={label} onClose={close} />}
    </dialog>
  );
}

function ReplyForm({ threadId, label, onClose }: { threadId: string; label: string; onClose: () => void }) {
  const { data: status } = useStatus();
  const send = useSendReply();
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [drafting, setDrafting] = useState(true);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const runDraft = async () => {
    setDrafting(true);
    setDraftError(null);
    try {
      const d = await api.draftReply(threadId);
      setDraft(d);
      setTo((cur) => cur || formatTo(d.to));
      setSubject((cur) => cur || d.subject);
      setBody(d.body);
      setEdited(false);
    } catch (err) {
      setDraftError((err as Error).message);
    } finally {
      setDrafting(false);
    }
  };
  useEffect(() => {
    void runDraft();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const gmail = status?.gmail;
  const recipients = parseTo(to);
  const badAddress = recipients.find((r) => !EMAIL.test(r.email));
  const blocker = !gmail
    ? "Gmail isn't connected."
    : gmail.mode === "sample"
      ? "This is sample data, so replies can't be sent. You can still try the AI draft."
      : !gmail.canSend
        ? "Gmail hasn't allowed sending yet."
        : null;
  const invalid = !recipients.length ? "Add at least one recipient." : badAddress ? `“${badAddress.email}” isn't an email address.` : !subject.trim() ? "Add a subject." : !body.trim() ? "Write a message." : null;

  const regenerate = () => {
    if (edited && !window.confirm("Replace your edits with a new AI draft?")) return;
    void runDraft();
  };
  const doSend = () =>
    send.mutate({ threadId, to: recipients, subject: subject.trim(), body: body.trim() }, { onSettled: () => setConfirming(false) });

  if (send.isSuccess)
    return (
      <div className="modal-body modal-done" role="status">
        <CheckCircle2 size={28} color="var(--success)" aria-hidden />
        <h2 id="reply-title" className="modal-title">Reply sent</h2>
        <p className="muted">Sent to {recipients.map((r) => r.email).join(", ")} from {gmail?.email}. It's in your Gmail Sent folder.</p>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    );

  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocker && !invalid) setConfirming(true);
      }}
    >
      <header className="modal-head">
        <div>
          <h2 id="reply-title" className="modal-title">Reply{label ? ` to ${label}` : ""}</h2>
          <p className="muted small">Written by AI from the emails and their attachments. Edit anything before you send it.</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>

      {/* Only this part scrolls: the title, the close button and Send always stay in view. */}
      <div className="modal-scroll">
      {draft && (
        <blockquote className="reply-quote">
          <span className="reply-quote-from">{draft.replyingTo.from} wrote:</span> {draft.replyingTo.snippet}
        </blockquote>
      )}

      <label className="field">
        <span className="field-label">To</span>
        <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" autoComplete="off" />
      </label>
      <label className="field">
        <span className="field-label">Subject</span>
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label field-label-row">
          Message
          {draft && !drafting && <span className="tag" data-tone="accent"><Sparkles size={12} aria-hidden /> AI draft</span>}
        </span>
        {drafting ? (
          <div className="reply-loading" role="status">
            <Loader2 size={16} className="spin" aria-hidden /> Writing a draft with AI…
          </div>
        ) : (
          <textarea
            className="input textarea"
            rows={11}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setEdited(true);
            }}
            placeholder="Write your reply"
          />
        )}
      </label>

      {draftError && (
        <p className="reply-alert" role="alert"><AlertTriangle size={14} aria-hidden /><span>Couldn't write a draft: {draftError} You can still write the reply yourself.</span></p>
      )}
      {draft && !drafting && draft.filesRead?.length > 0 && (
        <p className="muted small reply-files"><Paperclip size={13} aria-hidden /><span>Draft based on: {draft.filesRead.join(", ")}</span></p>
      )}
      {draft?.note && !drafting && (
        <p className="reply-note"><Info size={14} aria-hidden /><span>Check before sending: {draft.note} Fill in anything in [brackets].</span></p>
      )}
      {blocker && (
        <p className="reply-alert" role="note">
          <AlertTriangle size={14} aria-hidden />
          <span>
            {blocker}{" "}
            {gmail?.mode === "live" && !gmail.canSend && <>Open <a href="#/integrations" onClick={onClose}>Integrations</a>, disconnect, then connect Gmail again.</>}
          </span>
        </p>
      )}
      {send.error && <p className="reply-alert" role="alert"><AlertTriangle size={14} aria-hidden /><span>{(send.error as Error).message}</span></p>}
      </div>

      <footer className="modal-foot">
        <span className="muted small">Nothing is sent until you click Send.</span>
        <button type="button" className="btn btn-ghost" onClick={regenerate} disabled={drafting || send.isPending}>
          <RefreshCw size={14} /> New draft
        </button>
        {confirming ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={send.isPending}>Back</button>
            <button type="button" className="btn btn-primary" onClick={doSend} disabled={send.isPending} autoFocus>
              {send.isPending ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Send to {recipients.length === 1 ? recipients[0].email : `${recipients.length} people`}
            </button>
          </>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={Boolean(blocker || invalid) || drafting} title={blocker ?? invalid ?? undefined}>
            <Send size={15} /> Send reply
          </button>
        )}
      </footer>
    </form>
  );
}
