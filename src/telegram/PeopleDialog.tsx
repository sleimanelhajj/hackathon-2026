import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, UserRound, Users, X } from "lucide-react";
import { Modal } from "../components/Modal";
import { toast } from "../components/Toaster";
import { api, type TelegramChat } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { TELEGRAM_KEYS } from "./queries";

const MAX_PEOPLE = 30;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Who to follow on Telegram (decision #65): the user types names; only chats whose name matches are read and kept.
 * Empty list: the 30 most recent chats. Chats already read are offered as one-click suggestions.
 */
export function PeopleDialog({ open, onClose, people, chats }: { open: boolean; onClose: () => void; people: string[]; chats: TelegramChat[] }) {
  return open ? <PeopleForm onClose={onClose} initial={people} chats={chats} /> : null;
}

function PeopleForm({ onClose, initial, chats }: { onClose: () => void; initial: string[]; chats: TelegramChat[] }) {
  const qc = useQueryClient();
  const [list, setList] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestions = chats.filter((c) => c.kind === "user" && !list.some((p) => same(p, c.title))).slice(0, 8);

  const add = (raw: string) => {
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value) return;
    if (list.some((p) => same(p, value))) { setName(""); return; }
    if (list.length >= MAX_PEOPLE) { setError(`You can follow up to ${MAX_PEOPLE} people.`); return; }
    setList((l) => [...l, value]);
    setName("");
    setError(null);
  };
  const submitName = (e: FormEvent) => { e.preventDefault(); add(name); };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const pending = name.trim() ? [...list, name.trim()] : list;
      const { people } = await api.telegramSetPeople(pending);
      for (const key of TELEGRAM_KEYS) void qc.invalidateQueries({ queryKey: [...key] });
      toast.success(
        people.length ? `Following ${people.length} ${people.length === 1 ? "person" : "people"}` : "Following your recent chats",
        "Reading their chats now. This takes a few seconds.",
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      icon={<Users size={18} />}
      title="Choose who to follow"
      description="Only chats with these people are read and kept in this app. Leave the list empty to follow your 30 most recent chats."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save and read chats"}</button>
        </>
      }
    >
      <form className="tg-people-add" onSubmit={submitName}>
        <label className="field">
          <span className="field-label">Name as it shows in Telegram</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Karim" maxLength={80} autoFocus />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={!name.trim()}><Plus size={15} aria-hidden /> Add</button>
      </form>
      <p className="muted small">"Karim" finds "Karim Haddad"; add the last name too if you know several Karims.</p>

      {list.length > 0 ? (
        <ul className="tg-people" aria-label="People you follow">
          {list.map((p) => (
            <li key={p} className="tg-person">
              <UserRound size={14} aria-hidden /> {p}
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => setList((l) => l.filter((x) => x !== p))} aria-label={`Stop following ${p}`}><X size={14} aria-hidden /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tg-people-empty">No one chosen yet: your 30 most recent chats are followed.</p>
      )}

      {suggestions.length > 0 && (
        <div className="tg-people-suggest">
          <p className="field-label">From your recent chats</p>
          <div className="tg-people-chips">
            {suggestions.map((c) => (
              <button key={c.id} type="button" className="btn btn-ghost btn-sm" onClick={() => add(c.title)}><Plus size={13} aria-hidden /> {c.title}</button>
            ))}
          </div>
        </div>
      )}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </Modal>
  );
}
