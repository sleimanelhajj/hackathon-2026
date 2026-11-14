import { memo, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Folder, FolderOpen, Info, Reply, Search } from "lucide-react";
import { categoryInfo } from "../../shared/spec.js";
import { timeAgo, type Contact, type Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";
import { useReply } from "../components/ReplyModal";

type Props = { widget: Extract<Widget, { type: "contacts" }> };

/** One folder per person you've emailed with. "New" is counted from Gmail dates; "Lead" is an AI guess. */
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
          {contacts.length} people{newCount ? `, ${newCount} new` : ""}. New = first email with you in the last 7 days, outside your company.
          “Lead” is an AI guess. Automated senders are left out.
        </span>
      </p>
    </div>
  );
});

function ContactFolder({ c, open, onToggle }: { c: Contact; open: boolean; onToggle: () => void }) {
  const openReply = useReply((s) => s.open);
  const panelId = `folder-${c.email.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <li className="folder" data-open={open}>
      <button className="folder-head" onClick={onToggle} aria-expanded={open} aria-controls={panelId}>
        <ChevronRight size={14} className="folder-chevron" aria-hidden />
        {open ? <FolderOpen size={16} className="folder-icon" aria-hidden /> : <Folder size={16} className="folder-icon" aria-hidden />}
        <span className="folder-name">
          <span className="folder-title" title={c.name}>{c.name}</span>
          <span className="folder-sub" title={c.email}>{c.email}</span>
        </span>
        <span className="folder-tags">
          {c.isNew && <span className="tag tag-sm" data-tone="ok" title={`First email with you: ${new Date(c.firstAt).toLocaleDateString()}`}>New</span>}
          {c.aiLead && <span className="tag tag-sm" data-tone="inferred" title="AI guess: one of their conversations looks like a potential lead">Lead</span>}
          {c.isInternal && <span className="tag tag-sm">Team</span>}
          {c.needsReply > 0 && <span className="tag tag-sm" data-tone="accent">{c.needsReply} to reply</span>}
        </span>
        <span className="folder-count num" aria-label={`${c.threadCount} conversations`}>{c.threadCount}</span>
      </button>
      {open && (
        <div id={panelId} className="folder-body">
          <p className="folder-stats muted small">
            {c.received} received · {c.sent} sent · last email {timeAgo(c.lastAt)}
          </p>
          <ul className="folder-threads">
            {c.threads.map((t) => (
              <li key={t.threadId} className="folder-thread">
                <div className="folder-thread-main">
                  <p className="thread-subject" title={t.subject}>{t.subject}</p>
                  <p className="folder-thread-meta">
                    {t.category && <span className="tag tag-sm" title="AI guess">{categoryInfo(t.category).title}</span>}
                    {t.priority === "high" && <span className="tag tag-sm" data-tone="warn">High</span>}
                    <span className="muted small num">{timeAgo(t.lastAt)}</span>
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => openReply(t.threadId, c.name)} aria-label={`Reply to ${c.name} about ${t.subject}`}>
                  <Reply size={13} aria-hidden />
                </button>
                {t.link && (
                  <a className="btn btn-ghost btn-sm" href={t.link} target="_blank" rel="noreferrer" aria-label={`Open “${t.subject}” in Gmail`}>
                    <ExternalLink size={13} aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
          {c.threadCount > c.threads.length && (
            <a className="folder-more" href={`#/data?from=${encodeURIComponent(c.email)}`}>See all {c.threadCount} conversations in Email data</a>
          )}
        </div>
      )}
    </li>
  );
}
