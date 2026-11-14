import { memo, useMemo, useState } from "react";
import { ChevronRight, Info, Reply, Search } from "lucide-react";
import { categoryInfo } from "../../shared/spec.js";
import { timeAgo, type Contact, type Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";
import { useReply } from "../components/ReplyModal";
import { useViewer } from "../components/EmailViewer";

type Props = { widget: Extract<Widget, { type: "contacts" }> };

/** One folder per person you have emailed with: who they are, how much mail, what needs a reply. */
export const ContactsWidget = memo(function ContactsWidget({ widget }: Props) {
  const { contacts } = useDashboardData();
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts
      .filter((c) => widget.show === "all" || c.isNew)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.includes(q) || c.domain.includes(q));
  }, [contacts, widget.show, query]);
  const newCount = contacts.filter((c) => c.isNew).length;

  if (!contacts.length) return <div className="widget-empty"><p>No conversations with people yet.</p></div>;

  return (
    <div className="thread-widget">
      {contacts.length > 6 && (
        <label className="search search-sm">
          <Search size={14} aria-hidden />
          <span className="sr-only">Find a contact</span>
          <input type="search" placeholder="Find a contact" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {shown.length ? (
        <ul className="folders">
          {shown.map((c) => (
            <ContactFolder key={c.email} c={c} open={open === c.email} onToggle={() => setOpen(open === c.email ? null : c.email)} />
          ))}
        </ul>
      ) : (
        <div className="widget-empty"><p>{widget.show === "new" ? "No new contacts this week." : `No contact matches “${query}”.`}</p></div>
      )}
      <p className="howto">
        <Info size={13} aria-hidden />
        <span>
          {contacts.length} people{newCount ? `, ${newCount} new` : ""}. "New contact" means they first emailed you in the last 7 days. Automated senders are left out.
        </span>
      </p>
    </div>
  );
});

const initials = (name: string) =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function ContactFolder({ c, open, onToggle }: { c: Contact; open: boolean; onToggle: () => void }) {
  const openReply = useReply((s) => s.open);
  const openViewer = useViewer((s) => s.open);
  const panelId = `folder-${c.email.replace(/[^a-z0-9]/gi, "-")}`;
  const total = c.received + c.sent;
  return (
    <li className="person-folder" data-open={open}>
      <button className="person-head" onClick={onToggle} aria-expanded={open} aria-controls={panelId}>
        <span className="person-avatar" aria-hidden>{initials(c.name)}</span>
        <span className="person-text">
          <span className="person-line">
            <span className="person-title" title={c.email}>{c.name}</span>
            {c.isNew && <span className="tag tag-sm" data-tone="ok" title={`First email with you: ${new Date(c.firstAt).toLocaleDateString()}`}>New contact</span>}
            {c.isInternal && <span className="tag tag-sm">Your team</span>}
          </span>
          <span className="person-sub">
            {plural(total, "email")}
            {c.needsReply > 0 && <> · <strong className="person-reply">{c.needsReply} to reply</strong></>}
            {" · "}last email {timeAgo(c.lastAt)}
          </span>
        </span>
        <ChevronRight size={16} className="folder-chevron person-chevron" aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="person-body">
          <p className="person-email muted small">{c.email}</p>
          <ul className="person-threads">
            {c.threads.map((t) => (
              <li key={t.threadId} className="person-thread">
                <button className="person-thread-main" onClick={() => openViewer(t.threadId)} aria-label={`Open conversation: ${t.subject}`}>
                  <span className="person-thread-subject">{t.subject}</span>
                  <span className="person-thread-meta">
                    {t.category && <span>{categoryInfo(t.category).title}</span>}
                    {t.needsReply && <span className="person-reply">Needs reply</span>}
                    <span className="num">{timeAgo(t.lastAt)}</span>
                  </span>
                </button>
                <button className="icon-btn" onClick={() => openReply(t.threadId, c.name)} aria-label={`Reply to ${c.name} about ${t.subject}`} title="Reply">
                  <Reply size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {c.threadCount > c.threads.length && (
            <a className="folder-more" href={`#/data?from=${encodeURIComponent(c.email)}`}>See all {c.threadCount} conversations with {c.name.split(" ")[0]}</a>
          )}
        </div>
      )}
    </li>
  );
}
