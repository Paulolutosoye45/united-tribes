import { writeZip, type ZipEntry } from "@/lib/leaders/referee/sheet/zip";
import { cleanDate, cleanDateTime, cleanPhone, cleanText, needsGuard } from "./guard";
import { lagosDay, type Cell, type ColType, type Table, type Workbook } from "./model";

/**
 * The Excel file. Everything is typed: a number is a number, a date is a date (shown as year-month-day), a share is a percentage, and a
 * phone number is text, so Excel never drops its leading zero or turns it into 2.35E+12. Each table is an Excel Table (sort and filter
 * buttons, banded rows, a name other tools can refer to), the first tab says what the file is and what was left out, the last tab is a
 * data dictionary, and the print setup (landscape, fit to the page width, headings repeated, who made it in the footer) is set so a
 * printed copy is as good as the screen. Nothing is a formula and nothing is stored with it: the same content always gives the same
 * bytes apart from the moment it was made.
 */

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const HEAD_ROW = 4;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The cell styles, by position in cellXfs. */
const S = {
  default: 0, header: 1, text: 2, textGuarded: 3, int: 4, decimal: 5, percent: 6, date: 7, datetime: 8, phone: 9,
  title: 10, note: 11, label: 12, wrap: 13, grid: 14, gridName: 15, free: 16, freeGuarded: 17, banner: 18, bannerWrap: 19,
} as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/><numFmt numFmtId="166" formatCode="0.0"/></numFmts>
<fonts count="7">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="15"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF5B5B66"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF8A1C00"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F1B2E"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF1CC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF9A9AA5"/></left><right style="thin"><color rgb="FF9A9AA5"/></right><top style="thin"><color rgb="FF9A9AA5"/></top><bottom style="thin"><color rgb="FF9A9AA5"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="20">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1" quotePrefix="1"><alignment vertical="top"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1" quotePrefix="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1" quotePrefix="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="6" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function columnLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - r - 1) / 26);
  }
  return out;
}

/** Days since 1899-12-30, the way Excel counts, from a "2026-10-27" day. */
function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000 + 25_569;
}

class Strings {
  private readonly list: string[] = [];
  private readonly index = new Map<string, number>();
  refs = 0;
  add(s: string): number {
    this.refs += 1;
    const known = this.index.get(s);
    if (known !== undefined) return known;
    this.list.push(s);
    this.index.set(s, this.list.length - 1);
    return this.list.length - 1;
  }
  xml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${NS}" count="${this.refs}" uniqueCount="${this.list.length}">${this.list
      .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
      .join("")}</sst>`;
  }
}

type Out = { style: number; kind: "s" | "n" | "blank"; value: string | number };

/** One value, by its column's type, as the cell it becomes. A value that does not fit its type becomes an empty cell. */
function typed(v: Cell | undefined, type: ColType, grid: boolean): Out {
  const blank = (style: number): Out => ({ style, kind: "blank", value: "" });
  if (v === null || v === undefined || v === "") return blank(grid ? S.grid : S.text);
  switch (type) {
    case "int": {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? { style: S.int, kind: "n", value: Math.round(n) } : blank(S.int);
    }
    case "decimal": {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? { style: S.decimal, kind: "n", value: Math.round(n * 10_000) / 10_000 } : blank(S.decimal);
    }
    case "percent": {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? { style: S.percent, kind: "n", value: Math.round(n * 100_000) / 100_000 } : blank(S.percent);
    }
    case "date": {
      const d = cleanDate(v);
      return d ? { style: S.date, kind: "n", value: dayNumber(d) } : blank(S.date);
    }
    case "datetime": {
      const t = cleanDateTime(v);
      if (!t) return blank(S.datetime);
      const minutes = Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
      return { style: S.datetime, kind: "n", value: Math.round((dayNumber(t.slice(0, 10)) + minutes / 1440) * 1e8) / 1e8 };
    }
    case "yesno": {
      const s = v === true || v === "true" || v === "Yes" ? "Yes" : v === false || v === "false" || v === "No" ? "No" : "";
      return s ? { style: S.text, kind: "s", value: s } : blank(S.text);
    }
    case "phone": {
      const p = cleanPhone(v);
      return p ? { style: S.phone, kind: "s", value: p } : blank(S.phone);
    }
    case "free": {
      const s = cleanText(v, 2000);
      return s ? { style: needsGuard(s) ? S.freeGuarded : S.free, kind: "s", value: s } : blank(S.free);
    }
    default: {
      const s = cleanText(v, 300);
      if (!s) return blank(grid ? S.grid : S.text);
      return { style: grid ? S.gridName : needsGuard(s) ? S.textGuarded : S.text, kind: "s", value: s };
    }
  }
}

function cellXml(ref: string, o: Out, strings: Strings): string {
  if (o.kind === "blank") return `<c r="${ref}" s="${o.style}"/>`;
  if (o.kind === "n") return `<c r="${ref}" s="${o.style}"><v>${o.value}</v></c>`;
  return `<c r="${ref}" s="${o.style}" t="s"><v>${strings.add(String(o.value))}</v></c>`;
}

const textCell = (ref: string, text: string, style: number, strings: Strings) =>
  text === "" ? `<c r="${ref}" s="${style}"/>` : `<c r="${ref}" s="${style}" t="s"><v>${strings.add(cleanText(text, 2000))}</v></c>`;

/** A name for a tab: at most 31 characters, none of the characters Excel forbids, and different from every other tab's. */
function sheetName(wanted: string, taken: Set<string>): string {
  const base = cleanText(wanted, 60).replace(/[\\/?*[\]:]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Sheet";
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

const TABLE_NAME_OK = /^[a-z][a-z0-9_]*$/;

type Part = { name: string; xml: string };

type SheetOut = { name: string; xml: string; tableXml: string | null; table: Table | null };

function headerFooter(wb: Workbook): string {
  const plain = (s: string) => cleanText(s, 60).replace(/&/g, "and");
  const lane = wb.lane === "people" ? "People file: church use only" : "Insight file";
  const head = `&L&"-,Bold"United Tribes&C${plain(wb.packName)}&R${lane}`;
  const foot = `&L${wb.exportId.slice(0, 8)} · ${lagosDay(wb.made)}${wb.rehearsal ? " · REHEARSAL" : ""}&CPage &P of &N&R${plain(wb.by)}`;
  return `<headerFooter><oddHeader>${esc(head)}</oddHeader><oddFooter>${esc(foot)}</oddFooter></headerFooter>`;
}

const PAGE_SETUP = '<pageMargins left="0.5" right="0.5" top="0.8" bottom="0.8" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';

function dataSheet(t: Table, wb: Workbook, name: string, strings: Strings, tableId: number | null): SheetOut {
  const cols = t.columns;
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}" xmlns:r="${REL}">`);
  out.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  out.push(`<sheetViews><sheetView workbookViewId="0" showGridLines="${t.grid ? 1 : 0}"><pane ySplit="${HEAD_ROW}" topLeftCell="A${HEAD_ROW + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${HEAD_ROW + 1}" sqref="A${HEAD_ROW + 1}"/></sheetView></sheetViews>`);
  out.push('<sheetFormatPr defaultRowHeight="18"/>');
  out.push(`<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 18}" customWidth="1"/>`).join("")}</cols>`);
  out.push("<sheetData>");
  out.push(`<row r="1" ht="26" customHeight="1">${textCell("A1", t.title, S.title, strings)}</row>`);
  out.push(`<row r="2">${textCell("A2", t.caption ?? "", S.note, strings)}</row>`);
  out.push(
    `<row r="3"${wb.rehearsal ? ' ht="22" customHeight="1"' : ""}>${
      wb.rehearsal
        ? cols.map((_, i) => textCell(`${columnLetters(i)}3`, i === 0 ? "REHEARSAL: this file was made while the pack is being tried. Please do not rely on it or pass it on." : "", S.banner, strings)).join("")
        : ""
    }</row>`,
  );
  // Names that repeat would break the Excel Table; they are made different
  const seen = new Set<string>();
  const heads = cols.map((c) => {
    let h = cleanText(c.label, 80).trim() || "Column";
    while (seen.has(h.toLowerCase())) h = `${h} (2)`;
    seen.add(h.toLowerCase());
    return h;
  });
  out.push(`<row r="${HEAD_ROW}" ht="32" customHeight="1">${heads.map((h, i) => textCell(`${columnLetters(i)}${HEAD_ROW}`, h, S.header, strings)).join("")}</row>`);
  t.rows.forEach((row, r) => {
    const rn = HEAD_ROW + 1 + r;
    out.push(`<row r="${rn}"${t.grid ? ' ht="24" customHeight="1"' : ""}>${cols.map((c, i) => cellXml(`${columnLetters(i)}${rn}`, typed(row[i], c.type, !!t.grid), strings)).join("")}</row>`);
  });
  out.push("</sheetData>");
  out.push(PAGE_SETUP);
  out.push(headerFooter(wb));
  const last = `${columnLetters(Math.max(0, cols.length - 1))}${HEAD_ROW + t.rows.length}`;
  const phones = cols.some((c) => c.type === "phone");
  if (phones && t.rows.length > 0) out.push(`<ignoredErrors><ignoredError sqref="A${HEAD_ROW + 1}:${last}" numberStoredAsText="1"/></ignoredErrors>`);
  let tableXml: string | null = null;
  if (tableId !== null) {
    out.push('<tableParts count="1"><tablePart r:id="rId1"/></tableParts>');
    const tname = `tbl_${t.id}`;
    tableXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="${NS}" id="${tableId}" name="${tname}" displayName="${tname}" ref="A${HEAD_ROW}:${last}" totalsRowShown="0"><autoFilter ref="A${HEAD_ROW}:${last}"/><tableColumns count="${cols.length}">${heads
      .map((h, i) => `<tableColumn id="${i + 1}" name="${esc(h)}"/>`)
      .join("")}</tableColumns><tableStyleInfo name="TableStyleLight1" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
  }
  out.push("</worksheet>");
  return { name, xml: out.join(""), tableXml, table: t };
}

const TYPE_WORDS: Record<ColType, string> = {
  text: "Text", free: "Free text (written by a person)", int: "Whole number", decimal: "Number with decimals", percent: "Percentage",
  date: "Date (year-month-day)", datetime: "Date and time (Lagos)", yesno: "Yes or No", phone: "Phone number (kept as text)",
};
export const typeWords = (t: ColType): string => TYPE_WORDS[t];

function aboutSheet(wb: Workbook, name: string, strings: Strings): SheetOut {
  const rows: string[] = [];
  const merges: string[] = [];
  let r = 0;
  const line = (a: string, b: string, sa: number, sb: number, ht?: number) => {
    r += 1;
    rows.push(`<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${textCell(`A${r}`, a, sa, strings)}${textCell(`B${r}`, b, sb, strings)}</row>`);
  };
  line(wb.title, "", S.title, S.default, 28);
  if (wb.subtitle) line(wb.subtitle, "", S.note, S.default);
  if (wb.rehearsal) {
    line("REHEARSAL: this file was made while the pack is being tried by a few people. Please do not rely on it or pass it on.", "", S.bannerWrap, S.bannerWrap, 36);
    merges.push(`A${r}:B${r}`);
  }
  line("", "", S.default, S.default);
  for (const [k, v] of wb.facts) line(k, v, S.label, S.wrap);
  line("", "", S.default, S.default);
  line("About this file", "", S.label, S.default);
  for (const n of wb.notes) line("", n, S.default, S.wrap);
  if (wb.lane === "people") {
    line("", "This file names people. It is for the church's own use: keep it private, do not send it to another platform, and delete it when you no longer need it.", S.default, S.wrap);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}" xmlns:r="${REL}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" tabSelected="1" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="90" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}${PAGE_SETUP.replace('orientation="landscape"', 'orientation="portrait"')}${headerFooter(wb)}</worksheet>`;
  return { name, xml, tableXml: null, table: null };
}

function dictionarySheet(wb: Workbook, name: string, strings: Strings): SheetOut {
  const head = ["Tab", "Column", "Kind of value", "What it means"];
  const rows: string[] = [];
  rows.push(`<row r="1" ht="24" customHeight="1">${head.map((h, i) => textCell(`${columnLetters(i)}1`, h, S.header, strings)).join("")}</row>`);
  let r = 1;
  for (const t of wb.tables) {
    for (const c of t.columns) {
      r += 1;
      rows.push(`<row r="${r}">${[t.sheet, c.label, TYPE_WORDS[c.type], c.about].map((v, i) => textCell(`${columnLetters(i)}${r}`, v, i === 3 ? S.wrap : S.text, strings)).join("")}</row>`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}" xmlns:r="${REL}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="4" width="90" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData>${PAGE_SETUP}${headerFooter(wb)}</worksheet>`;
  return { name, xml, tableXml: null, table: null };
}

/** The file. The same workbook always gives the same bytes. */
export function buildXlsx(wb: Workbook): Buffer {
  const strings = new Strings();
  const taken = new Set<string>();
  const aboutName = sheetName("About", taken);
  const sheets: SheetOut[] = [aboutSheet(wb, aboutName, strings)];
  let tableId = 0;
  for (const t of wb.tables) {
    if (!TABLE_NAME_OK.test(t.id)) throw new Error(`The table id "${t.id}" is not usable as a name`);
    const asTable = !t.grid && t.rows.length > 0 && t.columns.length > 0;
    sheets.push(dataSheet(t, wb, sheetName(t.sheet, taken), strings, asTable ? (tableId += 1) : null));
  }
  sheets.push(dictionarySheet(wb, sheetName("Dictionary", taken), strings));

  const parts: Part[] = [];
  const tables: { name: string; xml: string; sheetIndex: number }[] = [];
  sheets.forEach((s, i) => {
    parts.push({ name: `xl/worksheets/sheet${i + 1}.xml`, xml: s.xml });
    if (s.tableXml) {
      tables.push({ name: `xl/tables/table${tables.length + 1}.xml`, xml: s.tableXml, sheetIndex: i });
    }
  });

  const content =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    tables.map((t) => `<Override PartName="/${t.name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`).join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;

  // Headings repeat on every printed page of a table
  const names = sheets
    .map((s, i) => (s.table ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${s.name.replace(/'/g, "''")}'!$${HEAD_ROW}:$${HEAD_ROW}</definedName>` : ""))
    .join("");
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${REL}"><workbookPr defaultThemeVersion="124226"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000" activeTab="0"/></bookViews><sheets>` +
    sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    `</sheets>${names ? `<definedNames>${names}</definedNames>` : ""}</workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${sheets.length + 2}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;

  const made = wb.made.toISOString().replace(/\.\d+Z$/, "Z");
  const core =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(cleanText(wb.title, 120))}</dc:title><dc:creator>United Tribes</dc:creator><dc:description>${esc(`Made for ${cleanText(wb.by, 80)}. File ${wb.exportId}.`)}</dc:description>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${made}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${made}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>United Tribes</Application></Properties>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(content) },
    { name: "_rels/.rels", data: Buffer.from(rootRels) },
    { name: "docProps/core.xml", data: Buffer.from(core) },
    { name: "docProps/app.xml", data: Buffer.from(app) },
    { name: "xl/workbook.xml", data: Buffer.from(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels) },
    { name: "xl/styles.xml", data: Buffer.from(STYLES) },
    ...parts.map((p) => ({ name: p.name, data: Buffer.from(p.xml) })),
    ...tables.map((t) => ({ name: t.name, data: Buffer.from(t.xml) })),
    ...tables.map((t) => ({
      name: `xl/worksheets/_rels/sheet${t.sheetIndex + 1}.xml.rels`,
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/table" Target="../tables/${t.name.split("/").pop()}"/></Relationships>`),
    })),
    // The shared strings come last: every sheet has been written by now, so the list is complete
    { name: "xl/sharedStrings.xml", data: Buffer.from(strings.xml()) },
  ];
  return writeZip(entries);
}
