import { decisionLine, longDay, moved, num, shortDay } from "./format";
import type { Brief } from "./types";

// The weekly brief: fixed rules turn the numbers into short sentences. Nothing is written by a language model, nothing is sent
// anywhere (not by WhatsApp, not by email): the owner reads it on screen and may copy it as text.

const ROWS: { key: string; label: string }[] = [
  { key: "registered", label: "New sign-ups" },
  { key: "form_submitted", label: "Forms submitted" },
  { key: "placed", label: "Members placed in a tribe" },
  { key: "messages_failed", label: "Messages that failed" },
];

export type BriefLine = { label: string; now: number; prev: number; text: string };

/** The five numbers, each with how it moved from the week before. */
export function briefLines(b: Brief): BriefLine[] {
  const rows: { label: string; now: number; prev: number }[] = [
    { label: "People active", now: b.active?.now ?? 0, prev: b.active?.prev ?? 0 },
    ...ROWS.map((r) => ({ label: r.label, now: b.numbers?.[r.key]?.now ?? 0, prev: b.numbers?.[r.key]?.prev ?? 0 })),
  ];
  return rows.map((r) => {
    const m = moved(r.now, r.prev);
    return { ...r, text: `${r.label}: ${num(r.now)} (${m.text})` };
  });
}

/** The week's heading, such as "Week of 5 Oct to 11 Oct 2026". */
export function briefHeading(b: Brief): string {
  return `Week of ${shortDay(b.week_start)} to ${longDay(b.week_end)}`;
}

/** The whole brief as plain text, for the "Copy as text" button. */
export function buildBrief(b: Brief): string {
  const lines = [
    "United Tribes: weekly brief",
    briefHeading(b),
    "",
    ...briefLines(b).map((l) => l.text),
    "",
  ];
  if (b.decisions.length === 0) {
    lines.push("Nothing needs a decision this week.");
  } else {
    lines.push("Needs a decision");
    b.decisions.slice(0, 3).forEach((d, i) => {
      lines.push(`${i + 1}. ${decisionLine(d)}.`);
      lines.push(`   ${d.action} (${d.href})`);
    });
  }
  lines.push("", "Counts only: no names, no messages.");
  return lines.join("\n");
}
