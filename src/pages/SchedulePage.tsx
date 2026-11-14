import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Views, dayjsLocalizer, type EventProps, type View } from "react-big-calendar";
import dayjs from "dayjs";
import "dayjs/locale/en-gb"; // weeks start on Monday
import "react-big-calendar/lib/css/react-big-calendar.css";
import {
  AlertTriangle, ArrowRight, CalendarCheck2, CalendarDays, CheckCircle2, Clock, ExternalLink, Info, Loader2, Mail, MapPin, RefreshCw, Reply, ShieldCheck, Users, X,
} from "lucide-react";
import { api, type ScheduleItem, type ScheduleSyncResult } from "../lib/api";
import { Callout } from "../components/ui";
import { PageSkeleton } from "../components/Skeletons";
import { useViewer } from "../components/EmailViewer";
import { useReply } from "../components/ReplyModal";

dayjs.locale("en-gb");
const localizer = dayjsLocalizer(dayjs);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

type CalEvent = { id: string; title: string; start: Date; end: Date; allDay?: boolean; item: ScheduleItem };

const KIND = {
  reply: { label: "Reply", icon: Reply },
  "follow-up": { label: "Follow-up", icon: Clock },
  meeting: { label: "Meeting", icon: Users },
  deadline: { label: "Deadline", icon: CalendarCheck2 },
} as const;
const PRIORITY = { high: "Urgent", medium: "Normal", low: "Low" } as const;

const when = (item: ScheduleItem) => {
  const s = new Date(item.start), e = new Date(item.end);
  const day = s.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  if (item.allDay) return `${day}, all day`;
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${t(s)}–${t(e)}`;
};
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function EventChip({ event }: EventProps<CalEvent>) {
  const Icon = KIND[event.item.kind].icon;
  return (
    <span className="cal-chip">
      <Icon size={12} aria-hidden />
      <span className="cal-chip-title">{event.title}</span>
    </span>
  );
}

/** The selected item: what it is, why it's on the schedule, and what to do. */
function Details({ item, onClose }: { item: ScheduleItem; onClose: () => void }) {
  const Icon = KIND[item.kind].icon;
  return (
    <section className="cal-details surface" role="region" aria-label={item.title}>
      <header className="cal-details-head">
        <span className="cal-details-icon" data-kind={item.kind} data-priority={item.priority}><Icon size={18} aria-hidden /></span>
        <div>
          <span className="cal-details-kind">
            {KIND[item.kind].label}{item.priority && item.kind === "reply" ? ` · ${PRIORITY[item.priority]}` : ""}{item.overdue ? " · Overdue" : ""}
          </span>
          <h2>{item.title}</h2>
          <p className="muted small">{when(item)}</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose}><X size={18} aria-hidden /></button>
      </header>
      <p className="cal-why"><Info size={14} aria-hidden /><span>{item.why}</span></p>
      {item.summary && <p className="cal-summary"><span className="muted small">About</span>{item.summary}</p>}
      {item.suggestedAction && <p className="cal-summary"><span className="muted small">Next step</span>{item.suggestedAction}</p>}
      {item.location && <p className="cal-meta"><MapPin size={14} aria-hidden /> {item.location}</p>}
      <div className="cal-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => useViewer.getState().open(item.threadId)}><Mail size={14} aria-hidden /> Read the email</button>
        {item.kind !== "meeting" && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => useReply.getState().open(item.threadId, item.contact ?? "")}><Reply size={14} aria-hidden /> Write a reply</button>
        )}
        {item.link && <a className="btn btn-ghost btn-sm" href={item.link} target="_blank" rel="noreferrer">Open in Gmail <ExternalLink size={13} aria-hidden /></a>}
      </div>
    </section>
  );
}

/** Asks before anything is written to Google, and says exactly what will happen. */
function SyncConfirm({ count, calendarName, busy, onConfirm, onCancel }: { count: number; calendarName: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="cal-confirm surface" role="alertdialog" aria-label="Sync to Google Calendar?" aria-describedby="cal-confirm-text">
      <strong>Sync to Google Calendar?</strong>
      <p id="cal-confirm-text" className="muted">
        This adds or updates {count} events in a separate calendar called "{calendarName}" in your Google Calendar. Your other calendars aren't touched.
        Items that left this schedule are removed from that calendar. You can hide or delete it in Google Calendar any time.
      </p>
      <div className="cal-confirm-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button ref={confirmRef} type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />} Sync now
        </button>
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["schedule", TZ], queryFn: () => api.schedule(TZ), refetchInterval: 60_000 });
  const [view, setView] = useState<View>(() => (window.matchMedia?.("(max-width: 760px)").matches ? Views.AGENDA : Views.WEEK));
  const [date, setDate] = useState(() => new Date());
  const [selected, setSelected] = useState<ScheduleItem | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ScheduleSyncResult | null>(null);
  const sync = useMutation({
    mutationFn: () => api.syncSchedule(TZ),
    onSuccess: (r) => { setResult(r); setConfirming(false); void qc.invalidateQueries({ queryKey: ["schedule"] }); },
  });

  const events = useMemo<CalEvent[]>(() => (data?.items ?? []).map((item) => ({ id: item.id, title: item.title, start: new Date(item.start), end: new Date(item.end), allDay: item.allDay, item })), [data]);
  const stats = useMemo(() => {
    const now = new Date();
    const items = data?.items ?? [];
    const weekEnd = dayjs(now).endOf("week").toDate();
    return {
      today: items.filter((i) => sameDay(new Date(i.start), now)).length,
      overdue: items.filter((i) => i.overdue).length,
      week: items.filter((i) => new Date(i.start) >= now && new Date(i.start) <= weekEnd).length,
      meetings: items.filter((i) => i.kind === "meeting" && new Date(i.start) >= now).length,
    };
  }, [data]);
  const eventProps = useCallback((e: CalEvent) => ({
    className: `cal-event cal-${e.item.kind}${e.item.priority ? ` cal-p-${e.item.priority}` : ""}${e.item.overdue ? " cal-overdue" : ""}`,
  }), []);
  const onSelect = useCallback((e: CalEvent) => setSelected(e.item), []);

  if (isLoading) return <PageSkeleton kind="data" />;
  if (error) return <div className="page"><Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load your schedule" text={(error as Error).message} /></div>;
  if (!data?.connected)
    return (
      <div className="page">
        <header className="page-head"><div><h1 className="page-title">Schedule</h1><p className="page-sub">Your week, planned from your email.</p></div></header>
        <div className="surface empty">
          <div className="empty-icon"><CalendarDays size={24} /></div>
          <h2 className="empty-title">Connect Gmail to see your schedule</h2>
          <p className="empty-text">We'll turn your email into a plan: replies by urgency, follow-ups, meetings and deadlines.</p>
          <div className="empty-actions"><a className="btn btn-primary btn-lg" href="#/integrations">Connect Gmail <ArrowRight size={16} /></a></div>
        </div>
      </div>
    );

  const cal = data.calendar;
  return (
    <div className="page page-wide schedule-page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Schedule</h1>
          <p className="page-sub">Your week, planned from your email. Urgent replies 2 hours after they arrive, normal ones the next working morning.</p>
        </div>
        <div className="head-actions cal-head-actions">
          {cal?.canSync ? (
            <button type="button" className="btn btn-primary" onClick={() => { setResult(null); setConfirming(true); }} disabled={data.sample || !data.items.length || sync.isPending}
              title={data.sample ? "Sample data can't be synced" : undefined}>
              <RefreshCw size={15} aria-hidden /> Sync to Google Calendar
            </button>
          ) : (
            <a className="btn btn-primary" href="/api/auth/google/start?calendar=1"><CalendarDays size={15} aria-hidden /> Allow calendar access</a>
          )}
        </div>
      </header>

      {confirming && cal && <SyncConfirm count={data.items.length} calendarName={cal.name} busy={sync.isPending} onConfirm={() => sync.mutate()} onCancel={() => setConfirming(false)} />}
      {sync.error && <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Couldn't sync" text={(sync.error as Error).message} />}
      {result && (
        <Callout tone="ok" icon={<CheckCircle2 size={18} />} title={`Synced to "${result.calendarName}"`}
          text={`${result.created} added, ${result.updated} updated, ${result.removed} removed, ${result.unchanged} unchanged${result.failed ? `, ${result.failed} failed` : ""}.`} />
      )}
      {data.sample && <Callout icon={<Info size={18} />} title="This is sample data" text="The schedule shows how it works, but sample data can't be synced to Google Calendar. Connect your Gmail to sync." />}
      {!data.sample && !cal?.canSync && (
        <p className="cal-note"><ShieldCheck size={14} aria-hidden /> Calendar access lets the app create one calendar of its own, "{cal?.name}". It can't see or change your other calendars.</p>
      )}
      {cal?.lastSyncAt && !result && <p className="cal-note"><CheckCircle2 size={14} aria-hidden /> Last synced {new Date(cal.lastSyncAt).toLocaleString()} · {cal.syncedCount} events in "{cal.name}"</p>}

      <ul className="cal-stats" aria-label="Schedule summary">
        <li><strong className="num">{stats.today}</strong><span>Today</span></li>
        <li data-tone={stats.overdue ? "warn" : undefined}><strong className="num">{stats.overdue}</strong><span>Overdue</span></li>
        <li><strong className="num">{stats.week}</strong><span>Rest of this week</span></li>
        <li><strong className="num">{stats.meetings}</strong><span>Meetings ahead</span></li>
      </ul>

      <div className="cal-layout" data-has-details={Boolean(selected) || undefined}>
        <div className="cal-wrap surface">
          <Calendar<CalEvent>
            localizer={localizer}
            events={events}
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
            min={new Date(1970, 0, 1, 8)}
            max={new Date(1970, 0, 1, 20)}
            scrollToTime={new Date(1970, 0, 1, 8)}
            step={30}
            timeslots={2}
            popup
            eventPropGetter={eventProps}
            components={{ event: EventChip }}
            onSelectEvent={onSelect}
            selected={selected ? events.find((e) => e.id === selected.id) : undefined}
            messages={{ today: "Today", previous: "Back", next: "Next", agenda: "List", noEventsInRange: "Nothing scheduled in this period." }}
          />
        </div>
        {selected && <Details item={selected} onClose={() => setSelected(null)} />}
      </div>

      <ul className="cal-legend" aria-label="Colour key">
        <li><span className="cal-swatch cal-p-high" aria-hidden /> Urgent reply</li>
        <li><span className="cal-swatch cal-p-medium" aria-hidden /> Reply</li>
        <li><span className="cal-swatch cal-follow-up" aria-hidden /> Follow-up</li>
        <li><span className="cal-swatch cal-meeting" aria-hidden /> Meeting</li>
        <li><span className="cal-swatch cal-deadline" aria-hidden /> Deadline</li>
      </ul>
      <p className="cal-note"><Info size={14} aria-hidden /> Built from {data.analysis?.analysed ?? 0} conversations sorted by AI. Times are suggestions in working hours (Mon–Fri, 9:00–18:00); meetings and deadlines read from email text can be wrong, so check them.</p>
    </div>
  );
}
