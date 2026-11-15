import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Image as ImageIcon, Megaphone, MessagesSquare, Plug, Send, User, Users } from "lucide-react";
import { api, timeAgo, type TelegramChat, type TelegramMessage } from "../lib/api";
import { Callout } from "../components/ui";
import { TableSkeleton } from "../components/Skeletons";
import { confirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";
import { errorMessage } from "../lib/errors";
import { useTelegramStatus } from "../telegram/queries";
import { PeopleDialog } from "../telegram/PeopleDialog";
import { InsightCard } from "../telegram/InsightCard";

// The Telegram tab (decisions #64, #65): the chats of the people the user follows on the left, the conversation on the
// right (one at a time on a phone) with an AI summary on top and a message box that asks before anything is sent.
// Message text is shown as plain text, never as HTML.

const KIND_ICON = { user: User, group: Users, channel: Megaphone } as const;
const KIND_LABEL = { user: "Direct chat", group: "Group", channel: "Channel" } as const;
const MAX_SEND_CHARS = 4096;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

export default function TelegramPage() {
  const { data: tg, isLoading, error } = useTelegramStatus();
  const chatsQuery = useQuery({ queryKey: ["telegram-chats", tg?.lastSyncAt], queryFn: api.telegramChats, enabled: Boolean(tg?.connected) });
  const [openId, setOpenId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const chats = chatsQuery.data?.chats;
  const open = chats?.find((c) => c.id === openId) ?? null;
  const unread = useMemo(() => chats?.reduce((n, c) => n + (c.unread > 0 ? 1 : 0), 0) ?? 0, [chats]);
  const people = tg?.people ?? [];

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1 className="page-title">Telegram</h1>
          <p className="page-sub">
            {tg?.connected ? `${tg.account?.name ?? "Your account"} · read ${timeAgo(tg.lastSyncAt)}${tg.status === "syncing" ? " · reading new messages…" : ""}` : "Your Telegram chats"}
          </p>
        </div>
        {tg?.connected ? (
          <div className="page-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setChoosing(true)} aria-haspopup="dialog">
              <Users size={15} aria-hidden /> {people.length ? `Following ${people.length} ${people.length === 1 ? "person" : "people"}` : "Choose people"}
            </button>
          </div>
        ) : null}
      </header>

      {error ? <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load Telegram" text={errorMessage(error)} /> : null}
      {isLoading ? <TableSkeleton rows={6} label="Loading Telegram" /> : null}

      {tg && !tg.connected && (
        <Callout icon={<Send size={18} />} title="Connect Telegram to see your chats here"
          text={tg.configured ? "Sign in with your phone number on the Integrations page." : "Telegram isn't set up on the server yet."}
          action={<a className="btn btn-primary" href="#/integrations"><Plug size={15} aria-hidden /> Go to Integrations</a>} />
      )}
      {tg?.error ? <Callout tone="danger" icon={<AlertTriangle size={18} />} title="The last read failed" text={tg.error} action={<a className="btn btn-secondary" href="#/integrations">Fix in Integrations</a>} /> : null}

      {tg?.connected && chatsQuery.isLoading ? <TableSkeleton rows={6} label="Loading chats" /> : null}
      {chatsQuery.error ? <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load your chats" text={errorMessage(chatsQuery.error)} /> : null}

      {chats && chats.length === 0 && (
        <Callout icon={<MessagesSquare size={18} />}
          title={tg?.status === "syncing" ? "Reading your chats…" : people.length ? "No chats with these people in the last 30 days" : "No chats from the last 30 days"}
          text={people.length ? "Check the names match how they show in Telegram, or add someone else." : "Chats with messages from the last 30 days show here after each read."}
          action={<button type="button" className="btn btn-primary" onClick={() => setChoosing(true)}><Users size={15} aria-hidden /> Choose people</button>} />
      )}

      {chats && chats.length > 0 && (
        <>
          {unread > 0 && !open ? <Callout icon={<MessagesSquare size={18} />} title={`${unread} ${unread === 1 ? "chat has" : "chats have"} unread messages`} text="Open a chat to see a summary, what was promised and what to send next." /> : null}
          <div className="tg-layout" data-open={open ? "chat" : "list"}>
            <nav className="surface tg-list" aria-label="Telegram chats">
              <ul>
                {chats.map((c) => <ChatRow key={c.id} chat={c} active={c.id === openId} onOpen={setOpenId} />)}
              </ul>
            </nav>
            <section className="surface tg-thread" aria-label={open ? `Chat with ${open.title}` : "Conversation"}>
              {open ? <Thread key={open.id} chat={open} insights={tg?.insightsAvailable ?? false} onBack={() => setOpenId(null)} /> : (
                <div className="tg-empty"><MessagesSquare size={22} aria-hidden /><p>Pick a chat to read it.</p></div>
              )}
            </section>
          </div>
        </>
      )}

      <PeopleDialog open={choosing} onClose={() => setChoosing(false)} people={people} chats={chats ?? []} />
    </div>
  );
}

const ChatRow = memo(function ChatRow({ chat, active, onOpen }: { chat: TelegramChat; active: boolean; onOpen: (id: string) => void }) {
  const Icon = KIND_ICON[chat.kind] ?? User;
  return (
    <li>
      <button type="button" className="tg-chat" aria-current={active || undefined} onClick={() => onOpen(chat.id)}>
        <span className="tg-avatar" aria-hidden><Icon size={16} /></span>
        <span className="tg-chat-text">
          <span className="tg-chat-title">{chat.title}</span>
          <span className="tg-chat-meta">{KIND_LABEL[chat.kind]} · {timeAgo(chat.lastMessageAt)}</span>
        </span>
        {chat.unread > 0 ? <span className="tg-unread" aria-label={`${chat.unread} unread`}>{chat.unread > 99 ? "99+" : chat.unread}</span> : null}
      </button>
    </li>
  );
});

function Thread({ chat, insights, onBack }: { chat: TelegramChat; insights: boolean; onBack: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["telegram-messages", chat.id, chat.lastMessageAt], queryFn: () => api.telegramMessages(chat.id) });
  const [draft, setDraft] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // Messages grouped by day in one pass.
  const days = useMemo(() => {
    const out: { day: string; items: TelegramMessage[] }[] = [];
    for (const m of data?.messages ?? []) {
      const day = dayFmt.format(new Date(m.date));
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(m);
    }
    return out;
  }, [data]);

  /** Scrolls to the message an insight points at and highlights it for a moment. */
  const jump = useCallback((id: number) => {
    const el = document.getElementById(`tg-msg-${chat.id}-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("tg-msg-flash");
    void el.offsetWidth; // restart the highlight
    el.classList.add("tg-msg-flash");
  }, [chat.id]);
  const useMessage = useCallback((text: string) => {
    setDraft(text);
    requestAnimationFrame(() => box.current?.focus());
  }, []);

  return (
    <>
      <header className="tg-thread-head">
        <button type="button" className="icon-btn tg-back" onClick={onBack} aria-label="Back to chats"><ArrowLeft size={17} aria-hidden /></button>
        <div>
          <h2 className="tg-thread-title">{chat.title}</h2>
          <p className="muted small">{KIND_LABEL[chat.kind]} · {chat.messageCount} recent message{chat.messageCount === 1 ? "" : "s"}</p>
        </div>
      </header>
      <div className="tg-scroll">
        {insights && (data?.messages.length ?? 0) > 0 ? <InsightCard chat={chat} onJump={jump} onUseMessage={useMessage} /> : null}
        {isLoading ? <TableSkeleton rows={4} label="Loading messages" /> : null}
        {error ? <p className="field-error" role="alert">Couldn't load this chat. {errorMessage(error)}</p> : null}
        {data && data.messages.length === 0 ? <p className="muted">No messages from the last 30 days.</p> : null}
        {days.map(({ day, items }) => (
          <div key={day} className="tg-day">
            <p className="tg-day-label">{day}</p>
            {items.map((m) => (
              <article key={m.id} id={`tg-msg-${chat.id}-${m.id}`} className="tg-msg" data-out={m.out || undefined}>
                {!m.out && chat.kind !== "user" && m.from ? <p className="tg-msg-from">{m.from}</p> : null}
                {m.text ? <p className="tg-msg-text">{m.text}</p> : null}
                {m.hasMedia ? <p className="tg-msg-media"><ImageIcon size={13} aria-hidden /> Photo, file or other media (open Telegram to see it)</p> : null}
                <time className="tg-msg-time" dateTime={m.date}>{timeFmt.format(new Date(m.date))}</time>
              </article>
            ))}
          </div>
        ))}
      </div>
      {chat.kind === "channel" ? (
        <p className="tg-readonly"><Megaphone size={13} aria-hidden /> This is a channel: only its admins can post.</p>
      ) : (
        <Composer chat={chat} draft={draft} setDraft={setDraft} box={box} />
      )}
    </>
  );
}

/** Writing a message. Send opens a confirmation with the exact text; only "Send message" there sends it. */
function Composer({ chat, draft, setDraft, box }: { chat: TelegramChat; draft: string; setDraft: (v: string) => void; box: React.RefObject<HTMLTextAreaElement | null> }) {
  const qc = useQueryClient();
  const text = draft.trim();
  const tooLong = text.length > MAX_SEND_CHARS;
  const hasPlaceholder = /\[[^\]]+\]/.test(text);

  const send = async () => {
    if (!text || tooLong) return;
    const ok = await confirm({
      title: `Send to ${chat.title}?`,
      message: hasPlaceholder
        ? "The message still has a [placeholder] in it. Send it anyway? It goes from your own Telegram account."
        : "This message goes from your own Telegram account. You can't unsend it from here.",
      details: text,
      confirmLabel: "Send message",
      cancelLabel: "Keep editing",
      tone: "primary",
      icon: <Send size={18} />,
      action: () => api.telegramSend(chat.id, text),
    });
    if (!ok) return;
    setDraft("");
    toast.success(`Sent to ${chat.title}`);
    void qc.invalidateQueries({ queryKey: ["telegram-messages", chat.id] });
    void qc.invalidateQueries({ queryKey: ["telegram-chats"] });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); }
  };

  return (
    <form className="tg-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label className="sr-only" htmlFor={`tg-compose-${chat.id}`}>Message to {chat.title}</label>
      <textarea id={`tg-compose-${chat.id}`} ref={box} className="input tg-compose-box" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
        placeholder={`Write to ${chat.title}…`} aria-describedby={`tg-compose-hint-${chat.id}`} />
      <button type="submit" className="btn btn-primary" disabled={!text || tooLong}><Send size={15} aria-hidden /> Send</button>
      <p id={`tg-compose-hint-${chat.id}`} className="tg-compose-hint" data-error={tooLong || undefined}>
        {tooLong ? `Too long for Telegram: ${text.length} of ${MAX_SEND_CHARS} characters.` : "You'll see it once more before it's sent. Ctrl+Enter to send."}
      </p>
    </form>
  );
}
