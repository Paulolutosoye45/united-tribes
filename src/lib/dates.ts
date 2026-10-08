const DAY = 24 * 60 * 60 * 1000;

function utcMidnight(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Whole days from `now` until a calendar date like "2027-02-14". Negative once past. */
export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - utcMidnight(now)) / DAY);
}

// Dates are written by hand from numbers, never by the browser's or server's locale tables.
// Node and Chrome ship different ICU versions ("Mon 12 Oct" on one, "Mon, 12 Oct" on the other),
// and a difference of one comma breaks hydration.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const short = (month: number) => MONTHS[month].slice(0, 3);

type Wall = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

/** The wall-clock numbers for a moment in a given time zone. `month` counts from 0. */
function wall(date: Date, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = get("year");
  const month = get("month") - 1;
  const day = get("day");
  return { year, month, day, hour: get("hour") % 24, minute: get("minute"), weekday: new Date(Date.UTC(year, month, day)).getUTCDay() };
}

/** "14 February 2027", the same on every server regardless of time zone. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "8 Oct 2026", read in UTC. */
export function formatShortDate(value: string): string {
  const w = wall(new Date(value), "UTC");
  return `${w.day} ${short(w.month)} ${w.year}`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

const LAGOS = "Africa/Lagos";

/** “Mon 9 Nov”, in Lagos time, whatever the server’s time zone. */
export function formatLagosDay(iso: string): string {
  const w = wall(new Date(iso), LAGOS);
  return `${WEEKDAYS[w.weekday]} ${w.day} ${short(w.month)}`;
}

/** “4:00 pm”, in Lagos time. */
export function formatLagosTime(iso: string): string {
  const w = wall(new Date(iso), LAGOS);
  const hour = w.hour % 12 === 0 ? 12 : w.hour % 12;
  return `${hour}:${String(w.minute).padStart(2, "0")} ${w.hour < 12 ? "am" : "pm"}`;
}

/** The calendar day in Lagos, like “2026-11-09”, for grouping times by day. */
export function lagosDateKey(iso: string): string {
  const w = wall(new Date(iso), LAGOS);
  return `${w.year}-${String(w.month + 1).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}
