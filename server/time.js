// Wall-clock time in a named time zone, without a library: Intl knows every zone. Used by the schedule and meetings.

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }));
  }
  return fmtCache.get(tz);
}
/** Wall-clock parts of `date` in `tz`: { y, m (1-12), d, h, min, dow ("Mon".."Sun") }. */
export function zonedParts(date, tz) {
  const p = Object.fromEntries(formatter(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, dow: p.weekday };
}
/** The instant when the wall clock in `tz` shows { y, m, d, h, min }. */
export function fromZoned({ y, m, d, h = 0, min = 0 }, tz) {
  const want = Date.UTC(y, m - 1, d, h, min);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz);
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - want;
    if (!diff) break;
    guess -= diff;
  }
  return new Date(guess);
}
/** "2026-11-12" for the day `date` falls on in `tz`. */
export function dayKey(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
