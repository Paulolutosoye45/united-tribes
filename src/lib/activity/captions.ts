import { WEEKDAY_NAMES, hourLabel, hoursText, num, showWords } from "./format";
import type { Cell, Funnel, Heatmap, Pulse, Retention } from "./types";

// One plain sentence under each chart, written by fixed rules from the same numbers the chart draws. A caption never states
// a number the database hid: it says there is not enough to say.

const isNum = (v: unknown): v is number => typeof v === "number";

export function trendCaption(p: Pulse): string {
  const t = p.active;
  if (t.d30 === 0 && t.p30 === 0) return "Nobody has been recorded as active yet.";
  if (t.p30 === 0) return `${num(t.d30)} people were active in the last 30 days. There is no earlier month to compare with yet.`;
  const diff = t.d30 - t.p30;
  if (diff === 0) return `${num(t.d30)} people were active in the last 30 days, the same as the 30 days before.`;
  const pct = Math.round((Math.abs(diff) / t.p30) * 100);
  return `${num(t.d30)} people were active in the last 30 days, ${diff > 0 ? "up" : "down"} ${num(Math.abs(diff))} (${pct}%) from ${num(t.p30)} in the 30 days before.`;
}

/** The step where the most people stop between one bar and the next, among bars that are big enough to show. */
export function funnelCaption(f: Funnel): string {
  const stages = f.stages;
  if (stages.length < 2) return "There are not enough people in this period to draw a funnel.";
  let worst: { from: string; to: string; kept: number } | null = null;
  for (let i = 1; i < stages.length; i++) {
    const a = stages[i - 1].reached;
    const b = stages[i].reached;
    if (!isNum(a) || !isNum(b) || a < 5) continue;
    const kept = Math.round((b / a) * 100);
    if (!worst || kept < worst.kept) worst = { from: stages[i - 1].label, to: stages[i].label, kept };
  }
  const first = stages[0].reached;
  const lead = isNum(first) ? `${num(first)} ${f.which === "member" ? "people registered" : "people started"} in this period. ` : "";
  if (!worst) return `${lead}The later steps have fewer than 5 people, so the biggest drop cannot be shown.`;
  return `${lead}The biggest drop is between “${worst.from}” and “${worst.to}”: ${worst.kept}% of those who reached the first went on to the second.`;
}

export function finishCaption(f: Funnel): string {
  const fin = f.finish;
  if (!fin || fin.p50 === null) return "Fewer than 5 forms were finished in this period, so the time to finish is not shown.";
  const minutes = (s: number) => `${num(Math.round((s / 60) * 10) / 10)} min`;
  const slow = fin.p90 !== null ? ` Nine in ten finished within ${minutes(fin.p90)}.` : "";
  return `Half of the forms were finished within ${minutes(fin.p50)}.${slow}`;
}

export function heatCaption(h: Heatmap): string {
  let best: { dow: number; hour: number; people: number } | null = null;
  for (const c of h.cells) {
    if (!isNum(c.people)) continue;
    if (!best || c.people > best.people) best = { dow: c.dow, hour: c.hour, people: c.people };
  }
  if (!best) return "There is not enough activity in this period to show a busiest time.";
  return `The busiest time is ${WEEKDAY_NAMES[best.dow - 1]} around ${hourLabel(best.hour)} (Lagos time), with ${num(best.people)} different people in the last ${h.days} days.`;
}

export function retentionCaption(r: Retention): string {
  // The share still active one week after the week they joined, across weeks with a number to show.
  const ones: number[] = [];
  for (const w of r.weeks) {
    const c = w.cells[1];
    if (isNum(c)) ones.push(c);
  }
  if (ones.length === 0) return "Cohorts are still too small to show how many come back.";
  const mean = Math.round(ones.reduce((a, b) => a + b, 0) / ones.length);
  return `On average ${mean}% of the people who joined in a week were active again the week after.`;
}

export function compareCaption(rows: { label: string; members: Cell; active_pct: number | null }[]): string {
  const shown = rows.filter((r) => r.active_pct !== null);
  if (shown.length === 0) return "Every group here has fewer than 5 people, so no percentages are shown.";
  const sorted = [...shown].sort((a, b) => (b.active_pct ?? 0) - (a.active_pct ?? 0));
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  if (top.active_pct === low.active_pct) return `Every group shown has the same share active in the last 30 days (${top.active_pct}%).`;
  if (sorted.length === 1) return `${top.label} has ${top.active_pct}% active in the last 30 days (${showWords(top.members)} people).`;
  return `${top.label} has the most people active in the last 30 days (${top.active_pct}%) and ${low.label} the fewest (${low.active_pct}%).`;
}

export function responseCaption(hours: number | null): string {
  return hours === null ? "Not enough replies yet to say how long referees take." : `Referees take about ${hoursText(hours)} from link to answer, at the median.`;
}
