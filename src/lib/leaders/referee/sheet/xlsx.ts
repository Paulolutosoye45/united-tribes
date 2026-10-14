import { readZip, writeZip, ZipError } from "./zip";

/**
 * Reading and writing the one kind of spreadsheet this church uses: a list of people on a single sheet.
 * The reader copes with what Excel, Google Sheets, Numbers and LibreOffice each write (shared strings, inline strings, numbers stored
 * where a phone number was typed, hidden sheets). The writer makes a plain, clean workbook with the phone column kept as text so
 * that Excel never strips a leading zero.
 */

export type SheetRow = { line: number; cells: string[] };
export type Sheet = { name: string; rows: SheetRow[] };

const decode = (text: string) =>
  text
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function safeChar(code: number) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** The text of a run of <t> elements, ignoring phonetic hints. */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += decode(m[1] ?? "");
  return out;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) out.push(textOf(m[1] ?? ""));
  return out;
}

/** "A" is 0, "Z" is 25, "AA" is 26. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A number as a person typed it: no exponent, no ".0", whole numbers kept whole (a phone number stored as a number). */
export function numberText(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^-?\d+$/.test(t)) return t;
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return BigInt(n).toString();
  // 15 significant digits is all a spreadsheet keeps
  return String(Number(n.toPrecision(15)));
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? decode(m[1]) : null;
}

function readSheet(xml: string, strings: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  let auto = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    auto += 1;
    const line = Number(attr(rm[1], "r")) || auto;
    auto = line;
    const cells: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], "r");
      const at = ref ? columnIndex(/^[A-Za-z]+/.exec(ref)?.[0] ?? "A") : next;
      next = at + 1;
      const type = attr(cm[1], "t");
      const body = cm[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "inlineStr") value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (v === undefined) value = "";
      else if (type === "s") value = strings[Number(v)] ?? "";
      else if (type === "str") value = decode(v);
      else if (type === "b") value = v.trim() === "1" ? "TRUE" : "FALSE";
      else if (type === "e") value = "";
      else value = numberText(decode(v));
      while (cells.length < at) cells.push("");
      cells[at] = value;
    }
    if (cells.some((c) => c.trim() !== "")) rows.push({ line, cells });
  }
  return rows;
}

/** Every visible sheet, in order. */
export function readXlsx(buffer: Buffer): Sheet[] {
  const files = readZip(buffer);
  const text = (name: string) => files.get(name)?.toString("utf8");
  const book = text("xl/workbook.xml");
  if (!book) throw new ZipError("This doesn’t look like an Excel file. Save the list as .xlsx or .csv and try again.");
  const rels = text("xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const strings = sharedStrings(text("xl/sharedStrings.xml"));

  const sheets: Sheet[] = [];
  for (const m of book.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const state = attr(m[1], "state");
    if (state === "hidden" || state === "veryHidden") continue;
    const name = attr(m[1], "name") ?? `Sheet ${sheets.length + 1}`;
    const rid = attr(m[1], "r:id") ?? attr(m[1], "id");
    const path = (rid && targets.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = text(path);
    if (xml === undefined) continue;
    sheets.push({ name, rows: readSheet(xml, strings) });
  }
  if (sheets.length === 0) throw new ZipError("We couldn’t find any sheet with people on it in this file.");
  return sheets;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // characters XML cannot hold
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

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

export type OutSheet = {
  name: string;
  header: string[];
  rows: string[][];
  /** Column widths in characters. */
  widths?: number[];
  /** A drop-down list on one column, for the rows that exist and for a hundred blank rows below. */
  choices?: { column: number; values: string[] };
  /** Text-only rows (a how-to): drawn without a header. */
  plain?: boolean;
  /** Rows to show in grey italics (an example the person should delete). */
  mutedRows?: number[];
};

function cell(ref: string, value: string, style: number) {
  if (value === "") return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(s: OutSheet): string {
  const cols = s.header.length || Math.max(1, ...s.rows.map((r) => r.length));
  const widths = s.widths ?? Array.from({ length: cols }, () => 20);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  out.push(`<sheetViews><sheetView workbookViewId="0"${s.plain ? "" : ' tabSelected="1"'}>${s.plain ? "" : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'}</sheetView></sheetViews>`);
  out.push('<sheetFormatPr defaultRowHeight="18"/>');
  out.push(`<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${s.plain ? ' style="5"' : ""}/>`).join("")}</cols>`);
  out.push("<sheetData>");
  let r = 0;
  if (!s.plain) {
    r += 1;
    out.push(`<row r="${r}" ht="24" customHeight="1">${s.header.map((h, i) => cell(`${columnLetters(i)}${r}`, h, 1)).join("")}</row>`);
  }
  s.rows.forEach((row, idx) => {
    r += 1;
    const muted = s.mutedRows?.includes(idx);
    out.push(
      `<row r="${r}">${row
        .map((v, i) => cell(`${columnLetters(i)}${r}`, v, s.plain ? (idx === 0 ? 4 : 5) : muted ? 3 : 2))
        .join("")}</row>`,
    );
  });
  out.push("</sheetData>");
  if (!s.plain && s.rows.length + 1 > 1) out.push(`<autoFilter ref="A1:${columnLetters(cols - 1)}${s.rows.length + 1}"/>`);
  if (s.choices) {
    const col = columnLetters(s.choices.column);
    const list = esc(s.choices.values.join(","));
    out.push(
      `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="warning" errorTitle="Role" error="Use Pastor, Unit head or Ministry leader." sqref="${col}2:${col}${Math.max(s.rows.length + 1, 1) + 200}"><formula1>"${list}"</formula1></dataValidation></dataValidations>`,
    );
  }
  out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  out.push("</worksheet>");
  return out.join("");
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><i/><sz val="11"/><color rgb="FF8A8A8A"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F1B2E"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Excel expects a hidden name for each sheet that has a filter. */
function filters(sheets: OutSheet[], safe: (n: string, i: number) => string): string {
  const names = sheets
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.plain && s.rows.length > 0)
    .map(({ s, i }) => {
      const cols = s.header.length || 1;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${safe(s.name, i).replace(/'/g, "''")}'!$A$1:$${columnLetters(cols - 1)}$${s.rows.length + 1}</definedName>`;
    });
  return names.length ? `<definedNames>${names.join("")}</definedNames>` : "";
}

export function writeXlsx(sheets: OutSheet[]): Buffer {
  const safe = (n: string, i: number) => esc(n.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`);
  const files = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets
          .map((s, i) => `<sheet name="${safe(s.name, i)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("")}</sheets>${filters(sheets, safe)}</workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: "xl/styles.xml", data: Buffer.from(STYLES) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetXml(s)) })),
  ];
  return writeZip(files);
}
