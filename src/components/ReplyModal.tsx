import { useEffect, useState } from "react";
import { create } from "zustand";
import { AlertTriangle, Info, Loader2, Package, Paperclip, RefreshCw, Send, Sparkles } from "lucide-react";
import { api, type ReplyDraft } from "../lib/api";
import { useSendReply, useStatus } from "../lib/queries";
import { errorMessage } from "../lib/errors";
import { Modal } from "./Modal";
import { confirm } from "./ConfirmDialog";
import { toast } from "./Toaster";

// One reply dialog for the whole app. Any widget opens it with useReply.getState().open(threadId, label).
// Flow: AI drafts → the user edits → Send → a confirmation says exactly who it goes to → sent. Nothing is sent
// without that confirmation (AGENTS.md rule 4).

type ReplyState = { threadId: string | null; label: string; open: (threadId: string, label?: string) => void; close: () => void };
export const useReply = create<ReplyState>((set) => ({
  threadId: null,
  label: "",
  open: (threadId, label = "") => set({ threadId, label }),
  close: () => set({ threadId: null, label: "" }),
}));

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const SPLIT = /[,;\s]+/;
const FORM_ID = "reply-form";
const formatTo = (to: ReplyDraft["to"]) => to.map((a) => a.email).join(", ");
const parseTo = (text: string) => text.split(SPLIT).map((s) => s.trim()).filter(Boolean).map((email) => ({ name: "", email }));

export function ReplyModal() {
  const threadId = useReply((s) => s.threadId);
  const label = useReply((s) => s.label);
  const close = useReply((s) => s.close);
  // The form reports whether there are unsent edits, so closing can ask first.
  const [dirty, setDirty] = useState(false);

  const requestClose = async () => {
    if (dirty && !(await confirm({ title: "Discard this reply?", message: "Your edits haven't been sent and will be lost.", confirmLabel: "Discard", cancelLabel: "Keep editing", tone: "danger" }))) return;
    setDirty(false);
    close();
  };

  return (
    <Modal
      open={Boolean(threadId)}
      onClose={() => void requestClose()}
      size="md"
      className="reply-modal"
      title={`Reply${label ? ` to ${label}` : ""}`}
      description="Written by AI from the emails and their attachments. Edit anything before you send it."
      footer={threadId ? <ReplyFooter /> : undefined}
    >
      {threadId ? <ReplyForm key={threadId} threadId={threadId} onDirty={setDirty} onSent={() => { setDirty(false); close(); }} /> : null}
    </Modal>
  );
}

// The footer's buttons live outside the form (the Modal keeps them fixed), so they talk to it through a tiny store.
const useFooter = create<{ drafting: boolean; sending: boolean; disabledReason: string | null; regenerate: () => void }>(() => ({
  drafting: true, sending: false, disabledReason: null, regenerate: () => {},
}));

function ReplyFooter() {
  const { drafting, sending, disabledReason, regenerate } = useFooter();
  return (
    <>
      <span className="muted small">Nothing is sent until you confirm.</span>
      <button type="button" className="btn btn-ghost" onClick={regenerate} disabled={drafting || sending}>
        <RefreshCw size={14} aria-hidden /> New draft
      </button>
      <button type="submit" form={FORM_ID} className="btn btn-primary" disabled={Boolean(disabledReason) || drafting || sending} title={disabledReason ?? undefined}>
        {sending ? <Loader2 size={15} className="spin" aria-hidden /> : <Send size={15} aria-hidden />} Send reply
      </button>
    </>
  );
}

function ReplyForm({ threadId, onDirty, onSent }: { threadId: string; onDirty: (dirty: boolean) => void; onSent: () => void }) {
  const { data: status } = useStatus();
  const send = useSendReply();
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [drafting, setDrafting] = useState(true);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  // The owner's own context for the AI (decision #69): "Rewrite with this" turns the current text into a new draft.
  const [guidance, setGuidance] = useState("");

  const runDraft = async (opts: { guidance?: string; current?: string } = {}) => {
    setDrafting(true);
    setDraftError(null);
    try {
      const d = await api.draftReply(threadId, opts);
      setDraft(d);
      setTo((cur) => cur || formatTo(d.to));
      setSubject((cur) => cur || d.subject);
      setBody(d.body);
      setEdited(false);
    } catch (err) {
      setDraftError(errorMessage(err));
    } finally {
      setDrafting(false);
    }
  };
  useEffect(() => { void runDraft(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per thread (the form is keyed by it)

  const gmail = status?.gmail;
  const recipients = parseTo(to);
  const badAddress = recipients.find((r) => !EMAIL.test(r.email));
  const blocker = !gmail ? "Gmail isn't connected." : !gmail.canSend ? "Gmail hasn't allowed sending yet." : null;
  const invalid = !recipients.length ? "Add at least one recipient." : badAddress ? `“${badAddress.email}” isn't an email address.` : !subject.trim() ? "Add a subject." : !body.trim() ? "Write a message." : null;

  const regenerate = async () => {
    if (edited && !(await confirm({ title: "Replace your edits?", message: "A new AI draft replaces the text you've changed.", confirmLabel: "Write a new draft", tone: "danger" }))) return;
    void runDraft(guidance.trim() ? { guidance: guidance.trim() } : {});
  };
  /** Rewrites the text in the box (your edits included) to follow your instructions. */
  const rewrite = () => {
    if (!guidance.trim() || drafting) return;
    void runDraft({ guidance: guidance.trim(), current: body });
  };

  // Keep the fixed footer and the close guard in step with the form.
  useEffect(() => { onDirty(edited); }, [edited, onDirty]);
  useEffect(() => {
    useFooter.setState({ drafting, sending: send.isPending, disabledReason: blocker ?? invalid, regenerate: () => void regenerate() });
  });

  const submit = async () => {
    if (blocker || invalid) return;
    const list = recipients.map((r) => r.email).join(", ");
    const sent = await confirm({
      title: "Send this reply?",
      message: <>It goes to <strong>{list}</strong> from {gmail?.email}, now. You can't unsend it.</>,
      details: <p className="ui-modal-details">Subject: {subject.trim()}</p>,
      confirmLabel: "Send reply",
      icon: <Send size={18} />,
      action: () => send.mutateAsync({ threadId, to: recipients, subject: subject.trim(), body: body.trim() }),
    });
    if (sent) {
      toast.success("Reply sent", `To ${list}. It's in your Gmail Sent folder.`);
      onSent();
    }
  };

  return (
    <form id={FORM_ID} className="reply-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {draft ? (
        <blockquote className="reply-quote">
          <span className="reply-quote-from">{draft.replyingTo.from} wrote:</span> {draft.replyingTo.snippet}
        </blockquote>
      ) : null}

      <label className="field">
        <span className="field-label">To</span>
        <input className="input" type="text" inputMode="email" value={to} onChange={(e) => { setTo(e.target.value); setEdited(true); }}
          placeholder="name@company.com" autoComplete="off" spellCheck={false} aria-invalid={Boolean(badAddress) || undefined} />
      </label>
      <label className="field">
        <span className="field-label">Subject</span>
        <input className="input" value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true); }} />
      </label>
      <label className="field">
        <span className="field-label field-label-row">
          Message
          {draft && !drafting ? <span className="tag" data-tone="accent"><Sparkles size={12} aria-hidden /> AI draft</span> : null}
        </span>
        {drafting ? (
          <span className="reply-loading" role="status"><Loader2 size={16} className="spin" aria-hidden /> Writing a draft with AI…</span>
        ) : (
          <textarea className="input textarea" rows={11} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} placeholder="Write your reply" />
        )}
      </label>

      <div className="reply-guidance">
        <label className="field-label" htmlFor="reply-guidance">Tell the AI what to say</label>
        <textarea id="reply-guidance" className="input reply-guidance-input" rows={2} value={guidance} onChange={(e) => setGuidance(e.target.value)} disabled={drafting}
          placeholder="Add context or what to change, e.g. they're a regular, offer 5% off; we can deliver Tuesday; keep it short"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); rewrite(); } }} />
        <div className="reply-guidance-row">
          <span className="muted small">The AI rewrites the message above, your edits included. Nothing is sent.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={rewrite} disabled={drafting || !guidance.trim()}>
            {drafting ? <Loader2 size={14} className="spin" aria-hidden /> : <Sparkles size={14} aria-hidden />} Rewrite with this
          </button>
        </div>
      </div>

      {draftError ? <p className="ui-modal-error" role="alert"><AlertTriangle size={15} aria-hidden /><span>Couldn't write a draft: {draftError} You can still write the reply yourself.</span></p> : null}
      {draft && !drafting && draft.filesRead?.length > 0 ? (
        <p className="muted small reply-files"><Paperclip size={13} aria-hidden /><span>Draft based on: {draft.filesRead.join(", ")}</span></p>
      ) : null}
      {draft && !drafting && (draft.inventory?.length ?? 0) > 0 ? (
        <p className="muted small reply-files" role="note" aria-label="Stock used in this draft">
          <Package size={13} aria-hidden />
          <span>Live stock used: {draft.inventory!.map((p) => `${p.name}: ${p.inStock === null ? "stock unknown" : p.inStock <= 0 ? "out of stock" : `${p.inStock} in stock`}`).join(" · ")}</span>
        </p>
      ) : null}
      {draft?.note && !drafting ? <p className="reply-note"><Info size={14} aria-hidden /><span>Check before sending: {draft.note} Fill in anything in [brackets].</span></p> : null}
      {blocker ? (
        <p className="reply-alert" role="note">
          <AlertTriangle size={14} aria-hidden />
          <span>{blocker} {gmail?.mode === "live" && !gmail.canSend ? <>Open <a href="#/integrations">Integrations</a>, disconnect, then connect Gmail again.</> : null}</span>
        </p>
      ) : null}
    </form>
  );
}
