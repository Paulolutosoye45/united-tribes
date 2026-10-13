import type { Params } from "./types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : value == null ? fallback : String(value));
export const num = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};
export const list = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => str(v)).filter(Boolean) : []);

export function dayName(day: number): string {
  return DAYS[((day % 7) + 7) % 7];
}

/** "20:00" → "8:00 pm" */
export function clock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

/** "2027-02-17" → "Wed 17 Feb". Read as a plain calendar date, whatever the server's time zone. */
export function shortDay(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAYS[d.getUTCDay()].slice(0, 3)} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** "Alade, Bola and Chi" */
export function names(values: string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/** Keeps a value fit for a WhatsApp variable: one line, no runs of spaces, never empty. */
export function flat(value: unknown, fallback = "-"): string {
  const text = str(value).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return text.length > 0 ? text : fallback;
}

/** When and how a tribe meets, in a phrase: "Wednesdays at 8:00 pm, online". */
export function meetsText(p: Params): string {
  const when = `${dayName(num(p.meeting_day))}s at ${clock(str(p.meeting_time))}`;
  const place = str(p.mode) === "online" ? "online" : `in person${str(p.place_note) ? ` (${str(p.place_note)})` : ""}`;
  return `${when}, ${place}`;
}

/** Cuts a text for a text message without breaking a link in half. */
export function clip(text: string, max = 306): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.6 ? space : cut.length).trimEnd()}…`;
}

/** A text message: the sentence, then the link, clipped so the link survives. */
export function smsLine(message: string, link?: string, max = 306): string {
  if (!link) return clip(message, max);
  const room = max - link.length - 1;
  return `${clip(message, Math.max(room, 40))} ${link}`;
}
