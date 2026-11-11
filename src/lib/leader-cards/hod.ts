import { decodeText, parseCsv } from "@/lib/leaders/referee/sheet/csv";
import { CARD_WORDS, type CardState } from "./cards";
import { readXlsx, type Sheet, type SheetRow } from "@/lib/leaders/referee/sheet/xlsx";
import { ZipError } from "@/lib/leaders/referee/sheet/zip";

/**
 * The list of heads of department, pasted or uploaded, and the report on it. One row each: a name, an email or a phone number, a department and (if known) a goal.
 * This only reads the list and the report. The database finds each person and says where they stand; nothing here sends, appoints or changes anyone.
 */

export const HOD_MAX_ROWS = 500;
export const HOD_MAX_BYTES = 2 * 1024 * 1024;

export type HodRow = { line: number; name: string; email: string; phone: string; department: string; goal: string };
export type HodProblem = { line: number; text: string };
export type HodRead = { ok: true; rows: HodRow[]; problems: HodProblem[] } | { ok: false; message: string };

type Column = "name" | "first" | "last" | "email" | "phone" | "department" | "goal";

const HEADERS: Record<Column, string[]> = {
  name: ["name", "full name", "names", "leader", "leader name", "name of leader", "hod", "hod name", "head of department", "head of department name", "head", "person"],
  first: ["first name", "firstname", "first", "given name", "forename"],
  last: ["last name", "lastname", "surname", "family name"],
  email: ["email", "email address", "e mail", "e mail address", "emailaddress", "email id", "mail", "emails", "email addresses"],
  phone: [
    "phone", "phone number", "phone no", "phone numbers", "mobile", "mobile number", "mobile no", "whatsapp", "whatsapp number", "whatsapp no", "number", "tel", "telephone",
    "telephone number", "contact", "contact number", "contact no", "gsm",
  ],
  department: ["department", "dept", "department unit", "department or unit", "unit", "ministry", "department ministry", "department name", "name of department", "team", "service unit"],
  goal: ["goal", "season goal", "community goal", "goal if known", "their goal", "goals"],
};

const norm = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const columnOf = (header: string): Column | null => {
  const h = norm(header);
  if (!h) return null;
  for (const [key, names] of Object.entries(HEADERS) as [Column, string[]][]) if (names.includes(h)) return key;
  return null;
};

const EMAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;

/** An email cell may hold more than one address, or a name round it. The first thing that is an address is used. */
export function pickEmail(raw: string): string {
  const parts = raw.split(/[\s;,/|<>()]+/).filter(Boolean);
  return parts.find((p) => EMAIL.test(p)) ?? raw.trim();
}

/** A phone cell as a spreadsheet leaves it: a number turned into 2.348031234567E+12 or 8031234567.0, or two numbers in one cell. The first number is used. */
export function pickPhone(raw: string): string {
  const first = raw.split(/[;,/|\n]+/).map((s) => s.trim()).find(Boolean) ?? "";
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(first)) {
    const n = Number(first);
    if (Number.isFinite(n) && n > 0 && n < 1e16) return String(Math.round(n));
  }
  if (/^\d+\.0+$/.test(first)) return first.replace(/\.0+$/, "");
  return first;
}

const cut = (s: string, n: number) => s.trim().replace(/\s+/g, " ").slice(0, n);

/** Reads a .csv or .xlsx. Rows with nothing on them are left out; nothing else is dropped, and the report says what each row came to. */
export function readHodSheet(fileName: string, bytes: Buffer): HodRead {
  if (bytes.length === 0) return { ok: false, message: "That file is empty." };
  if (bytes.length > HOD_MAX_BYTES) return { ok: false, message: "That file is too large. A list of up to 500 people is well under 2 MB." };
  let sheet: Sheet;
  const lower = fileName.toLowerCase();
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const sheets = readXlsx(bytes);
      sheet = sheets[0] ?? { name: "", rows: [] };
    } else if (/\.(xls|ods|numbers|pdf|docx?|png|jpe?g|gif|zip)$/.test(lower)) {
      return { ok: false, message: "We can read an Excel (.xlsx) or CSV file. Save the list as one of those and upload it again." };
    } else {
      sheet = { name: "List", rows: parseCsv(decodeText(bytes)) };
    }
  } catch (e) {
    return { ok: false, message: e instanceof ZipError ? e.message : "We couldn’t read that file. Save it again as .xlsx or .csv and try once more." };
  }
  return readHodRows(sheet.rows);
}

/** Text pasted straight from a spreadsheet (tab separated) or a CSV. */
export function readHodText(text: string): HodRead {
  if (!text.trim()) return { ok: false, message: "Paste the list first." };
  if (text.length > HOD_MAX_BYTES) return { ok: false, message: "That is too much text. Paste up to 500 people." };
  return readHodRows(parseCsv(text));
}

export function readHodRows(rows: SheetRow[]): HodRead {
  const at = rows.findIndex((r) => {
    const keys = r.cells.map(columnOf);
    return keys.includes("email") || keys.includes("phone");
  });
  if (at < 0)
    return {
      ok: false,
      message: "We couldn’t find the columns. The first row should have titles: Name, Email or Phone, and Department (Goal is optional).",
    };
  const index: Partial<Record<Column, number>> = {};
  rows[at].cells.forEach((c, i) => {
    const key = columnOf(c);
    if (key && index[key] === undefined) index[key] = i;
  });
  const cell = (r: SheetRow, k: Column) => (index[k] === undefined ? "" : (r.cells[index[k]!] ?? "").trim());

  const out: HodRow[] = [];
  const problems: HodProblem[] = [];
  for (const r of rows.slice(at + 1)) {
    if (r.cells.every((c) => !c.trim())) continue;
    if (/^\(?example\)?/i.test(cell(r, "name")) || /^\(?example\)?/i.test(cell(r, "email"))) continue;
    if (out.length >= HOD_MAX_ROWS) {
      problems.push({ line: r.line, text: `Only the first ${HOD_MAX_ROWS} people are read.` });
      break;
    }
    const name = cell(r, "name") || [cell(r, "first"), cell(r, "last")].filter(Boolean).join(" ");
    out.push({
      line: r.line,
      name: cut(name, 120),
      email: cut(pickEmail(cell(r, "email")), 200),
      phone: cut(pickPhone(cell(r, "phone")), 40),
      department: cut(cell(r, "department"), 60),
      goal: cut(cell(r, "goal"), 120),
    });
  }
  if (out.length === 0 && problems.length === 0) return { ok: false, message: "There is nobody on that list." };
  return { ok: true, rows: out, problems };
}

/** The titles for a template the person can fill in. */
export const HOD_HEADER = ["Name", "Email", "Phone", "Department", "Goal"] as const;
export const HOD_TEMPLATE = [HOD_HEADER.join(","), "(example) Ada Obi,ada@example.org,08031234567,Ushers,"].join("\r\n");

// ---------------------------------------------------------------------------
// What the report says
// ---------------------------------------------------------------------------

export type HodResult = "appointed" | "has_account" | "no_account" | "duplicate" | "unclear";
export const HOD_RESULTS: readonly HodResult[] = ["appointed", "has_account", "no_account", "duplicate", "unclear"];

export const HOD_WORDS: Record<HodResult, { label: string; line: string }> = {
  appointed: { label: "Already a leader", line: "On the platform as a leader, with a tribe or an appointment." },
  has_account: { label: "Has an account, not appointed", line: "Signed up, but not leading a tribe. They may still need appointing." },
  no_account: { label: "No account yet", line: "Nobody on the platform has this email or number. They can be invited." },
  duplicate: { label: "On the list twice", line: "The same person as an earlier line. Only the first is counted." },
  unclear: { label: "Could not tell", line: "Nothing usable on the row, or the email and the number belong to different people." },
};

const isResult = (v: unknown): v is HodResult => typeof v === "string" && (HOD_RESULTS as readonly string[]).includes(v);

export type HodReportRow = {
  line: number;
  name: string;
  department: string;
  goal: string;
  result: HodResult;
  note: string;
  leaderDept: string;
  email: string;
  phone: string;
};
export type HodMissing = { name: string; tribe: string; department: string; state: string };
export type HodRun = { id: string; madeAt: string; rows: number; note: string; by: string; taggedAt: string | null; invitedAt: string | null; invitedN: number | null };
export type HodReport = { ok: true; role: "act" | "look"; run: HodRun; rows: HodReportRow[]; missing: HodMissing[] } | { ok: false };
export const HOD_OFF: HodReport = { ok: false };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The report as the database gave it. Anything that is not what was expected means "not available". */
export function parseHodReport(data: unknown): HodReport {
  const d = rec(data);
  const run = rec(d?.run);
  if (!d || !run || (d.role !== "act" && d.role !== "look") || typeof run.id !== "string" || !Array.isArray(d.rows) || !Array.isArray(d.missing)) return HOD_OFF;
  const rows: HodReportRow[] = [];
  for (const raw of d.rows) {
    const r = rec(raw);
    if (!r || typeof r.line !== "number" || !isResult(r.result)) continue;
    rows.push({
      line: r.line, name: str(r.name), department: str(r.department), goal: str(r.goal), result: r.result, note: str(r.note), leaderDept: str(r.leader_dept),
      email: str(r.email), phone: str(r.phone),
    });
  }
  const missing: HodMissing[] = [];
  for (const raw of d.missing) {
    const m = rec(raw);
    if (!m || typeof m.name !== "string") continue;
    missing.push({ name: m.name, tribe: str(m.tribe), department: str(m.department), state: str(m.state) });
  }
  return {
    ok: true,
    role: d.role,
    run: {
      id: run.id, madeAt: str(run.made_at), rows: typeof run.rows === "number" ? run.rows : rows.length, note: str(run.note), by: str(run.by),
      taggedAt: strOrNull(run.tagged_at), invitedAt: strOrNull(run.invited_at), invitedN: typeof run.invited_n === "number" ? run.invited_n : null,
    },
    rows,
    missing,
  };
}

export type HodListItem = { id: string; madeAt: string; rows: number; note: string; counts: Partial<Record<HodResult, number>>; taggedAt: string | null; invitedAt: string | null };
export type HodList = { ok: true; role: "act" | "look"; runs: HodListItem[] } | { ok: false };

export function parseHodList(data: unknown): HodList {
  const d = rec(data);
  if (!d || (d.role !== "act" && d.role !== "look") || !Array.isArray(d.runs)) return { ok: false };
  const runs: HodListItem[] = [];
  for (const raw of d.runs) {
    const r = rec(raw);
    if (!r || typeof r.id !== "string") continue;
    const counts: Partial<Record<HodResult, number>> = {};
    const c = rec(r.counts) ?? {};
    for (const k of HOD_RESULTS) if (typeof c[k] === "number") counts[k] = c[k] as number;
    runs.push({ id: r.id, madeAt: str(r.made_at), rows: typeof r.rows === "number" ? r.rows : 0, note: str(r.note), counts, taggedAt: strOrNull(r.tagged_at), invitedAt: strOrNull(r.invited_at) });
  }
  return { ok: true, role: d.role, runs };
}

/** How many rows stand each way, counted from the report as it reads now. */
export function hodCounts(rows: readonly HodReportRow[]): Record<HodResult, number> {
  const out: Record<HodResult, number> = { appointed: 0, has_account: 0, no_account: 0, duplicate: 0, unclear: 0 };
  for (const r of rows) out[r.result] += 1;
  return out;
}

/** What each tap would do now, counted from the report as it reads now, so the buttons say how many before anything is done. */
export function hodActions(rows: readonly HodReportRow[]): { tag: number; differs: number; invite: number; noEmail: number } {
  let tag = 0;
  let differs = 0;
  // Each appointed row is a different person: a repeat is marked duplicate, not appointed
  for (const r of rows) {
    if (r.result !== "appointed" || r.department.trim().length < 2) continue;
    if (!r.leaderDept) tag += 1;
    else if (r.leaderDept.toLowerCase() !== r.department.trim().toLowerCase()) differs += 1;
  }
  const noAccount = rows.filter((r) => r.result === "no_account");
  const usable = (r: HodReportRow) => EMAIL.test(r.email.trim());
  const withEmail = new Set(noAccount.filter(usable).map((r) => r.email.trim().toLowerCase()));
  return { tag, differs, invite: withEmail.size, noEmail: noAccount.filter((r) => !usable(r)).length };
}

/** The line at the top of a report. */
export function hodHeadline(counts: Record<HodResult, number>, missing: number): string {
  const total = HOD_RESULTS.reduce((n, k) => n + counts[k], 0);
  const people = total - counts.duplicate;
  const word = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    `${word(people, "person", "people")} on the list`,
    `${counts.appointed} already ${counts.appointed === 1 ? "a leader" : "leaders"}`,
    `${counts.has_account} with an account but not appointed`,
    `${counts.no_account} with no account`,
  ];
  if (counts.unclear > 0) parts.push(`${counts.unclear} we could not tell`);
  return `${parts.join(", ")}. ${missing === 0 ? "Every leader on the platform is on the list." : `${word(missing, "leader on the platform is", "leaders on the platform are")} not on the list.`}`;
}

// ---------------------------------------------------------------------------
// The two spreadsheets
// ---------------------------------------------------------------------------

const cell = (v: string | number | null): string => {
  // A spreadsheet runs a cell that begins with = + - or @ as a formula: a name never needs to. A phone number starts with + or 0 and is kept as text.
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csv = (head: string[], lines: (string | number | null)[][]) => "﻿" + [head, ...lines].map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";

/** Every row of the list and where that person stands. The contacts are there only for those who act. */
export function hodListCsv(report: Extract<HodReport, { ok: true }>): string {
  const act = report.role === "act";
  const head = ["Line", "Name", "Department on the list", "Goal", "Where they stand", "Note", "Department on the platform", ...(act ? ["Email", "Phone"] : [])];
  return csv(
    head,
    report.rows.map((r) => [r.line, r.name, r.department, r.goal, HOD_WORDS[r.result].label, r.note, r.leaderDept, ...(act ? [r.email, r.phone] : [])]),
  );
}

/** The leaders on the platform who are not on the list. Names, tribe, department and where the card is: no number and no address. */
export function hodMissingCsv(report: Extract<HodReport, { ok: true }>): string {
  return csv(["Name", "Tribe", "Department", "Where their card is"], report.missing.map((m) => [m.name, m.tribe, m.department || "No department yet", CARD_WORDS[m.state as CardState] ?? m.state]));
}
