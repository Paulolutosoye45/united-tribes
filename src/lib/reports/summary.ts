import type { AiProvider } from "@/lib/ai/types";
import { WRITER_SYSTEM, writeText } from "@/lib/ai/write";
import { KPI_TITLES, formatKpi, reportPeriod, type Kpi, type ReportData, type ReportKind } from "@/lib/dashboard/insight";
import { pct } from "@/lib/dashboard/wording";
import type { WorkerRpc } from "@/lib/messaging/worker";

/**
 * The few sentences at the top of a report. They are written from the report's own figures, in plain words,
 * with no AI at all; when an AI is set up it may reword them, under the rules in lib/ai/write.ts (it sees the
 * counts only, never a testimony or a name, and any number it adds that we did not give it is thrown away).
 * Anyone who can read a report can replace the summary with their own words.
 */

export type SummaryInput = {
  id: string;
  kind: ReportKind;
  period_start: string;
  period_end: string;
  community: string | null;
  season?: string;
  data: ReportData;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const join = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The facts, one per line. This is also all an AI is ever shown. */
export function reportFacts(r: SummaryInput): string[] {
  const d = r.data;
  const h = d.headline;
  const w = d.window;
  const lines: string[] = [];
  const who = r.kind === "community" ? `The ${r.community ?? d.community?.name ?? "community"} community` : "The programme";
  const period = reportPeriod({ kind: r.kind, period_start: r.period_start, season: d.season.name });

  lines.push(`${period}, ${d.season.name}${d.season.before ? ", before the season begins" : d.season.over ? ", season over" : d.season.current_week ? `, week ${d.season.current_week} of ${d.season.weeks}` : ""}.`);
  lines.push(`${who} has ${plural(h.members, "member")}${h.tribes !== undefined ? ` in ${plural(h.tribes, "tribe")}` : d.tribes ? ` in ${plural(d.tribes.length, "tribe")}` : ""}.`);

  if (h.thriving_rate != null && h.thriving != null) {
    lines.push(`${plural(h.thriving, "member")} (${pct(h.thriving_rate)}) are thriving; the goal is ${pct(d.targets.thriving_rate)}.`);
  } else if (h.members > 0 && h.measured === false) {
    lines.push("It is too early in the season to say how many are thriving.");
  } else if (r.kind === "community" && h.members > 0 && h.members < d.targets.min_cell) {
    lines.push(`The community has fewer than ${d.targets.min_cell} members, so no rate is shown.`);
  }
  if (h.gain_share != null && h.gain_n) {
    lines.push(`${pct(h.gain_share)} of the ${h.gain_n} who answered gained ${d.targets.gain_min} points or more on their Success Picture.`);
  }
  if (w.meetings_held > 0) {
    lines.push(`In the month ${plural(w.meetings_held, "meeting")} were held${w.attendance_rate != null ? ` and ${pct(w.attendance_rate)} of members came` : ""}.`);
  }
  if (w.joined > 0) lines.push(`${plural(w.joined, "member")} joined a tribe.`);
  if (w.left > 0) lines.push(`${plural(w.left, "member")} left.`);

  const behind = (d.kpis ?? []).filter((k) => k.status === "behind");
  const met = (d.kpis ?? []).filter((k) => k.status === "met");
  if (d.kpis) {
    if (behind.length > 0) lines.push(`Behind target: ${join(behind.slice(0, 3).map((k) => `${lower(KPI_TITLES[k.key])} (${formatKpi(k.value, k.unit)} against ${formatKpi(k.target, k.unit)})`))}.`);
    if (met.length > 0) lines.push(`On target: ${join(met.slice(0, 3).map((k) => lower(KPI_TITLES[k.key])))}.`);
  }
  if (w.care_opened > 0 || w.care_open_now > 0) {
    lines.push(`${plural(w.care_opened, "care need")} opened and ${w.care_closed} closed; ${w.care_open_now} ${w.care_open_now === 1 ? "is" : "are"} open now.`);
  }
  if (d.watch.length > 0) lines.push(`Tribes to look at: ${join(d.watch.slice(0, 3).map((c) => c.name))}.`);
  if (w.testimonies_to_church > 0) lines.push(`${plural(w.testimonies_to_church, "testimony", "testimonies")} reached the whole church.`);
  return lines;
}

/** The plain version: the facts, read as a short paragraph. */
export function plainSummary(r: SummaryInput): string {
  const lines = reportFacts(r);
  const text = lines.slice(1).join(" ");
  return text.length > 1200 ? `${text.slice(0, 1197).trimEnd()}…` : text;
}

export async function summariseReport(r: SummaryInput, provider: AiProvider | null): Promise<{ text: string; by: "assistant" | "plain" }> {
  const draft = plainSummary(r);
  const result = await writeText(
    {
      purpose: "report_summary",
      system: `${WRITER_SYSTEM} You are writing the opening paragraph of a report on a church small-group programme, for the people who lead it. Four to six sentences: say what is going well, then what needs attention, honestly and kindly.`,
      facts: reportFacts(r).join("\n"),
      draft,
      maxChars: 900,
    },
    { provider },
  );
  return { text: result.text, by: result.ai ? "assistant" : "plain" };
}

/** Reads the database's list of reports without a summary, skipping any malformed row. */
export function readPending(data: unknown): SummaryInput[] {
  if (!Array.isArray(data)) return [];
  const out: SummaryInput[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.kind !== "string" || !r.data || typeof r.data !== "object") continue;
    if (!["programme", "pastorate", "community", "season"].includes(r.kind)) continue;
    const d = r.data as ReportData;
    if (!d.season || !d.headline || !d.window) continue;
    out.push({
      id: r.id,
      kind: r.kind as ReportKind,
      period_start: String(r.period_start ?? ""),
      period_end: String(r.period_end ?? ""),
      community: typeof r.community === "string" ? r.community : null,
      data: { ...d, watch: Array.isArray(d.watch) ? d.watch : [], kpis: Array.isArray(d.kpis) ? (d.kpis as Kpi[]) : undefined },
    });
  }
  return out;
}

/** Called by the heartbeat after the messages go out. Never throws; reports what it could not do. */
export async function writePendingSummaries(
  rpc: WorkerRpc,
  provider: AiProvider | null,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<{ written: number; problems: string[] }> {
  const now = opts.now ?? Date.now;
  const started = now();
  const out = { written: 0, problems: [] as string[] };
  try {
    const pending = await rpc("worker_pending_summaries");
    if (pending.error) {
      out.problems.push(`summaries: ${pending.error.message}`);
      return out;
    }
    for (const item of readPending(pending.data)) {
      if (opts.budgetMs !== undefined && now() - started > opts.budgetMs) break;
      const s = await summariseReport(item, provider);
      const set = await rpc("worker_set_summary", { p_report: item.id, p_summary: s.text, p_by: s.by });
      if (set.error) out.problems.push(`summary for a ${item.kind} report: ${set.error.message}`);
      else if (set.data === true) out.written++;
    }
  } catch (error) {
    out.problems.push(`summaries: ${error instanceof Error ? error.message : "failed"}`);
  }
  return out;
}
