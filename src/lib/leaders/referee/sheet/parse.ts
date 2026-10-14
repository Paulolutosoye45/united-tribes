import { fieldOf, isNo, splitContacts, standingFromText, type Field } from "./columns";
import { decodeText, parseCsv } from "./csv";
import { readXlsx, type Sheet, type SheetRow } from "./xlsx";
import { ZipError } from "./zip";
import { STANDINGS, type Standing } from "../labels";

/** One person as read from the file, ready for the database to check. `line` is the row number the person sees in their spreadsheet. */
export type ParsedRow = {
  line: number;
  name: string;
  standing: Standing | "";
  /** What the role cell said, when it could not be read (so the screen can quote it back). */
  roleText: string;
  unit: string;
  note: string;
  contacts: string[];
  /** False when the row says "Active: No". Absent otherwise. */
  active?: false;
};

export type ColumnRead = { index: number; header: string; field: Field };

export type ParseOk = {
  ok: true;
  fileType: "xlsx" | "csv";
  sheet: string;
  sheets: { name: string; people: number }[];
  headerLine: number;
  columns: ColumnRead[];
  /** Titles it could not use (so a person knows nothing was silently dropped). */
  ignored: string[];
  rows: ParsedRow[];
  /** Rows left out before the database ever saw them, with the reason. */
  skipped: { line: number; reason: string }[];
  /** True when the file has no role column or some roles could not be read: the screen then asks what to do with them. */
  rolesMissing: boolean;
};
export type ParseResult = ParseOk | { ok: false; message: string };

export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_PEOPLE = 5000;

/** A header row is the first of the top twenty with at least two titles we recognise, one of them a name or a contact. */
function findHeader(rows: SheetRow[]): { at: number; columns: ColumnRead[]; ignored: string[] } | null {
  let best: { at: number; columns: ColumnRead[]; ignored: string[]; score: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const columns: ColumnRead[] = [];
    const ignored: string[] = [];
    rows[i].cells.forEach((cell, index) => {
      const header = cell.trim();
      if (!header) return;
      const field = fieldOf(header);
      if (field) columns.push({ index, header, field });
      else ignored.push(header);
    });
    const fields = new Set(columns.map((c) => c.field));
    const hasWho = fields.has("name") || fields.has("first");
    const hasHow = fields.has("phone") || fields.has("email") || fields.has("contact");
    if (!hasWho || !hasHow) continue;
    const score = fields.size;
    if (!best || score > best.score) best = { at: i, columns, ignored, score };
    if (score >= 4) break;
  }
  return best;
}

/** Without a header at all: three or four columns of name, then phone and email in some order. Only tried when nothing else fits. */
function guessWithoutHeader(rows: SheetRow[]): { at: number; columns: ColumnRead[]; ignored: string[] } | null {
  const sample = rows.slice(0, 10);
  if (sample.length === 0) return null;
  // Titles never look like a phone number or an email. If the first row does not, it is a row of titles we did not understand,
  // and treating it as a person would be worse than asking for a file with titles we can read.
  const looksLikeData = (v: string) => /@/.test(v) || /^[+\d][\d\s()+-]{6,}$/.test(v.trim());
  if (!sample[0].cells.some(looksLikeData)) return null;
  const width = Math.max(...sample.map((r) => r.cells.length));
  const columns: ColumnRead[] = [];
  for (let c = 0; c < width; c++) {
    const values = sample.map((r) => (r.cells[c] ?? "").trim()).filter(Boolean);
    if (values.length === 0) continue;
    const emails = values.filter((v) => /@/.test(v)).length;
    const phones = values.filter((v) => /^[+\d][\d\s()+-]{6,}$/.test(v)).length;
    if (emails >= values.length / 2) columns.push({ index: c, header: `Column ${c + 1}`, field: "email" });
    else if (phones >= values.length / 2) columns.push({ index: c, header: `Column ${c + 1}`, field: "phone" });
    else if (!columns.some((x) => x.field === "name")) columns.push({ index: c, header: `Column ${c + 1}`, field: "name" });
  }
  const fields = new Set(columns.map((c) => c.field));
  if (!fields.has("name") || !(fields.has("phone") || fields.has("email"))) return null;
  return { at: -1, columns, ignored: [] };
}

function sheetScore(sheet: Sheet): number {
  const header = findHeader(sheet.rows);
  return header ? header.columns.length * 100 + sheet.rows.length : 0;
}

const cellAt = (row: SheetRow, index: number) => (row.cells[index] ?? "").trim();

export type ParseOptions = {
  name: string;
  bytes: Buffer;
  /** A sheet by its name, when the file has several and the person picked one. */
  sheet?: string | null;
  /** What to do with a row whose role is missing or not understood. Without it those rows are left for the database to explain. */
  fallback?: Standing | "" | null;
};

export function parseDirectoryFile({ name, bytes, sheet, fallback }: ParseOptions): ParseResult {
  if (bytes.length === 0) return { ok: false, message: "That file is empty." };
  if (bytes.length > MAX_BYTES) return { ok: false, message: "That file is too large. A list of people should be well under 4 MB." };

  const lower = name.toLowerCase();
  let fileType: "xlsx" | "csv";
  let sheets: Sheet[];
  try {
    if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      return {
        ok: false,
        message: /\.xls$/.test(lower)
          ? "That is an older Excel file (.xls). Open it, choose Save As, and pick Excel Workbook (.xlsx) or CSV. Then upload it again."
          : "That file is protected or in an older format. Remove the password, or save it as .xlsx or .csv, and upload it again.",
      };
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      if (/\.(ods|numbers)$/.test(lower)) return { ok: false, message: "We can’t read that kind of file yet. Export it as Excel (.xlsx) or CSV, then upload it again." };
      fileType = "xlsx";
      sheets = readXlsx(bytes);
    } else if (/\.(xlsx|xlsm)$/.test(lower)) {
      return { ok: false, message: "That file isn’t a real Excel file. Open it and save it again as .xlsx or .csv." };
    } else if (/\.(pdf|docx?|png|jpe?g|gif|zip)$/.test(lower)) {
      return { ok: false, message: "That isn’t a spreadsheet. Upload an Excel (.xlsx) or CSV file." };
    } else {
      fileType = "csv";
      sheets = [{ name: name.replace(/\.[^.]+$/, "") || "List", rows: parseCsv(decodeText(bytes)) }];
    }
  } catch (e) {
    return { ok: false, message: e instanceof ZipError ? e.message : "We couldn’t read that file. Save it again as .xlsx or .csv and try once more." };
  }

  const people = (s: Sheet) => {
    const h = findHeader(s.rows);
    return Math.max(0, h ? s.rows.length - h.at - 1 : s.rows.length - 1);
  };
  const wanted = sheet ? sheets.find((s) => s.name === sheet) : null;
  const chosen = wanted ?? [...sheets].sort((a, b) => sheetScore(b) - sheetScore(a))[0];
  if (!chosen || chosen.rows.length === 0) return { ok: false, message: "There is nothing in that file. Add the people, with a name and a phone number or email for each." };

  const header = findHeader(chosen.rows) ?? guessWithoutHeader(chosen.rows);
  if (!header) {
    return {
      ok: false,
      message:
        "We couldn’t find the columns. The first row should have titles such as Name, Role, Phone and Email. The “Download the template” button gives you a file to fill in.",
    };
  }

  const byField = (f: Field) => header.columns.filter((c) => c.field === f);
  const nameCols = byField("name");
  const firstCols = byField("first");
  const lastCols = byField("last");
  const roleCols = byField("role");
  const unitCols = byField("unit");
  const noteCols = byField("note");
  const contactCols = [...byField("phone"), ...byField("email"), ...byField("contact")];
  const activeCol = byField("active")[0];

  const rows: ParsedRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  let rolesMissing = roleCols.length === 0;

  const body = chosen.rows.filter((r) => r.line > (header.at >= 0 ? chosen.rows[header.at].line : 0));
  for (const r of body) {
    const join = (cols: ColumnRead[]) => cols.map((c) => cellAt(r, c.index)).filter(Boolean).join(" ");
    let personName = nameCols.length ? join(nameCols.slice(0, 1)) : "";
    if (!personName) personName = [join(firstCols), join(lastCols)].filter(Boolean).join(" ");
    personName = personName.replace(/\s+/g, " ").trim();
    const contacts = contactCols.flatMap((c) => splitContacts(cellAt(r, c.index)));
    const unique = [...new Set(contacts)];

    // Example rows from the template, a "total" line, a note under the table
    if (/^\(?example\)?/i.test(personName)) {
      skipped.push({ line: r.line, reason: "An example row, left out" });
      continue;
    }
    if (!personName && unique.length === 0) continue;

    let roleText = "";
    let standing: Standing | "" = "";
    for (const c of roleCols) {
      const text = cellAt(r, c.index);
      if (!text) continue;
      const read = standingFromText(text);
      if (read.blank) continue;
      if (read.standing) {
        standing = read.standing;
        break;
      }
      roleText = text;
    }
    if (!standing) {
      rolesMissing = true;
      if (fallback && (STANDINGS as readonly string[]).includes(fallback)) standing = fallback;
    }

    const active = activeCol && isNo(cellAt(r, activeCol.index)) ? (false as const) : undefined;
    rows.push({
      line: r.line,
      name: personName,
      standing,
      roleText: standing && !roleText ? "" : roleText,
      unit: join(unitCols.slice(0, 1)),
      note: join(noteCols.slice(0, 1)),
      contacts: unique,
      ...(active === false ? { active: false as const } : {}),
    });
  }

  if (rows.length === 0) return { ok: false, message: "We found the columns but no people under them. Check the rows below the titles are filled in." };
  if (rows.length > MAX_PEOPLE) return { ok: false, message: `That file has ${rows.length.toLocaleString("en-NG")} people. Please split it into files of ${MAX_PEOPLE.toLocaleString("en-NG")} or fewer.` };

  return {
    ok: true,
    fileType,
    sheet: chosen.name,
    // The sheet that was read is counted exactly; the others only roughly (rows under a heading)
    sheets: sheets.map((s) => ({ name: s.name, people: s === chosen ? rows.length : people(s) })),
    headerLine: header.at >= 0 ? chosen.rows[header.at].line : 0,
    columns: header.columns,
    ignored: header.ignored,
    rows,
    skipped,
    rolesMissing,
  };
}
