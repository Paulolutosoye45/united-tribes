import type { Standing } from "../labels";

/**
 * Making sense of a spreadsheet somebody typed up by hand: the column titles can be anything ("Phone no.", "WhatsApp", "Pastor's name")
 * and the roles can be written many ways ("Pst", "HOD", "Head of Department"). This turns what was written into the four things the
 * directory holds, and says plainly when it could not.
 */

export type Field = "name" | "first" | "last" | "role" | "unit" | "note" | "phone" | "email" | "contact" | "active";

/** A title with the case, punctuation and spacing taken out, so "E-mail Address:" and "email address" are the same. */
export const squash = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const ALIASES: Record<Field, string[]> = {
  name: [
    "name", "names", "full name", "fullname", "pastor name", "pastors name", "name of pastor", "name of unit head", "name of leader", "leader name",
    "unit head name", "person", "staff", "staff name", "contact person", "name of person", "pastor", "pastors", "unit head", "leader", "full names",
  ],
  first: ["first name", "firstname", "given name", "given names", "forename", "first"],
  last: ["last name", "lastname", "surname", "family name", "last", "second name"],
  role: ["role", "roles", "standing", "position", "positions", "type", "category", "designation", "office", "title", "rank", "level", "role pastor unit head", "pastor or unit head"],
  unit: ["unit", "units", "department", "dept", "ministry", "zone", "group", "church", "branch", "location", "area", "team", "unit department", "unit name", "department unit", "unit ministry", "ministry unit", "region", "district", "assignment"],
  note: ["note", "notes", "remark", "remarks", "comment", "comments", "description", "details", "info", "information"],
  phone: [
    "phone", "phone number", "phone numbers", "phone no", "phone no s", "mobile", "mobile number", "mobile no", "whatsapp", "whatsapp number", "whatsapp no",
    "tel", "telephone", "telephone number", "tel no", "cell", "cell phone", "cellphone", "gsm", "gsm number", "number", "numbers", "contact number", "contact numbers",
    "phone 1", "phone 2", "phone 3", "alt phone", "alternate phone", "alternative phone", "other phone", "mobile 1", "mobile 2", "phone one", "phone two", "primary phone", "secondary phone",
  ],
  email: ["email", "emails", "e mail", "email address", "email addresses", "mail", "email 1", "email 2", "email 3", "alt email", "alternate email", "alternative email", "other email", "primary email", "secondary email", "email one", "email two"],
  contact: ["contact", "contacts", "contact details", "contact detail", "contact info", "contact information", "phone email", "phone or email", "phone and email", "email phone", "email or phone", "phone number or email"],
  active: ["active", "is active", "on the list", "still active", "listed", "current"],
};

const LOOKUP = new Map<string, Field>();
for (const [field, names] of Object.entries(ALIASES) as [Field, string[]][]) for (const n of names) if (!LOOKUP.has(squash(n))) LOOKUP.set(squash(n), field);

/** The field a column title means, or null. A title like "Phone 3" or "Alt email" is recognised by its stem. */
export function fieldOf(title: string): Field | null {
  const s = squash(title);
  if (!s) return null;
  const direct = LOOKUP.get(s);
  if (direct) return direct;
  // "phone number 2", "email (work)", "whatsapp no. 2"
  const stem = s.replace(/\b(1|2|3|4|one|two|three|work|home|personal|official|main|primary|secondary|alt|alternate|alternative|other)\b/g, " ").replace(/\s+/g, " ").trim();
  if (stem && stem !== s) {
    const viaStem = LOOKUP.get(stem);
    if (viaStem) return viaStem;
  }
  // "Dept / Unit": every word means the same thing
  const words = s.split(" ").filter((w) => !["and", "or", "of", "the", "name", "no", "number", "s"].includes(w));
  const kinds = new Set(words.map((w) => LOOKUP.get(w) ?? null));
  if (words.length > 1 && kinds.size === 1 && [...kinds][0]) return [...kinds][0];
  if (/\b(phone|mobile|whatsapp|gsm|tel|telephone|cell)\b/.test(s)) return "phone";
  if (/\b(email|mail)\b/.test(s)) return "email";
  return null;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** Honorifics that are not a role: a column called "Title" often holds only these. They are left alone, silently. */
const HONORIFICS = new Set(["mr", "mrs", "miss", "ms", "dr", "prof", "engr", "sir", "madam", "chief", "sis", "sister", "bro", "brother", "mama", "papa", "aunty", "uncle", "barr", "arc", "hon"]);

export type RoleRead = { standing: Standing | null; blank: boolean };

/**
 * What a role cell means. Only clear words count. "Evangelist" or "Elder" alone is not guessed at: the person is told, and picks what
 * to do. Being generous here would give someone the standing of a pastor by accident.
 */
export function standingFromText(text: string): RoleRead {
  const s = squash(text);
  if (!s) return { standing: null, blank: true };
  const words = s.split(" ");
  if (words.every((w) => HONORIFICS.has(w))) return { standing: null, blank: true };
  if (/\bunit\s*head\b|\bunithead\b|\bunit\s*lead(er)?\b|\bhod\b|\bhead of (the )?(department|dept|unit)\b|\b(department|dept)(al)? head\b|\b(department|dept)(al)? lead(er)?\b|\bunit coordinator\b/.test(s)) {
    return { standing: "unit_head", blank: false };
  }
  if (/\bministry (leader|head|lead|coordinator|director)\b|\bhead of (the )?ministry\b|\bteam (leader|lead|head)\b|\bcoordinator\b|\bministry\b/.test(s)) {
    return { standing: "ministry_leader", blank: false };
  }
  if (/\b(pastor|pastors|pst|ptr|rev|reverend|bishop|apostle|overseer|presbyter)\b/.test(s)) return { standing: "pastor", blank: false };
  if (/^(leader|lead|head)$/.test(s)) return { standing: "ministry_leader", blank: false };
  return { standing: null, blank: false };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/** One cell can hold several contacts: "0803 111 2222 / ife@church.org", "a@x.org; b@x.org", one per line. */
export function splitContacts(cell: string): string[] {
  const text = String(cell ?? "").trim();
  if (!text) return [];
  const out: string[] = [];
  // Emails first: they are the easy ones to find and must not be cut at a dot or a plus
  const emails = text.match(/[^\s,;/|<>()"']+@[^\s,;/|<>()"']+/g) ?? [];
  let rest = text;
  for (const e of emails) {
    out.push(e.replace(/[.,;:]+$/, ""));
    rest = rest.replace(e, " ");
  }
  // What is left are phone numbers, separated by / , ; | "or" "and" or a new line. A space alone is part of one number ("0803 111 2222").
  for (const part of rest.split(/[\n\r,;/|]+|\s+(?:or|and|&)\s+/i)) {
    const p = part.trim();
    if (p) out.push(p);
  }
  return out;
}

/** A cell that says "no" in any of the usual ways. Anything else (or nothing) is "yes". */
export function isNo(cell: string): boolean {
  return /^(no|n|false|0|retired|inactive|off|removed|left)$/i.test(squash(cell));
}
