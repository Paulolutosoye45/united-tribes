import type { Cell, Decision, Metric } from "./types";

// How numbers are written on the dashboard. Written by hand, never by a locale table, so the server and the browser agree.

export const HIDDEN = "<5" as const;
export const HIDDEN_NOTE = "“<5” means fewer than 5 people, so the number is not shown.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const WEEKDAY_NAMES = WEEKDAYS;

/** The groups the dashboard counts, as a plural. Young members are only ever counted, never named. */
export const GROUP_PLURAL: Record<string, string> = {
  member: "Members",
  young: "Young members",
  leader: "Leaders",
  team: "Admin and care team",
  pastoral: "Pastors and director",
};
export const GROUP_ORDER = ["member", "young", "leader", "team", "pastoral"] as const;

export const isHidden = (v: unknown): v is typeof HIDDEN => v === HIDDEN;

/** 12345 as "12,345". */
export function num(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10) / 10;
  const [whole, frac] = Math.abs(rounded).toString().split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "−" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** A people-count, or "<5" when the database has hidden it. */
export function show(v: Cell | null | undefined, empty = "–"): string {
  if (v === null || v === undefined) return empty;
  return v === HIDDEN ? HIDDEN : num(v);
}

/** The same, for a sentence: "fewer than 5". */
export function showWords(v: Cell | null | undefined, empty = "none recorded"): string {
  if (v === null || v === undefined) return empty;
  return v === HIDDEN ? "fewer than 5" : num(v);
}

export function pctText(v: number | null | undefined, empty = "–"): string {
  return v === null || v === undefined ? empty : `${num(v)}%`;
}

/** "5 Oct" for a calendar date like "2026-10-05". */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}`;
}

/** "5 Oct 2026". */
export function longDay(iso: string): string {
  const [y] = iso.split("-");
  return `${shortDay(iso)} ${y}`;
}

/** A length of time in hours, in the unit a person would say: minutes, hours or days. */
export function hoursText(h: number | null | undefined, empty = "–"): string {
  if (h === null || h === undefined) return empty;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${num(Math.round(h * 10) / 10)} h`;
  return `${num(Math.round((h / 24) * 10) / 10)} days`;
}

export function secondsText(s: number | null | undefined, empty = "–"): string {
  if (s === null || s === undefined) return empty;
  if (s < 90) return `${num(s)} s`;
  const m = s / 60;
  return `${num(Math.round(m * 10) / 10)} min`;
}

/** "17:00" for an hour of the day. */
export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** How a stakeholder-panel number is written, by its unit. */
export function metricText(m: Pick<Metric, "value" | "unit">): string {
  const v = m.value;
  if (v === null || v === undefined) return "not enough yet";
  if (v === HIDDEN) return HIDDEN;
  switch (m.unit) {
    case "percent":
      return `${num(v)}%`;
    case "seconds":
      return secondsText(v);
    case "ms":
      return v >= 1000 ? `${num(Math.round(v / 100) / 10)} s` : `${num(v)} ms`;
    case "minutes":
      return `${num(v)} min`;
    case "hours":
      return hoursText(v);
    case "days":
      return `${num(v)} days`;
    case "hour":
      return hourLabel(v);
    default:
      return num(v);
  }
}

export type Move = { text: string; dir: "up" | "down" | "same" | "none" };

/** How a number moved from the period before: "up 5 from 37". Nothing is claimed when the earlier number is hidden. */
export function moved(now: Cell | null | undefined, prev: Cell | null | undefined): Move {
  if (typeof now !== "number" || typeof prev !== "number") return { text: "", dir: "none" };
  if (now === prev) return { text: `same as before (${num(prev)})`, dir: "same" };
  const diff = now - prev;
  return { text: `${diff > 0 ? "up" : "down"} ${num(Math.abs(diff))} from ${num(prev)}`, dir: diff > 0 ? "up" : "down" };
}

/** A decision as one line: what is flagged, and how many. */
export function decisionLine(d: Pick<Decision, "label" | "value" | "unit">): string {
  const value = d.value === null || d.value === undefined ? "" : d.unit === "percent" ? `${num(d.value)}%` : num(d.value);
  return value ? `${d.label}: ${value}` : d.label;
}

const DAYS_IN_MS = 86_400_000;

/** The date for each of the days a trend covers, as written on an axis. */
export function axisDays(days: string[]): string[] {
  return days.map(shortDay);
}

/** Whole days from one calendar date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAYS_IN_MS);
}

/** Today's date in Lagos (one hour ahead of UTC all year), as "2026-10-15". Pass the clock in, so a page reads it once. */
export function lagosToday(nowMs: number): string {
  return new Date(nowMs + 3_600_000).toISOString().slice(0, 10);
}

/** A calendar date a number of days later (or earlier, when negative). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAYS_IN_MS).toISOString().slice(0, 10);
}

/** True for a real calendar date written as "2026-10-15". */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}
