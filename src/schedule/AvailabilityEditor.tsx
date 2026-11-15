import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CalendarPlus, Loader2, Mail, Plus, Save, Trash2, X } from "lucide-react";
import { api, type Availability, type Weekday } from "../lib/api";
import { availabilityProblems, DAY_NAMES, WEEKDAYS } from "./availability";
import { Modal } from "../components/Modal";
import { confirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";
import { errorMessage } from "../lib/errors";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
type Ranges = [string, string][];
type DateRow = { date: string; ranges: Ranges };

/** Two time inputs per slot, with a remove button. */
function SlotList({ label, ranges, onChange }: { label: string; ranges: Ranges; onChange: (next: Ranges) => void }) {
  const set = (i: number, j: 0 | 1, value: string) => onChange(ranges.map((r, k) => (k === i ? (j === 0 ? [value, r[1]] : [r[0], value]) : r)));
  return (
    <ul className="avail-slots">
      {ranges.map(([a, b], i) => (
        <li key={i} className="avail-slot">
          <input type="time" step={900} className="input input-time" aria-label={`${label}, slot ${i + 1}, from`} value={a} onChange={(e) => set(i, 0, e.target.value)} />
          <span aria-hidden>–</span>
          <input type="time" step={900} className="input input-time" aria-label={`${label}, slot ${i + 1}, until`} value={b} onChange={(e) => set(i, 1, e.target.value)} />
          <button type="button" className="icon-btn" aria-label={`Remove ${label} slot ${i + 1}`} onClick={() => onChange(ranges.filter((_, k) => k !== i))}>
            <X size={15} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A new slot after the last one (or 9:00–17:00), so adding a second slot doesn't start out overlapping. */
const nextSlot = (ranges: Ranges): [string, string] => {
  const last = ranges.at(-1)?.[1];
  if (!last || last >= "22:00") return ["09:00", "17:00"];
  const [h, m] = last.split(":").map(Number);
  const start = `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const end = `${String(Math.min(h + 3, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return [start, end];
};

/**
 * The user's availability: weekly hours per day, plus changes for specific dates. Meeting requests are judged against
 * it (decision #55), and reply tasks are planned inside it.
 */
export function AvailabilityEditor({ initial, firstTime, onClose }: { initial: Availability; firstTime: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [weekly, setWeekly] = useState<Record<Weekday, Ranges>>(() => structuredClone(initial.weekly));
  const [dates, setDates] = useState<DateRow[]>(() => Object.entries(initial.dates).sort(([a], [b]) => a.localeCompare(b)).map(([date, ranges]) => ({ date, ranges })));
  const [problems, setProblems] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: (a: Availability) => api.saveAvailability(a, TZ),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["schedule"] }); onClose(); },
  });

  const submit = () => {
    const found: string[] = [];
    dates.forEach((row, i) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) found.push(`Change ${i + 1}: pick a date.`); });
    const keys = dates.map((r) => r.date);
    if (new Set(keys).size !== keys.length) found.push("Each date can only have one change.");
    const availability: Availability = { weekly, dates: Object.fromEntries(dates.map((r) => [r.date, r.ranges])) };
    found.push(...availabilityProblems(availability));
    setProblems(found);
    if (found.length) return;
    void (async () => {
      // The first save switches on automatic availability replies, which send real email: say so and ask.
      if (firstTime && !(await confirm({
        title: "Turn on automatic meeting replies?",
        message: "From now on, a meeting request for a time that has passed, or that clashes with your calendar, gets an automatic email with your free times. Requests outside your hours wait for you.",
        confirmLabel: "Save and turn on",
        icon: <Mail size={18} />,
      }))) return;
      save.mutate(availability, { onSuccess: () => toast.success("Availability saved", "Meeting requests are now checked against these hours.") });
    })();
  };

  const setDay = (d: Weekday, ranges: Ranges) => setWeekly((w) => ({ ...w, [d]: ranges }));
  const setDate = (i: number, row: Partial<DateRow>) => setDates((list) => list.map((r, k) => (k === i ? { ...r, ...row } : r)));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      className="avail-modal"
      icon={<CalendarClock size={18} />}
      title="Your availability"
      description={<>{firstTime ? "Once saved, meeting requests from now on are checked against these hours." : "Meeting requests are checked against these hours."} Times are in your time zone ({TZ}).</>}
      dismissible={!save.isPending}
      footer={<>
        <span className="muted small">Reply tasks are planned inside these hours too.</span>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={save.isPending}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={save.isPending}>
          {save.isPending ? <Loader2 size={15} className="spin" aria-hidden /> : <Save size={15} aria-hidden />} Save availability
        </button>
      </>}
    >
        <ul className="avail-rules" aria-label="What happens to a meeting request">
          <li><strong>Inside your hours and free</strong> goes on your calendar.</li>
          <li><strong>Outside your hours</strong> waits for you to accept or decline.</li>
          <li><strong>Time already passed, or clashes</strong> gets an automatic reply with your free times.</li>
        </ul>

        <section className="avail-section" aria-labelledby="avail-week">
          <h3 id="avail-week" className="avail-heading">Every week</h3>
          <ul className="avail-week">
            {WEEKDAYS.map((d) => {
              const on = weekly[d].length > 0;
              return (
                <li key={d} className="avail-day" data-off={!on || undefined}>
                  <button type="button" role="switch" aria-checked={on} aria-label={DAY_NAMES[d]} className="switch avail-switch"
                    onClick={() => setDay(d, on ? [] : [["09:00", "17:00"]])}>
                    <span className="switch-track" aria-hidden><span className="switch-thumb" /></span>
                    <span className="switch-label">{DAY_NAMES[d]}</span>
                  </button>
                  {on ? (
                    <div className="avail-day-slots">
                      <SlotList label={DAY_NAMES[d]} ranges={weekly[d]} onChange={(r) => setDay(d, r)} />
                      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Add a time on ${DAY_NAMES[d]}`} onClick={() => setDay(d, [...weekly[d], nextSlot(weekly[d])])}>
                        <Plus size={14} aria-hidden /> Add time
                      </button>
                    </div>
                  ) : <span className="muted small">Not available</span>}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="avail-section" aria-labelledby="avail-dates">
          <h3 id="avail-dates" className="avail-heading">Changes for specific dates</h3>
          <p className="muted small">A day off, or different hours on one date. They replace that day's weekly hours.</p>
          {dates.length > 0 && (
            <ul className="avail-dates">
              {dates.map((row, i) => (
                <li key={i} className="avail-date">
                  <input type="date" className="input input-date" aria-label={`Date ${i + 1}`} value={row.date} onChange={(e) => setDate(i, { date: e.target.value })} />
                  <div className="avail-day-slots">
                    {row.ranges.length ? <SlotList label={`Date ${i + 1}`} ranges={row.ranges} onChange={(r) => setDate(i, { ranges: r })} /> : <span className="avail-off-tag">Day off</span>}
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Add a time on date ${i + 1}`} onClick={() => setDate(i, { ranges: [...row.ranges, nextSlot(row.ranges)] })}>
                      <Plus size={14} aria-hidden /> {row.ranges.length ? "Add time" : "Set hours instead"}
                    </button>
                  </div>
                  <button type="button" className="icon-btn" aria-label={`Remove date ${i + 1}`} onClick={() => setDates((list) => list.filter((_, k) => k !== i))}>
                    <Trash2 size={15} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-secondary btn-sm avail-add-date" onClick={() => setDates((list) => [...list, { date: "", ranges: [] }])}>
            <CalendarPlus size={14} aria-hidden /> Add a date
          </button>
        </section>

        {problems.length > 0 || save.error ? (
          <div className="ui-modal-error avail-problems" role="alert">
            <AlertTriangle size={15} aria-hidden />
            <div>{problems.length ? problems.map((p) => <p key={p}>{p}</p>) : <p>{errorMessage(save.error)}</p>}</div>
          </div>
        ) : null}
    </Modal>
  );
}
