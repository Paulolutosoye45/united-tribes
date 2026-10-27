import { cleanDate, cleanDateTime, cleanPhone, cleanText, needsGuard } from "./guard";
import type { Cell, ColType, Column, Table } from "./model";

/**
 * The CSV a reporting tool reads. Typed by column: a number is written as a number, a date as a day, a phone number only if it looks like
 * one, and a text that could be taken for a formula gets a leading apostrophe. Free text (something a person wrote) is never in a CSV:
 * its column is left out, so a feed can never carry what a member or a leader typed.
 */

const BOM = "\uFEFF";

export const csvColumns = (t: Table): { column: Column; index: number }[] =>
  t.columns.map((column, index) => ({ column, index })).filter(({ column }) => column.type !== "free");

function quote(s: string): string {
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One value as CSV text, by its column's type. Never throws: a value that does not fit its type is left empty. */
export function csvValue(v: Cell | undefined, type: ColType): string {
  if (v === null || v === undefined) return "";
  switch (type) {
    case "int":
    case "decimal":
    case "percent": {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (!Number.isFinite(n)) return "";
      return type === "int" ? String(Math.round(n)) : String(Math.round(n * 10_000) / 10_000);
    }
    case "date":
      return cleanDate(v) ?? "";
    case "datetime":
      return cleanDateTime(v) ?? "";
    case "yesno":
      return v === true || v === "true" || v === "Yes" ? "true" : v === false || v === "false" || v === "No" ? "false" : "";
    case "phone":
      return cleanPhone(v) ?? "";
    default: {
      const s = cleanText(v, 300);
      return needsGuard(s) ? `'${s}` : s;
    }
  }
}

/** A table as a CSV: the machine names as the header, CRLF line ends, UTF-8 with a mark at the start so Excel reads it correctly. */
export function toCsv(t: Table): string {
  const cols = csvColumns(t);
  const lines = [cols.map(({ column }) => quote(column.key)).join(",")];
  for (const row of t.rows) lines.push(cols.map(({ column, index }) => quote(csvValue(row[index], column.type))).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
