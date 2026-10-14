import { STANDINGS, type Standing } from "./labels";
import { MAX_PEOPLE } from "./sheet/parse";

/** One person as the database takes them. The page sends rows it got from `/api/referees/read`; nothing the page sends is trusted. */
export type ImportRow = { line: number; name: string; standing: Standing | ""; unit: string; note: string; contacts: string[]; active?: false };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Cleans what came from the browser, or says why it cannot be used. Never throws. */
export function cleanRows(input: unknown): { ok: true; rows: ImportRow[] } | { ok: false; message: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, message: "There are no people to add. Choose the file again." };
  if (input.length > MAX_PEOPLE) return { ok: false, message: `That is more than ${MAX_PEOPLE.toLocaleString("en-NG")} people in one go. Please split the file.` };
  const rows: ImportRow[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, message: "We couldn’t read that list. Choose the file again." };
    const r = raw as Record<string, unknown>;
    const standing = typeof r.standing === "string" && (STANDINGS as readonly string[]).includes(r.standing) ? (r.standing as Standing) : "";
    const contacts = Array.isArray(r.contacts) ? r.contacts.map((c) => text(c, 160)).filter(Boolean).slice(0, 12) : [];
    const line = typeof r.line === "number" && Number.isInteger(r.line) && r.line >= 0 && r.line < 10_000_000 ? r.line : rows.length + 2;
    rows.push({
      line,
      name: text(r.name, 120),
      standing,
      unit: text(r.unit, 120),
      note: text(r.note, 300),
      contacts,
      ...(r.active === false ? { active: false as const } : {}),
    });
  }
  return { ok: true, rows };
}

export const isMode = (v: unknown): v is "update" | "replace" => v === "update" || v === "replace";
