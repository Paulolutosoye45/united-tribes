import type { Lane, PackId } from "./types";

/**
 * What a file holds, before it is a file: typed tables. The Excel writer, the CSV writer and the print view all read this one shape, so
 * what is on the screen, in the spreadsheet and on paper cannot differ. Every column says what kind of value it holds and what it means;
 * that is what makes a number a number in Excel and gives the data dictionary its text.
 */

/**
 * text     a short, plain value (a name of a community, a status). Guarded in every file.
 * free     something a person wrote. Allowed in an Excel file, never in a CSV.
 * int      a whole number.   decimal  a number with decimals.   percent  a share from 0 to 1, shown as a percentage.
 * date     a day.            datetime a moment, shown in Lagos time.
 * yesno    Yes or No (true or false in a CSV).     phone  a phone number, always kept as text.
 */
export type ColType = "text" | "free" | "int" | "decimal" | "percent" | "date" | "datetime" | "yesno" | "phone";

export type Cell = string | number | boolean | null;

export type Column = {
  key: string;
  label: string;
  type: ColType;
  /** In the data dictionary: what the column means, in a sentence. */
  about: string;
  /** Width in characters, for a spreadsheet and the print view. */
  width?: number;
};

export type Table = {
  /** Lower-case letters, digits and underscores. Becomes the Excel table's name and the CSV file's name. */
  id: string;
  /** The tab's name (31 characters at most). */
  sheet: string;
  title: string;
  /** A line under the title: what this table is. */
  caption?: string;
  columns: Column[];
  rows: Cell[][];
  /** A table drawn as a grid to fill in (the attendance register): thin borders on every cell and no filter buttons. */
  grid?: boolean;
};

export type Workbook = {
  pack: PackId;
  packName: string;
  lane: Lane;
  title: string;
  /** Under the title on the first tab: the tribe, the season, the community. */
  subtitle: string | null;
  made: Date;
  /** The person it was made for, as the church names them. */
  by: string;
  role: string;
  /** The reason a People file was made for, in words. */
  purpose: string | null;
  exportId: string;
  /** True while the pack is in Rehearsal: every tab says so. */
  rehearsal: boolean;
  tables: Table[];
  /** Lines for the About tab: what is in the file and what has been left out and why. */
  notes: string[];
  /** Facts about the file for the About tab, in order. */
  facts: [string, string][];
};

export const col = {
  text: (key: string, label: string, about: string, width = 22): Column => ({ key, label, about, type: "text", width }),
  free: (key: string, label: string, about: string, width = 40): Column => ({ key, label, about, type: "free", width }),
  int: (key: string, label: string, about: string, width = 12): Column => ({ key, label, about, type: "int", width }),
  decimal: (key: string, label: string, about: string, width = 12): Column => ({ key, label, about, type: "decimal", width }),
  percent: (key: string, label: string, about: string, width = 12): Column => ({ key, label, about, type: "percent", width }),
  date: (key: string, label: string, about: string, width = 14): Column => ({ key, label, about, type: "date", width }),
  datetime: (key: string, label: string, about: string, width = 18): Column => ({ key, label, about, type: "datetime", width }),
  yesno: (key: string, label: string, about: string, width = 10): Column => ({ key, label, about, type: "yesno", width }),
  phone: (key: string, label: string, about: string, width = 18): Column => ({ key, label, about, type: "phone", width }),
};

/** "Alpha Tribe, 27 October 2026" safe for a file name: lower case, letters and digits joined by dashes. */
export function slug(text: string, max = 40): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036F]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "") || "file"
  );
}

/** The day a file was made, in Lagos, as "2026-10-27". */
export function lagosDay(d: Date): string {
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);
}

/** The words for a yes/no. */
export const yesNo = (v: unknown): string => (v === true || v === "true" || v === "Yes" ? "Yes" : v === false || v === "false" || v === "No" ? "No" : "");
