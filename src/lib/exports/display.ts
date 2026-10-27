import { cleanDate, cleanDateTime, cleanPhone, cleanText } from "./guard";
import type { Cell, ColType } from "./model";

/** A cell as words, for the print view and the preview: what a person reads, not what the file stores. */
export function displayCell(v: Cell | undefined, type: ColType): string {
  if (v === null || v === undefined || v === "") return "";
  switch (type) {
    case "int": {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? String(Math.round(n)) : "";
    }
    case "decimal": {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : "";
    }
    case "percent": {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "";
    }
    case "date":
      return cleanDate(v) ?? "";
    case "datetime":
      return cleanDateTime(v) ?? "";
    case "yesno":
      return v === true || v === "true" || v === "Yes" ? "Yes" : v === false || v === "false" || v === "No" ? "No" : "";
    case "phone":
      return cleanPhone(v) ?? "";
    default:
      return cleanText(v, 2000);
  }
}

/** True for the columns whose numbers should line up on the right. */
export const isNumeric = (type: ColType): boolean => type === "int" || type === "decimal" || type === "percent";
