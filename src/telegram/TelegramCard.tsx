import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Eye, KeyRound, Loader2, Lock, MessageSquareOff, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { api, timeAgo, type TelegramStatus } from "../lib/api";
import { confirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";
import { errorMessage } from "../lib/errors";
import { TELEGRAM_KEYS, useTelegramStatus } from "./queries";

/**
 * Telegram on the Integrations page (decision #64). Signing in is the user's own: they type their phone number, the
 * code Telegram sends to their app, and their two-step password if they use one. The app keeps only the session.
 */
export function TelegramCard() {
  const qc = useQueryClient();
  const { data: tg, error: loadError } = useTelegramStatus();
  const refresh = () => { for (const key of TELEGRAM_KEYS) void qc.invalidateQueries({ queryKey: [...key] }); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Runs one step of the sign-in, showing its error under the form. */
  const step = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); refresh(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  const sync = () => step(async () => {
    const r = await api.telegramSync();
    toast.success("Telegram is up to date", `${r.messages} message${r.messages === 1 ? "" : "s"} from ${r.chats} chat${r.chats === 1 ? "" : "s"}.`);
  });
  const askDisconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Telegram?",
      message: "This app signs out of your Telegram account and deletes the chats it read. Nothing changes in Telegram itself, and you can connect again any time.",
      confirmLabel: "Disconnect and delete chats",
      tone: "danger",
      action: () => api.telegramDisconnect(),
    });
    if (!ok) return;
    refresh();
    toast.success("Telegram disconnected", "The chats were deleted from this app.");
  };

  const tag = !tg ? null : !tg.configured ? <span className="tag">Not set up</span>
    : tg.status === "syncing" ? <span className="tag" data-tone="accent"><Loader2 size={12} className="spin" aria-hidden /> Reading chats</span>
    : tg.status === "error" ? <span className="tag" data-tone="error">Needs attention</span>
    : tg.connected ? <span className="tag" data-tone="ok">Connected</span>
    : <span className="tag">Not connected</span>;

  return (
    <section className="surface integration" aria-labelledby="telegram-title">
      <div className="integration-head">
        <div className="logo-tile logo-tile-telegram"><Send size={21} aria-hidden /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="integration-name" id="telegram-title">Telegram {tag}</h2>
          <p className="integration-desc">Your recent Telegram chats next to your email, so customer messages don't get missed.</p>
        </div>
      </div>

      {loadError ? <p className="field-error" role="alert">Couldn't check Telegram: {errorMessage(loadError)}</p> : null}

      {tg && !tg.configured && (
        <p className="integration-desc">
          Add <span className="code">TELEGRAM_API_ID</span> and <span className="code">TELEGRAM_API_HASH</span> (from my.telegram.org) on the server and restart it.
        </p>
      )}

      {tg?.configured && !tg.connected && <SignIn tg={tg} busy={busy} onStep={step} />}

      {tg?.connected && (
        <>
          <div className="integration-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void sync()} disabled={busy || tg.status === "syncing"}>
              <RefreshCw size={15} className={busy || tg.status === "syncing" ? "spin" : undefined} aria-hidden /> Read new messages
            </button>
            <a className="btn btn-primary" href="#/telegram">Open Telegram <ArrowRight size={15} aria-hidden /></a>
            <button type="button" className="btn btn-ghost" onClick={() => void askDisconnect()} aria-haspopup="dialog">Disconnect</button>
          </div>
          {tg.error ? <p className="field-error" role="alert">{tg.error}</p> : null}
          <div className="facts">
            <div><p className="fact-label">Account</p><p className="fact-value">{tg.account?.name}{tg.account?.username ? ` · @${tg.account.username}` : ""}</p></div>
            <div><p className="fact-label">Last read</p><p className="fact-value">{tg.status === "syncing" ? "In progress" : timeAgo(tg.lastSyncAt)}</p></div>
            <div><p className="fact-label">Chats</p><p className="fact-value num">{tg.chatCount} <span className="muted">· last 30 days</span></p></div>
          </div>
        </>
      )}

      {error ? <p className="field-error" role="alert">{error}</p> : null}

      {tg?.configured && (
        <ul className="perm-list">
          <li data-allowed="true"><Eye size={16} color="var(--success)" aria-hidden /> Read your 30 most recent chats from the last 30 days. Message text is stored encrypted</li>
          <li><MessageSquareOff size={16} aria-hidden /> Send, edit or delete messages: never</li>
          <li><Lock size={16} aria-hidden /> Your login code and password are never stored</li>
        </ul>
      )}
    </section>
  );
}

/** Phone → code → (two-step password). Each form submits one step; Back cancels the sign-in. */
function SignIn({ tg, busy, onStep }: { tg: TelegramStatus; busy: boolean; onStep: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const submit = (fn: () => Promise<unknown>) => (e: FormEvent) => { e.preventDefault(); void onStep(fn); };
  const back = (
    <button type="button" className="btn btn-ghost" onClick={() => void onStep(async () => { await api.telegramCancel(); setCode(""); setPassword(""); })} disabled={busy}>
      Use a different number
    </button>
  );

  if (tg.pending === "password")
    return (
      <form className="tg-signin" onSubmit={submit(async () => { await api.telegramVerifyPassword(password); setPassword(""); toast.success("Telegram connected", "Reading your recent chats now."); })}>
        <label className="field">
          <span className="field-label">Two-step verification password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
        </label>
        <p className="muted small"><KeyRound size={13} aria-hidden /> This is the extra password you set in Telegram's privacy settings.</p>
        <div className="integration-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !password}>{busy ? <Loader2 size={15} className="spin" aria-hidden /> : <ShieldCheck size={15} aria-hidden />} Connect Telegram</button>
          {back}
        </div>
      </form>
    );

  if (tg.pending === "code")
    return (
      <form className="tg-signin" onSubmit={submit(async () => {
        const r = await api.telegramVerifyCode(code);
        setCode("");
        if (r.connected) toast.success("Telegram connected", "Reading your recent chats now.");
      })}>
        <label className="field">
          <span className="field-label">Code from Telegram</span>
          <input className="input tg-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus required />
        </label>
        <p className="muted small">Telegram sent it to your Telegram app (or by SMS). Don't share it with anyone else.</p>
        <div className="integration-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || code.length < 4}>{busy ? <Loader2 size={15} className="spin" aria-hidden /> : <ShieldCheck size={15} aria-hidden />} Connect Telegram</button>
          {back}
        </div>
      </form>
    );

  return (
    <form className="tg-signin" onSubmit={submit(() => api.telegramSendCode(phone))}>
      <label className="field">
        <span className="field-label">Phone number on your Telegram account</span>
        <input className="input" type="tel" autoComplete="tel" placeholder="+961 70 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </label>
      <div className="integration-actions">
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy || phone.replace(/\D/g, "").length < 7}>
          {busy ? <Loader2 size={16} className="spin" aria-hidden /> : <Send size={16} aria-hidden />} Send me a code
        </button>
      </div>
    </form>
  );
}
