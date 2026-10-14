import type { PlanAction, PlanCounts, PlanRow, Preview } from "./types";

/** What the upload screen needs to decide, kept apart from the screen so it can be tested. */

/** A phone has to get the file to the server: most hosts stop a request at about 4.5 MB, and a list of people is a few hundred kilobytes. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const ACCEPT = /\.(xlsx|xlsm|csv|txt)$/i;

export function fileProblem(file: { name: string; size: number }): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "That file is too large. A list of people should be well under 4 MB. Remove any pictures from the sheet, or split the list.";
  if (/\.xls$/i.test(file.name)) return "That is an older Excel file (.xls). Open it, choose Save As, and pick Excel Workbook (.xlsx) or CSV. Then choose it again.";
  if (/\.(pdf|docx?|png|jpe?g|gif|zip|pptx?)$/i.test(file.name)) return "That isn’t a spreadsheet. Choose an Excel (.xlsx) or CSV file.";
  if (!ACCEPT.test(file.name)) return "Choose an Excel (.xlsx) or CSV file.";
  return null;
}

/** The database stops a "replace" that would take more than this many people off the list unless it was meant. The same sum, so the screen asks first. */
export function retireLimit(activeNow: number): number {
  return Math.max(5, Math.round(activeNow * 0.4));
}
export const needsRetireConfirm = (counts: Pick<PlanCounts, "retire">, activeNow: number) => counts.retire > retireLimit(activeNow);

/** The button's words: what pressing it will do. */
export function applyLabel(counts: PlanCounts): string {
  const parts: string[] = [];
  if (counts.add) parts.push(`add ${counts.add}`);
  if (counts.update) parts.push(`update ${counts.update}`);
  if (counts.retire) parts.push(`take ${counts.retire} off`);
  if (parts.length === 0) return "Nothing to change";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const nothingToDo = (counts: PlanCounts) => counts.add + counts.update + counts.retire === 0;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-NG")} ${n === 1 ? one : many}`;

/** One sentence for after an upload: what happened, in numbers a person can check. */
export function doneLine(counts: PlanCounts): string {
  const parts = [`${counts.add} added`, `${counts.update} updated`];
  if (counts.retire) parts.push(`${counts.retire} taken off the list`);
  if (counts.unchanged) parts.push(`${counts.unchanged} already up to date`);
  if (counts.error) parts.push(`${plural(counts.error, "row")} left out`);
  return parts.join(", ") + ".";
}

export type PreviewFilter = "all" | "problems" | "add" | "update" | "retire";

const GROUP: Record<PlanAction, Exclude<PreviewFilter, "all">> = { add: "add", update: "update", revive: "update", unchanged: "update", retire: "retire", error: "problems" };

export const filterRows = (rows: PlanRow[], filter: PreviewFilter) => (filter === "all" ? rows : rows.filter((r) => GROUP[r.action] === filter));

/** Problems first, then the rest in the order of the file, so what needs attention is never below the fold. */
export function orderRows(rows: PlanRow[]): PlanRow[] {
  const rank = (r: PlanRow) => (r.action === "error" ? 0 : r.action === "retire" ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || (a.line ?? 1e9) - (b.line ?? 1e9));
}

export const ACTION_WORD: Record<PlanAction, string> = {
  add: "New",
  update: "Updated",
  revive: "Back on the list",
  unchanged: "Unchanged",
  retire: "Taken off",
  error: "Can’t use",
};

/** What was read from the file, as the read endpoint answers. */
export type ReadFile = {
  name: string;
  type: "xlsx" | "csv";
  sheet: string;
  sheets: { name: string; people: number }[];
  headerLine: number;
  columns: { header: string; field: string }[];
  ignored: string[];
  skipped: { line: number; reason: string }[];
  rolesMissing: boolean;
  people: number;
};
export type ReadAnswer = { ok: true; file: ReadFile; roleTexts: Record<string, string>; clean: unknown[]; mode: "update" | "replace"; preview: Preview };
export type Failure = { ok: false; message: string };

export const COLUMN_WORD: Record<string, string> = {
  name: "Name",
  first: "First name",
  last: "Last name",
  role: "Role",
  unit: "Unit",
  note: "Note",
  phone: "Phone",
  email: "Email",
  contact: "Phone or email",
  active: "On the list?",
};
