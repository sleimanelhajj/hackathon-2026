// The user's availability on the client: names, and which calendar slots fall outside it (shaded on the calendar).
// The server (server/meetings.js) is what judges requests; this only draws.
import type { Availability, Weekday } from "../lib/api";

export const WEEKDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_NAMES: Record<Weekday, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const BY_INDEX: Weekday[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // Date.getDay()

const pad = (n: number) => String(n).padStart(2, "0");
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The slots for the day `d` falls on: a date change if there is one, else that weekday's hours. */
export function rangesOn(avail: Availability, d: Date): [string, string][] {
  const key = dateKey(d);
  return Object.prototype.hasOwnProperty.call(avail.dates, key) ? avail.dates[key] : avail.weekly[BY_INDEX[d.getDay()]] ?? [];
}

/** True if the calendar slot starting at `d` is outside the available hours. */
export function isOff(avail: Availability, d: Date) {
  const t = hhmm(d);
  return !rangesOn(avail, d).some(([a, b]) => a <= t && t < b);
}

/** Problems a person can fix, in plain words; empty when the availability can be saved. */
export function availabilityProblems(avail: Availability): string[] {
  const problems: string[] = [];
  const check = (label: string, ranges: [string, string][]) => {
    if (ranges.some(([a, b]) => !a || !b)) return void problems.push(`${label}: fill in both times of each slot.`);
    if (ranges.some(([a, b]) => b <= a)) return void problems.push(`${label}: a time slot must end after it starts.`);
    const sorted = [...ranges].sort((x, y) => x[0].localeCompare(y[0]));
    if (sorted.some((r, i) => i > 0 && r[0] < sorted[i - 1][1])) problems.push(`${label}: time slots can't overlap.`);
  };
  for (const d of WEEKDAYS) check(DAY_NAMES[d], avail.weekly[d]);
  if (!WEEKDAYS.some((d) => avail.weekly[d].length)) problems.push("Add at least one time you're available in the week.");
  for (const [date, ranges] of Object.entries(avail.dates)) check(date, ranges);
  return problems;
}
