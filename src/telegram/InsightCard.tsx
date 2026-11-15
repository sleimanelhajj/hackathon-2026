import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ChevronDown, Clock, Handshake, ListChecks, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { api, timeAgo, type TelegramChat, type TelegramInsight } from "../lib/api";
import { errorMessage } from "../lib/errors";

const WAITING = {
  you: { label: "Waiting on you", tone: "warn" },
  them: { label: `Waiting on them`, tone: "accent" },
  nobody: { label: "Nothing pending", tone: "ok" },
} as const;

export const insightKey = (chat: TelegramChat) => ["telegram-insight", chat.id, chat.lastMessageAt] as const;

/**
 * The AI's read of one chat (decision #65): what was discussed, who is waiting on whom, promises and follow-ups (each
 * with a link to the message it comes from), the next step and a suggested message. Labelled as a guess throughout.
 */
export function InsightCard({ chat, onJump, onUseMessage }: { chat: TelegramChat; onJump: (messageId: number) => void; onUseMessage: (text: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: insightKey(chat),
    queryFn: () => api.telegramInsight(chat.id),
    staleTime: Infinity, // the server says when it's out of date (a newer message)
    retry: false,
  });

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try { qc.setQueryData(insightKey(chat), await api.telegramRefreshInsight(chat.id)); }
    catch (err) { setRefreshError(errorMessage(err)); }
    finally { setRefreshing(false); }
  };

  return (
    <section className="tg-insight" aria-label="AI summary of this chat">
      <header className="tg-insight-head">
        <button type="button" className="tg-insight-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Sparkles size={15} aria-hidden /> <span>AI summary</span>
          <span className="tag tag-sm" data-tone="inferred">AI guess</span>
          {data ? <span className="tag tag-sm" data-tone={WAITING[data.waitingOn].tone}>{WAITING[data.waitingOn].label}</span> : null}
          <ChevronDown size={15} className="tg-insight-chevron" aria-hidden />
        </button>
        {data ? (
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => void refresh()} disabled={refreshing} aria-label="Make the summary again" title="Make the summary again">
            {refreshing ? <Loader2 size={14} className="spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
          </button>
        ) : null}
      </header>

      {open && (
        <div className="tg-insight-body">
          {isLoading ? <p className="muted small"><Loader2 size={13} className="spin" aria-hidden /> Reading this chat…</p> : null}
          {(error || refreshError) && !refreshing ? (
            <div className="tg-insight-error">
              <p className="field-error" role="alert">{refreshError ?? errorMessage(error)}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refresh()}><RefreshCw size={13} aria-hidden /> Try again</button>
            </div>
          ) : null}
          {refreshing && !data ? <p className="muted small"><Loader2 size={13} className="spin" aria-hidden /> Reading this chat…</p> : null}
          {data ? <InsightBody insight={data} onJump={onJump} onUseMessage={onUseMessage} /> : null}
        </div>
      )}
    </section>
  );
}

function InsightBody({ insight, onJump, onUseMessage }: { insight: TelegramInsight; onJump: (id: number) => void; onUseMessage: (text: string) => void }) {
  const see = (id: number) => (
    <button type="button" className="tg-see" onClick={() => onJump(id)}><ArrowDownToLine size={12} aria-hidden /> See message</button>
  );
  return (
    <>
      <p className="tg-insight-summary">{insight.summary}</p>
      {insight.topics.length ? <p className="tg-topics">{insight.topics.map((t) => <span key={t} className="tag tag-sm">{t}</span>)}</p> : null}

      <div className="tg-next">
        <p className="field-label">Next step</p>
        <p>{insight.nextStep}</p>
      </div>

      {insight.promises.length ? (
        <div className="tg-insight-list">
          <p className="field-label"><Handshake size={13} aria-hidden /> Promises</p>
          <ul>
            {insight.promises.map((p, i) => (
              <li key={i}>
                <span className="tg-who" data-by={p.by}>{p.by === "you" ? "You" : "They"}</span> {p.what}
                {p.due ? <span className="tg-due"><Clock size={12} aria-hidden /> {p.due}</span> : null}
                {see(p.messageId)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insight.followUps.length ? (
        <div className="tg-insight-list">
          <p className="field-label"><ListChecks size={13} aria-hidden /> Follow up</p>
          <ul>{insight.followUps.map((f, i) => <li key={i}>{f.what} {see(f.messageId)}</li>)}</ul>
        </div>
      ) : null}

      {insight.suggestedMessage ? (
        <div className="tg-suggest">
          <p className="field-label">Suggested message</p>
          <p className="tg-suggest-text">{insight.suggestedMessage}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onUseMessage(insight.suggestedMessage)}>Use this message</button>
          <span className="muted small">You can edit it before sending. Fill in anything in [brackets].</span>
        </div>
      ) : null}

      <p className="tg-insight-foot">Made {timeAgo(insight.generatedAt)} from the messages below. Check them before you act.</p>
    </>
  );
}
