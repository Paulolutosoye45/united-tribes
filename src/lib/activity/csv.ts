import { describeAction } from "@/lib/god/wording";
import type { AuditRow } from "./types";

// The audit trail as a spreadsheet file. Any cell that starts with a character a spreadsheet would read as a formula gets a
// quote mark put in front, so a name such as "=HYPERLINK(...)" is shown as text and never run.

export const GROUP_WORDS: Record<string, string> = {
  member: "Member",
  young: "Young member",
  leader: "Leader",
  team: "Admin or care team",
  pastoral: "Pastor or director",
  system: "The system",
  you: "You",
};

export const groupWords = (g: string) => GROUP_WORDS[g] ?? g;

export const CSV_COLUMNS = ["When (Lagos time)", "Who", "Group", "What happened", "Action", "Area", "Item", "Reference"] as const;

/** One cell, quoted when it needs to be, and made safe against formulas. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Lagos is one hour ahead of UTC all year, so the time is the UTC time plus an hour. */
export function lagosStamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

/** The whole file: a header, then a row for each event. Never any wording of messages or answers (the log holds none). */
export function auditCsv(rows: AuditRow[]): string {
  const lines = [CSV_COLUMNS.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [lagosStamp(r.at), r.who, groupWords(r.group), describeAction(r.action), r.action, r.area, r.entity, r.ref].map(csvCell).join(","),
    );
  }
  // A byte-order mark so a spreadsheet opens accents and apostrophes correctly; lines end the way spreadsheets expect.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** The file name, with the day it was made (Lagos time). */
export function auditFileName(nowIso: string): string {
  return `united-tribes-audit-${lagosStamp(nowIso).slice(0, 10)}.csv`;
}
