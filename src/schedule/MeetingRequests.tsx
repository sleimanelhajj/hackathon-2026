import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, CalendarCheck2, CalendarX2, Check, Clock, FlaskConical, Loader2, Mail, RotateCcw, Send, UserCheck, X } from "lucide-react";
import { api, type MeetingRequest } from "../lib/api";
import { useViewer } from "../components/EmailViewer";

export const requestWhen = (r: Pick<MeetingRequest, "start" | "end">) => {
  const s = new Date(r.start), e = new Date(r.end);
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${s.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, ${t(s)}–${t(e)}`;
};
const at = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const who = (r: MeetingRequest) => r.contact || "the sender";

/** Why a request is waiting for the user, in plain words. */
function waitingReason(r: MeetingRequest) {
  if (r.reason === "outside") return "Outside your available hours";
  if (r.reason === "past") return "The time has passed (automatic replies are paused for this conversation)";
  if (r.reason === "clash") return `Clashes with ${r.clashWith ?? "another meeting"} (automatic replies are paused for this conversation)`;
  return "Needs your answer";
}

/**
 * Accept or decline a request waiting for the user. Both send an email to the person who asked, so the first click
 * says exactly what will be sent and the second sends it (AGENTS.md rule 4).
 */
export function RequestDecision({ request }: { request: MeetingRequest }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<null | "accept" | "decline">(null);
  const answer = useMutation({
    mutationFn: (accept: boolean) => api.answerMeetingRequest(request.id, accept),
    onSuccess: () => { setConfirming(null); void qc.invalidateQueries({ queryKey: ["schedule"] }); },
  });
  if (confirming) {
    const accept = confirming === "accept";
    return (
      <div className="req-confirm" role="group" aria-label={accept ? "Confirm accepting" : "Confirm declining"}>
        <p>
          {accept
            ? <>We'll email {who(request)} that {requestWhen(request)} works for you, and add it to your calendar.</>
            : <>We'll email {who(request)} that you're not available then, with your next free times to choose from.</>}
        </p>
        {answer.error && <p className="agent-error" role="alert"><AlertTriangle size={13} aria-hidden /> {(answer.error as Error).message}</p>}
        <div className="req-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setConfirming(null); answer.reset(); }} disabled={answer.isPending}>Cancel</button>
          <button type="button" className={`btn btn-sm ${accept ? "btn-primary" : "btn-secondary"}`} onClick={() => answer.mutate(accept)} disabled={answer.isPending}>
            {answer.isPending ? <Loader2 size={14} className="spin" aria-hidden /> : <Send size={14} aria-hidden />} {accept ? "Send and accept" : "Send and decline"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="req-actions">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => useViewer.getState().open(request.threadId)}><Mail size={14} aria-hidden /> Read the email</button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming("decline")}><X size={14} aria-hidden /> Decline</button>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setConfirming("accept")}><Check size={14} aria-hidden /> Accept</button>
    </div>
  );
}

function RequestCard({ request }: { request: MeetingRequest }) {
  return (
    <section className="req-card" role="region" aria-label={`Request from ${who(request)}: ${request.title}`}>
      <span className="req-icon" aria-hidden><Clock size={18} /></span>
      <div className="req-text">
        <strong>{request.title}</strong>
        <span className="muted small">{who(request)} asked for <span className="req-time">{requestWhen(request)}</span></span>
        <span className="req-reason">{waitingReason(request)}</span>
      </div>
      <RequestDecision request={request} />
    </section>
  );
}

function emailStatus(r: MeetingRequest, testMode: boolean) {
  if (!r.email) return null;
  if (r.email.error) return { tone: "danger", text: `Couldn't send: ${r.email.error}` };
  if (r.email.dryRun) return { tone: testMode ? "muted" : "warn", text: testMode ? "Recorded in test mode (not sent)" : "Written in test mode, not sent yet" };
  return { tone: "ok", text: r.email.sentAt ? `Sent ${at(r.email.sentAt)}` : "Sent" };
}

/** One email the assistant sent (or tried to) about a request. */
function ReplyRow({ request, auto, testMode }: { request: MeetingRequest; auto: boolean; testMode: boolean }) {
  const qc = useQueryClient();
  const retry = useMutation({ mutationFn: () => api.retryMeetingEmail(request.id), onSuccess: () => void qc.invalidateQueries({ queryKey: ["schedule"] }) });
  const status = emailStatus(request, testMode);
  // A failed email can be retried; one written in test mode can be sent once test mode is off. Both are your click.
  const sendLabel = request.email?.error ? "Retry" : request.email?.dryRun && !testMode ? "Send now" : null;
  const reason = auto
    ? request.reason === "past" ? "The time had already passed" : `Clashed with ${request.clashWith ?? "another meeting"}`
    : request.status === "confirmed" ? "You accepted" : "You declined";
  const Icon = auto ? Bot : request.status === "confirmed" ? CalendarCheck2 : CalendarX2;
  return (
    <li className="req-row">
      <span className="req-row-icon" data-tone={request.status === "confirmed" ? "ok" : undefined} aria-hidden><Icon size={16} /></span>
      <div className="req-row-text">
        <span><strong>{who(request)}</strong> · {request.title} · <span className="muted">{requestWhen(request)}</span></span>
        <span className="small">{reason}{status && <> · <span data-tone={status.tone} className="req-status">{status.text}</span></>}</span>
        {request.email?.body && (
          <details className="req-email">
            <summary>See the email</summary>
            <pre>{request.email.body}</pre>
          </details>
        )}
        {retry.error && <p className="agent-error" role="alert"><AlertTriangle size={13} aria-hidden /> {(retry.error as Error).message}</p>}
      </div>
      {sendLabel && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
          {retry.isPending ? <Loader2 size={13} className="spin" aria-hidden /> : sendLabel === "Retry" ? <RotateCcw size={13} aria-hidden /> : <Send size={13} aria-hidden />} {sendLabel}
        </button>
      )}
    </li>
  );
}

/** Requests waiting for the user, then what was answered automatically and by the user. */
export function MeetingRequests({ requests, dryRun }: { requests: MeetingRequest[]; dryRun: boolean }) {
  const pending = requests.filter((r) => r.status === "pending");
  const auto = requests.filter((r) => r.status === "auto-declined" && r.email);
  const yours = requests.filter((r) => r.decidedBy === "user" && (r.status === "confirmed" || r.status === "declined"));
  return (
    <div className="req-panel">
      {dryRun && (
        <p className="cal-note"><FlaskConical size={14} aria-hidden /> Test mode: emails about meeting requests are written and listed here, but not sent.</p>
      )}
      {pending.length > 0 ? (
        <div className="req-list" aria-label="Waiting for you">{pending.map((r) => <RequestCard key={r.id} request={r} />)}</div>
      ) : (
        <p className="req-empty"><UserCheck size={16} aria-hidden /> Nothing waiting for you. When someone asks to meet outside your hours, it shows here.</p>
      )}
      {auto.length > 0 && (
        <section className="req-log" role="region" aria-label="Automatic replies">
          <h3 className="req-log-title"><Bot size={14} aria-hidden /> Automatic replies</h3>
          <ul>{auto.map((r) => <ReplyRow key={r.id} request={r} auto testMode={dryRun} />)}</ul>
        </section>
      )}
      {yours.length > 0 && (
        <section className="req-log" role="region" aria-label="Your answers">
          <h3 className="req-log-title"><UserCheck size={14} aria-hidden /> Your answers</h3>
          <ul>{yours.map((r) => <ReplyRow key={r.id} request={r} auto={false} testMode={dryRun} />)}</ul>
        </section>
      )}
    </div>
  );
}
