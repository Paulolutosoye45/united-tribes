import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "@/lib/ai/types";
import {
  KPI_ORDER,
  KPI_TITLES,
  REPORT_KINDS,
  SUMMARY_BY,
  STATUS,
  formatKpi,
  formatTarget,
  kpiMeaning,
  kpiNote,
  kpisByNeed,
  reportPeriod,
  reportTitle,
  type AllTargets,
  type Kpi,
  type KpiKey,
  type ReportData,
} from "@/lib/dashboard/insight";
import { plainSummary, readPending, reportFacts, summariseReport, writePendingSummaries, type SummaryInput } from "@/lib/reports/summary";
import { TEMPLATES } from "@/lib/messaging/templates";
import { NAV, REPORT_ROLES, COMMUNITY_ROLES, navFor } from "@/lib/auth/roles";

const targets: AllTargets = {
  thriving_rate: 0.85,
  attend_share: 0.667,
  belonging_min: 4,
  gain_min: 2,
  effective_thriving: 0.8,
  effective_gain: 0.7,
  min_weeks: 3,
  min_cell: 5,
  min_answers: 5,
  retrain_after: 12,
  connect_days: 14,
  connect_days_season: 7,
  form_minutes: 10,
  form_completion: 0.8,
  ai_keep: 0.7,
  word_habit: 0.6,
  word_days_min: 4,
  care_resolved: 0.9,
  care_days: 7,
  assistants: 1,
  match_gap: 0.15,
  swap_weeks: 4,
};

const kpi = (key: KpiKey, over: Partial<Kpi> = {}): Kpi => ({
  key,
  objective: key,
  value: 0.5,
  target: 0.8,
  dir: "min",
  n: 10,
  unit: "rate",
  status: "behind",
  ...over,
});

describe("the objectives in words", () => {
  it("has a title for every row and a meaning that names the target in use", () => {
    for (const key of KPI_ORDER) {
      expect(KPI_TITLES[key]).toBeTruthy();
      expect(kpiMeaning(kpi(key), targets).length).toBeGreaterThan(20);
    }
    expect(kpiMeaning(kpi("belong"), targets)).toContain("67%");
    expect(kpiMeaning(kpi("goal"), targets)).toContain("2 points");
    expect(kpiMeaning(kpi("goal"), { ...targets, gain_min: 3 })).toContain("3 points");
    expect(kpiMeaning(kpi("care"), { ...targets, care_days: 5 })).toContain("within 5 days");
  });

  it("writes values the way people say them", () => {
    expect(formatKpi(0.847, "rate")).toBe("85%");
    expect(formatKpi(1, "days")).toBe("1 day");
    expect(formatKpi(9.5, "days")).toBe("9.5 days");
    expect(formatKpi(12, "minutes")).toBe("12 min");
    expect(formatKpi(1.25, "ratio")).toBe("1.3 per tribe");
    expect(formatKpi(0.21, "gap")).toBe("+21 points");
    expect(formatKpi(-0.04, "gap")).toBe("−4 points");
    expect(formatKpi(null, "rate")).toBe("–");
  });

  it("says which way a target points", () => {
    expect(formatTarget(kpi("belong", { target: 0.85 }))).toBe("85% or more");
    expect(formatTarget(kpi("connect", { target: 14, unit: "days", dir: "max" }))).toBe("14 days or fewer");
    expect(formatTarget(kpi("belong", { target: null }))).toBe("");
  });

  it("puts what is behind first, then close, then too early, then met; ties keep the programme's order", () => {
    const rows = [kpi("connect", { status: "met" }), kpi("word", { status: "na" }), kpi("care", { status: "close" }), kpi("goal", { status: "behind" }), kpi("belong", { status: "behind" })];
    expect(kpisByNeed(rows).map((k) => k.key)).toEqual(["belong", "goal", "care", "word", "connect"]);
    // the input is not changed
    expect(rows[0].key).toBe("connect");
  });

  it("adds the small print only where there is something behind the number", () => {
    expect(kpiNote(kpi("word", { coverage: 0.62 }), targets)).toBe("62% of members have reported");
    expect(kpiNote(kpi("care", { urgent: 0 }), targets)).toBe("");
    expect(kpiNote(kpi("care", { urgent: 3, urgent_same_day: 2 }), targets)).toBe("2 of 3 urgent needs answered the same day");
    expect(kpiNote(kpi("multiply", { certified: 2, n: 5 }), targets)).toBe("2 of 5 tribes");
    expect(kpiNote(kpi("match", { high_rate: 0.9, low_rate: 0.6 }), targets)).toContain("90% thriving at 85%+");
    expect(kpiNote(kpi("match", { high_n: 6, low_n: 3 }), targets)).toBe("Shown once both groups have 5 members (now 6 and 3)");
    expect(kpiNote(kpi("belong", { measured: false }), targets)).toBe("Shown after 3 weeks");
    expect(kpiNote(kpi("ai_keep", { lowest_field: "meeting_times" }), targets)).toBe("Lowest: meeting times");
    expect(kpiNote(kpi("form_completion", { started: 20, finished: 17 }), targets)).toBe("17 of 20 who started");
  });

  it("has a badge for every status", () => {
    expect(Object.keys(STATUS).sort()).toEqual(["behind", "close", "met", "na"]);
  });
});

describe("naming a report", () => {
  it("says the month for a monthly report and the season's name for a season report", () => {
    expect(reportPeriod({ kind: "programme", period_start: "2026-09-01", season: "Season 1" })).toBe("September 2026");
    expect(reportPeriod({ kind: "pastorate", period_start: "2027-01-01", season: "Season 2" })).toBe("January 2027");
    expect(reportPeriod({ kind: "season", period_start: "2026-08-03", season: "Season 1" })).toBe("Season 1");
  });

  it("titles a community report with its community", () => {
    expect(reportTitle({ kind: "community", community: "Marriage" })).toBe("Marriage report");
    expect(reportTitle({ kind: "pastorate", community: null })).toBe(REPORT_KINDS.pastorate.title);
  });

  it("says who wrote a summary", () => {
    expect(SUMMARY_BY.edited).toBe("Edited by a person.");
    expect(SUMMARY_BY.assistant).toContain("assistant");
    expect(SUMMARY_BY.plain).not.toContain("assistant");
  });
});

describe("who can see the pages", () => {
  it("shows Reports to the office and champions, and My community to champions", () => {
    expect(REPORT_ROLES).toEqual(expect.arrayContaining(["admin", "director", "pastor", "data_lead", "community_champion"]));
    expect(COMMUNITY_ROLES).toEqual(expect.arrayContaining(["community_champion", "pastor", "director"]));
    const champion = navFor(["member", "community_champion"]).map((n) => n.href);
    expect(champion).toContain("/community");
    expect(champion).toContain("/reports");
    const member = navFor(["member"]).map((n) => n.href);
    expect(member).not.toContain("/community");
    expect(member).not.toContain("/reports");
    expect(NAV.filter((n) => n.href === "/reports")).toHaveLength(1);
  });
});

describe("the report-ready message", () => {
  const t = TEMPLATES.report_ready;
  it("exists, goes to the office, and points at the report", () => {
    expect(t).toBeTruthy();
    expect(t?.audience).toBe("office");
    expect(t.email({ title: "The pastorate one-pager", period: "September 2026", report_id: "abc" }, { first: "Femi", link: (path: string) => `https://ut.example${path}` } as never).cta?.url).toBe("https://ut.example/reports/abc");
  });
});

// ---------------------------------------------------------------------------
// The summary writer
// ---------------------------------------------------------------------------

const data = (over: Partial<ReportData> = {}): ReportData => ({
  kind: "pastorate",
  as_of: "2026-10-01",
  period: { start: "2026-09-01", end: "2026-09-30" },
  season: { id: "s1", name: "Season 1", starts_on: "2026-08-03", ends_on: "2026-10-25", weeks: 12, current_week: 9, over: false, before: false },
  targets,
  headline: { members: 40, tribes: 4, measured: true, thriving: 30, thriving_rate: 0.75, gain_n: 20, gain_share: 0.6 },
  window: {
    meetings_held: 16, present: 120, possible: 160, attendance_rate: 0.75, joined: 2, left: 1, forms_finished: 3,
    care_opened: 4, care_closed: 3, care_open_now: 1, urgent_opened: 0, testimonies_new: 2, testimonies_to_church: 1,
  },
  testimonies: [],
  watch: [],
  ...over,
});

const input = (over: Partial<SummaryInput> = {}, d: Partial<ReportData> = {}): SummaryInput => ({
  id: "r1",
  kind: "pastorate",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  community: null,
  data: data(d),
  ...over,
});

describe("the plain summary of a report", () => {
  it("reads the figures as sentences, with only numbers the report holds", () => {
    const text = plainSummary(input());
    expect(text).toContain("40 members in 4 tribes");
    expect(text).toContain("30 members (75%) are thriving; the goal is 85%");
    expect(text).toContain("60% of the 20 who answered gained 2 points or more");
    expect(text).toContain("16 meetings were held and 75% of members came");
    expect(text).toContain("2 members joined a tribe");
    expect(text).toContain("1 member left");
    expect(text).toContain("4 care needs opened and 3 closed; 1 is open now");
    expect(text).toContain("1 testimony reached the whole church");
    expect(text).not.toMatch(/undefined|NaN|null/);
  });

  it("is honest when it is too early, and when a community is too small for a rate", () => {
    const early = plainSummary(input({}, { headline: { members: 40, tribes: 4, measured: false, thriving_rate: null } }));
    expect(early).toContain("too early in the season");
    const small = plainSummary(input({ kind: "community", community: "Marriage" }, { headline: { members: 3, measured: true, thriving_rate: null } }));
    expect(small).toContain("fewer than 5 members");
    expect(small).not.toContain("thriving");
  });

  it("names what is behind target and what is met", () => {
    const text = plainSummary(
      input({}, {
        kpis: [
          kpi("care", { value: 0.5, target: 0.9, status: "behind" }),
          kpi("belong", { value: 0.9, target: 0.85, status: "met" }),
          kpi("word", { status: "na", value: null }),
        ],
      }),
    );
    expect(text).toContain("Behind target: care done in time (50% against 90%)");
    expect(text).toContain("On target: members thriving");
    expect(text).not.toContain("in the word");
  });

  it("lists tribes to look at, at most three", () => {
    const watch = ["A", "B", "C", "D"].map((n) => ({ name: `Tribe ${n}`, leader: "L", community: null, members: 6, attendance_rate: 0.4, thriving_rate: 0.2, verdict: "at_risk" }));
    expect(plainSummary(input({}, { watch }))).toContain("Tribes to look at: Tribe A, Tribe B and Tribe C.");
  });

  it("stays within about twelve hundred characters", () => {
    const kpis = KPI_ORDER.map((k) => kpi(k, { status: "behind" }));
    const watch = Array.from({ length: 8 }, (_, i) => ({ name: `A long tribe name ${i}`, leader: "L", community: null, members: 6, attendance_rate: 0.4, thriving_rate: 0.2, verdict: "at_risk" }));
    expect(plainSummary(input({}, { kpis, watch })).length).toBeLessThanOrEqual(1200);
  });

  it("gives the community's name for a community report", () => {
    const f = reportFacts(input({ kind: "community", community: "Marriage" }, { tribes: [] }));
    expect(f[1]).toMatch(/^The Marriage community has 40 members/);
  });
});

const provider = (text: string | Error, spy = vi.fn()): AiProvider => ({
  name: "fake",
  model: "fake-1",
  suggest: async () => ({ suggestions: [] }),
  write: async (i) => {
    spy(i);
    if (text instanceof Error) throw text;
    return { text };
  },
});

describe("summariseReport", () => {
  it("is plain without an AI, and uses the AI when its answer only repeats the report's numbers", async () => {
    const plain = await summariseReport(input(), null);
    expect(plain.by).toBe("plain");
    const spy = vi.fn();
    const ai = await summariseReport(input(), provider("Thirty of the forty members are thriving, which is 75%.", spy));
    expect(ai).toEqual({ text: "Thirty of the forty members are thriving, which is 75%.", by: "assistant" });
    // the AI is shown counts only: no testimony text, no names
    expect(spy.mock.calls[0][0].user).not.toMatch(/testimon.*“|@/);
  });

  it("falls back to the plain text when the AI invents a figure or fails", async () => {
    const made = await summariseReport(input(), provider("Ninety members are thriving."));
    expect(made.by).toBe("plain");
    expect(made.text).toBe(plainSummary(input()));
    expect((await summariseReport(input(), provider(new Error("down")))).by).toBe("plain");
  });
});

describe("reading the list of reports waiting for a summary", () => {
  it("skips rows that are not reports", () => {
    const good = { id: "r1", kind: "community", period_start: "2026-09-01", period_end: "2026-09-30", community: "Marriage", data: data() };
    const rows = readPending([good, null, "x", { id: 3 }, { ...good, kind: "weekly" }, { ...good, data: {} }, { ...good, id: "r2", data: { ...data(), watch: undefined } }]);
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(rows[1].data.watch).toEqual([]);
    expect(readPending(undefined)).toEqual([]);
    expect(readPending({ queued: 1 })).toEqual([]);
  });
});

describe("writePendingSummaries", () => {
  const pending = [1, 2, 3].map((i) => ({ id: `r${i}`, kind: "programme", period_start: "2026-09-01", period_end: "2026-09-30", community: null, data: data() }));

  it("writes each summary and counts the ones the database took", async () => {
    const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "worker_pending_summaries") return { data: pending, error: null };
      return { data: args?.p_report !== "r2", error: null }; // r2 was written by someone else in the meantime
    });
    const out = await writePendingSummaries(rpc as never, null);
    expect(out).toEqual({ written: 2, problems: [] });
    expect(rpc).toHaveBeenCalledWith("worker_set_summary", expect.objectContaining({ p_report: "r1", p_by: "plain" }));
  });

  it("stops when the time budget is spent", async () => {
    let clock = 0;
    const rpc = vi.fn(async (fn: string) => (fn === "worker_pending_summaries" ? { data: pending, error: null } : { data: true, error: null }));
    const out = await writePendingSummaries(rpc as never, null, { budgetMs: 100, now: () => (clock += 60) });
    expect(out.written).toBeLessThan(3);
    expect(out.written).toBeGreaterThan(0);
  });

  it("reports a fault instead of throwing", async () => {
    const down = vi.fn(async () => ({ data: null, error: { message: "no route" } }));
    expect(await writePendingSummaries(down as never, null)).toEqual({ written: 0, problems: ["summaries: no route"] });
    const thrown = vi.fn(async () => {
      throw new Error("socket closed");
    });
    expect(await writePendingSummaries(thrown as never, null)).toEqual({ written: 0, problems: ["summaries: socket closed"] });
    const partial = vi.fn(async (fn: string) => (fn === "worker_pending_summaries" ? { data: pending.slice(0, 1), error: null } : { data: null, error: { message: "denied" } }));
    const out = await writePendingSummaries(partial as never, null);
    expect(out.written).toBe(0);
    expect(out.problems).toEqual(["summary for a programme report: denied"]);
  });
});
