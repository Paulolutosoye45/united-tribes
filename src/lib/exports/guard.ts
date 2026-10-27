/**
 * Keeping a file from running anything when someone opens it. A spreadsheet program treats a cell that starts with = + - or @ as a
 * formula, and a few other first characters as the start of one (a tab or a line break, or the full-width forms of the four, which some
 * programs fold back to the ordinary ones). Nothing in these files is a formula. In Excel files every text is stored as text and a text
 * that could be mistaken for a formula is marked so it stays one even if someone edits it; in CSV files it is given a leading
 * apostrophe, which is what the spreadsheet programs ask for.
 */

/** The first characters that can start a formula: = + - @ tab, carriage return, line feed, and the full-width = + - @. */
const TRIGGER = /^[=+\-@\t\r\n＝＋－＠]/;

/** True when a text could be read as a formula, ignoring any spaces in front of it. */
export const needsGuard = (text: string): boolean => TRIGGER.test(text.trimStart());

/** Characters XML cannot hold, and the invisible marks that reorder text on screen (they can disguise what a cell says). */
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** A text as it may be written into a file: no control or direction-changing characters, and a sensible length. */
export function cleanText(value: unknown, max = 2000): string {
  const s = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  return s.replace(UNSAFE, "").slice(0, max);
}

/** A phone number only if it looks like one: digits with an optional leading +, spaces, brackets and dashes. Anything else is left out. */
const PHONE = /^\+?\(?[0-9][0-9 ()-]{5,18}[0-9]$/;
export function cleanPhone(value: unknown): string | null {
  const s = cleanText(value, 40).trim();
  return PHONE.test(s) ? s : null;
}

/** A date as the database gives it ("2026-10-27" or a full timestamp) reduced to its day, or null if it is not one. */
export function cleanDate(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Lagos is one hour ahead of UTC all year (no daylight saving). */
const LAGOS_MS = 3_600_000;

/** A timestamp as Lagos wall-clock "2026-10-27 04:07", or null if it is not one. */
export function cleanDateTime(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null;
  // A moment with no zone on it is the database's own clock, which is UTC
  const iso = s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const t = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(t.getTime())) return null;
  const local = new Date(t.getTime() + LAGOS_MS).toISOString();
  return `${local.slice(0, 10)} ${local.slice(11, 16)}`;
}
