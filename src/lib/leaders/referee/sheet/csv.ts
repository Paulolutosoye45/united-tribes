import type { SheetRow } from "./xlsx";

/**
 * A list saved as .csv from Excel, Google Sheets or Numbers. Handles quotes, commas inside quotes, line breaks inside quotes,
 * a semicolon or tab instead of a comma (Excel in some regions), a byte-order mark, and the older Windows text encoding.
 */

export function decodeText(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
  } catch {
    // Not UTF-8: an older Excel on Windows wrote it in Windows-1252
    return new TextDecoder("windows-1252").decode(bytes.subarray(start));
  }
}

/** The separator the first line uses most, outside quotes. */
export function sniffDelimiter(text: string): "," | ";" | "\t" | "|" {
  const first = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  let quoted = false;
  const count: Record<string, number> = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  for (const ch of first) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in count) count[ch] += 1;
  }
  const best = (Object.entries(count).sort((a, b) => b[1] - a[1])[0] ?? [","])[0];
  return (count[best] > 0 ? best : ",") as "," | ";" | "\t" | "|";
}

export function parseCsv(text: string, delimiter: string = sniffDelimiter(text)): SheetRow[] {
  const rows: SheetRow[] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  let line = 0;
  const endRow = () => {
    row.push(cell);
    cell = "";
    line += 1;
    if (row.some((c) => c.trim() !== "")) rows.push({ line, cells: row });
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

const FORMULA = /^[=+\-@\t\r]/;

/** A cell for a .csv a person will open in Excel: quoted when it must be, and never read as a formula. */
export function csvCell(value: string): string {
  let v = value ?? "";
  if (FORMULA.test(v)) v = ` ${v}`;
  return /[",\r\n;]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
}

/** With a byte-order mark, so Excel reads the accents and apostrophes in names correctly. */
export function writeCsv(header: string[], rows: string[][]): Buffer {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join("\r\n") + "\r\n", "utf8")]);
}
