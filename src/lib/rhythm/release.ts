import { lagosWhen } from "@/lib/seat/seat";
import type { ReleaseView, TribeWeek } from "./types";

// The weekly release as the leader's page and the admin card say it. The reader takes whatever the database sent and gives back something safe to show.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type ReleaseSettings = { weekly: boolean; hour: number; minute: number; canEdit: boolean; changedAt: string | null; changedBy: string | null };

export function parseReleaseSettings(v: unknown): ReleaseSettings | null {
  if (!isObj(v) || typeof v.weekly !== "boolean") return null;
  const hour = typeof v.hour === "number" && Number.isInteger(v.hour) && v.hour >= 0 && v.hour <= 23 ? v.hour : 8;
  const minute = typeof v.minute === "number" && [0, 15, 30, 45].includes(v.minute) ? v.minute : 0;
  return {
    weekly: v.weekly,
    hour,
    minute,
    canEdit: v.can_edit === true,
    changedAt: typeof v.changed_at === "string" ? v.changed_at : null,
    changedBy: typeof v.changed_by === "string" && v.changed_by.trim() !== "" ? v.changed_by : null,
  };
}

export const RELEASE_MINUTES = [0, 15, 30, 45] as const;

/** The two numbers the form sends, checked before the database is asked (the database checks again). */
export function checkRelease(i: { weekly: boolean; hour: string; minute: string }): { ok: true; value: { weekly: boolean; hour: number; minute: number } } | { ok: false; message: string } {
  if (!/^\d{1,2}$/.test(i.hour.trim()) || Number(i.hour) > 23) return { ok: false, message: "The hour is a whole number from 0 to 23." };
  if (!/^\d{1,2}$/.test(i.minute.trim()) || !RELEASE_MINUTES.includes(Number(i.minute) as 0 | 15 | 30 | 45)) return { ok: false, message: "Choose 00, 15, 30 or 45 minutes past the hour." };
  return { ok: true, value: { weekly: i.weekly, hour: Number(i.hour), minute: Number(i.minute) } };
}

/** "8 am" or "5:30 pm", the way the pages say a time. */
export function clockWords(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${minute > 0 ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "am" : "pm"}`;
}

export const RELEASE_WORDS = {
  title: "When leaders can read the next week",
  intro:
    "Each week's guide can open for leaders on the Saturday before it starts, instead of all twelve being open from the first day. Week 1 is open from the start. Pastors and directors can always read every week, so the guides can be read through before they open.",
  label: "Open next week's guide for leaders on the Saturday before it starts",
  at: "At this time (Lagos)",
  offHelp: "Off: a leader can open any week.",
  onHelp: (hour: number, minute: number) => `On: the day before each week starts, at ${clockWords(hour, minute)}, Lagos time. Before then a leader reads this week and the weeks already open, and a later week says when it opens.`,
  saved: "Saved.",
  save: "Save",
  lastChange: (by: string | null, at: string) => `Last changed ${lagosWhen(at)}${by ? ` by ${by}` : ""}.`,
  unavailable: "This setting is not available yet. The database file for it has not been applied.",
  /** What a leader reads in place of a week that has not opened. */
  closedTitle: (week: number) => `Week ${week} has not opened yet`,
  closedBody: (week: number, when: string | null) =>
    `${when ? `Week ${week} opens on ${when}.` : `Week ${week} is not open yet.`} Until then, this week's guide has everything you need for your meeting.`,
  /** The short note under this week's guide. */
  nextOpens: (when: string) => `Next week's guide opens on ${when}.`,
};

/** The line a leader reads under the weeks, or null when nothing is waiting to open. */
export function nextOpensLine(week: Pick<TribeWeek, "release">): string | null {
  const r: ReleaseView | null | undefined = week.release;
  if (!r || !r.weekly || !r.next_opens_at) return null;
  const when = lagosWhen(r.next_opens_at);
  return when ? RELEASE_WORDS.nextOpens(when) : null;
}
