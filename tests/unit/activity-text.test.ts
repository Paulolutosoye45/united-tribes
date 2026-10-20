import { describe, expect, it } from "vitest";
import { briefLines, buildBrief } from "@/lib/activity/brief";
import { compareCaption, finishCaption, funnelCaption, heatCaption, retentionCaption, trendCaption } from "@/lib/activity/captions";
import { CSV_COLUMNS, auditCsv, auditFileName, csvCell, lagosStamp } from "@/lib/activity/csv";
import { addDays, decisionLine, hoursText, isDay, lagosToday, metricText, moved, num, pctText, show, showWords } from "@/lib/activity/format";
import type { AuditRow, Brief, Funnel, Heatmap, Pulse, Retention } from "@/lib/activity/types";

const decision = (over: Partial<Brief["decisions"][number]> = {}) => ({
  key: "member_wait_days",
  label: "Members waiting more than 14 days for a tribe",
  value: 23,
  threshold: 14,
  unit: "days",
  action: "Open the people list, find who is waiting, and place or call them.",
  href: "/god/people",
  ...over,
});

const BRIEF: Brief = {
  week_start: "2026-10-05",
  week_end: "2026-10-11",
  active: { now: 42, prev: 37 },
  numbers: { registered: { now: 12, prev: 15 }, form_submitted: { now: 7, prev: 7 }, placed: { now: 5, prev: 0 }, messages_failed: { now: 2, prev: 1 } },
  decisions: [decision()],
};

describe("numbers and dates", () => {
  it("writes numbers the same on the server and in the browser", () => {
    expect(num(1234567)).toBe("1,234,567");
    expect(num(12.34)).toBe("12.3");
    expect(num(0)).toBe("0");
    expect(num(Number.NaN)).toBe("0");
    expect(show(5)).toBe("5");
    expect(show("<5")).toBe("<5");
    expect(show(null)).toBe("–");
    expect(showWords("<5")).toBe("fewer than 5");
    expect(showWords(12)).toBe("12");
    expect(pctText(41.5)).toBe("41.5%");
    expect(pctText(null)).toBe("–");
    expect(hoursText(0.5)).toBe("30 min");
    expect(hoursText(26)).toBe("26 h");
    expect(hoursText(72)).toBe("3 days");
  });

  it("says how a number moved, and claims nothing when a number is hidden", () => {
    expect(moved(42, 37)).toEqual({ text: "up 5 from 37", dir: "up" });
    expect(moved(3, 8)).toEqual({ text: "down 5 from 8", dir: "down" });
    expect(moved(7, 7).dir).toBe("same");
    expect(moved("<5", 8)).toEqual({ text: "", dir: "none" });
    expect(moved(8, "<5")).toEqual({ text: "", dir: "none" });
    expect(moved(null, 3).dir).toBe("none");
  });

  it("writes each kind of unit", () => {
    expect(metricText({ value: 80, unit: "percent" })).toBe("80%");
    expect(metricText({ value: 12.5, unit: "seconds" })).toBe("12.5 s");
    expect(metricText({ value: 2400, unit: "ms" })).toBe("2.4 s");
    expect(metricText({ value: 17, unit: "hour" })).toBe("17:00");
    expect(metricText({ value: "<5", unit: "count" })).toBe("<5");
    expect(metricText({ value: null, unit: "percent" })).toBe("not enough yet");
    expect(metricText({ value: 9, unit: "count" })).toBe("9");
  });

  it("works in Lagos days", () => {
    expect(lagosToday(Date.parse("2026-10-15T23:30:00Z"))).toBe("2026-10-16");
    expect(lagosToday(Date.parse("2026-10-15T22:59:00Z"))).toBe("2026-10-15");
    expect(addDays("2026-10-15", -89)).toBe("2026-07-18");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2026-10-15")).toBe(true);
    expect(isDay("15/10/2026")).toBe(false);
    expect(isDay(undefined)).toBe(false);
  });

  it("writes a decision as one line with its count", () => {
    expect(decisionLine(decision())).toBe("Members waiting more than 14 days for a tribe: 23");
    expect(decisionLine(decision({ unit: "percent", value: 31.2, label: "Sign-in codes failing for 25 percent or more" }))).toBe("Sign-in codes failing for 25 percent or more: 31.2%");
  });
});

describe("the weekly brief", () => {
  it("is five numbers against the week before, then what needs a decision, by fixed rules", () => {
    const lines = briefLines(BRIEF).map((l) => l.text);
    expect(lines).toEqual([
      "People active: 42 (up 5 from 37)",
      "New sign-ups: 12 (down 3 from 15)",
      "Forms submitted: 7 (same as before (7))",
      "Members placed in a tribe: 5 (up 5 from 0)",
      "Messages that failed: 2 (up 1 from 1)",
    ]);
    const text = buildBrief(BRIEF);
    expect(text).toContain("United Tribes: weekly brief");
    expect(text).toContain("Week of 5 Oct to 11 Oct 2026");
    expect(text).toContain("1. Members waiting more than 14 days for a tribe: 23.");
    expect(text).toContain("(/god/people)");
    expect(text).toContain("Counts only: no names, no messages.");
  });

  it("says when nothing needs a decision, and never lists more than three", () => {
    expect(buildBrief({ ...BRIEF, decisions: [] })).toContain("Nothing needs a decision this week.");
    const many = buildBrief({ ...BRIEF, decisions: [1, 2, 3, 4, 5].map((n) => decision({ key: `k${n}`, label: `Flag ${n}`, value: n })) });
    expect(many).toContain("3. Flag 3: 3.");
    expect(many).not.toContain("4. Flag 4");
  });

  it("survives a week with nothing in it", () => {
    const text = buildBrief({ week_start: "2026-10-05", week_end: "2026-10-11", active: { now: 0, prev: 0 }, numbers: {}, decisions: [] });
    expect(text).toContain("People active: 0 (same as before (0))");
    expect(text).toContain("New sign-ups: 0");
  });
});

const PULSE = (active: Partial<Pulse["active"]>): Pulse => ({
  today: "2026-10-15",
  active: { today: 3, d7: 20, p7: 18, d30: 60, p30: 50, ...active },
  groups: {},
  metrics: {},
  trend: { days: [], series: {} },
  decisions: [],
  status: { recording: true, retention_months: 13, last_refresh: null, last_backfill: null, recording_since: null },
});

const FUNNEL = (reached: (number | "<5")[], which: Funnel["which"] = "member"): Funnel => ({
  which,
  from: "2026-07-18",
  to: "2026-10-15",
  total: 22,
  stages: reached.map((r, i) => ({ k: i + 1, key: `s${i}`, label: `Step ${i + 1}`, reached: r, stopped: 0, pct_start: null, pct_prev: null, median_hours: null })),
  split: null,
  finish: null,
});

describe("chart captions", () => {
  it("describe the trend in words and handle an empty month", () => {
    expect(trendCaption(PULSE({}))).toBe("60 people were active in the last 30 days, up 10 (20%) from 50 in the 30 days before.");
    expect(trendCaption(PULSE({ d30: 40 }))).toContain("down 10 (20%)");
    expect(trendCaption(PULSE({ d30: 50 }))).toContain("the same as the 30 days before");
    expect(trendCaption(PULSE({ d30: 9, p30: 0 }))).toContain("no earlier month");
    expect(trendCaption(PULSE({ d30: 0, p30: 0 }))).toBe("Nobody has been recorded as active yet.");
  });

  it("find the biggest drop between bars that are big enough to show", () => {
    expect(funnelCaption(FUNNEL([22, 18, 15, 8, 5]))).toBe("22 people registered in this period. The biggest drop is between “Step 3” and “Step 4”: 53% of those who reached the first went on to the second.");
    expect(funnelCaption(FUNNEL([22, 18, "<5", "<5"]))).toContain("22 people registered");
    expect(funnelCaption(FUNNEL([22, 18, "<5", "<5"]))).toContain("“Step 1” and “Step 2”");
    expect(funnelCaption(FUNNEL(["<5", "<5"]))).toContain("cannot be shown");
    expect(funnelCaption(FUNNEL([9]))).toContain("not enough people");
    expect(funnelCaption(FUNNEL([9, 5], "leader"))).toContain("started");
  });

  it("never say a number the database hid", () => {
    const hiddenHeat: Heatmap = { days: 28, cells: [{ dow: 1, hour: 9, people: "<5", events: 3 }], groups: {} };
    expect(heatCaption(hiddenHeat)).toBe("There is not enough activity in this period to show a busiest time.");
    const heat: Heatmap = { days: 28, cells: [{ dow: 7, hour: 18, people: 14, events: 40 }, { dow: 1, hour: 9, people: 6, events: 9 }, { dow: 2, hour: 8, people: "<5", events: 2 }], groups: {} };
    expect(heatCaption(heat)).toBe("The busiest time is Sun around 18:00 (Lagos time), with 14 different people in the last 28 days.");
    expect(compareCaption([{ label: "A", members: "<5", active_pct: null }])).toContain("fewer than 5 people");
    expect(compareCaption([{ label: "Iganmu", members: 30, active_pct: 70 }, { label: "Lekki", members: 12, active_pct: 40 }, { label: "Abuja", members: "<5", active_pct: null }])).toBe(
      "Iganmu has the most people active in the last 30 days (70%) and Lekki the fewest (40%).",
    );
    expect(compareCaption([{ label: "A", members: 9, active_pct: 100 }, { label: "B", members: 7, active_pct: 100 }])).toBe("Every group shown has the same share active in the last 30 days (100%).");
    const r: Retention = { weeks: [{ start: "2026-09-07", size: 20, cells: [100, 40, 30] }, { start: "2026-09-14", size: "<5", cells: ["<5", "<5"] }, { start: "2026-09-21", size: 10, cells: [100, 20] }] };
    expect(retentionCaption(r)).toBe("On average 30% of the people who joined in a week were active again the week after.");
    expect(retentionCaption({ weeks: [{ start: "2026-09-14", size: "<5", cells: ["<5", "<5"] }] })).toContain("too small");
  });

  it("describe how long the form takes, or that there are too few forms to say", () => {
    const f = FUNNEL([22]);
    expect(finishCaption({ ...f, finish: { n: 3, p25: null, p50: null, p75: null, p90: null, bins: [] } })).toContain("Fewer than 5 forms");
    expect(finishCaption({ ...f, finish: { n: 20, p25: 120, p50: 300, p75: 420, p90: 660, bins: [] } })).toBe("Half of the forms were finished within 5 min. Nine in ten finished within 11 min.");
    expect(finishCaption(f)).toContain("Fewer than 5 forms");
  });
});

describe("the audit trail as a spreadsheet file", () => {
  const row = (over: Partial<AuditRow> = {}): AuditRow => ({
    at: "2026-10-15T09:30:00Z",
    who: "Ada Obi",
    group: "member",
    person_id: "p1",
    action: "testimony.submitted",
    area: "Testimonies",
    entity: "testimony",
    ref: "1a2b3c4d",
    ...over,
  });

  it("quotes what needs quoting", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(7)).toBe("7");
  });

  it("stops a cell being run as a formula by a spreadsheet", () => {
    for (const bad of ["=HYPERLINK(\"http://evil\",\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      const cell = csvCell(bad);
      expect(cell.replace(/^"/, "").startsWith("'"), bad).toBe(true);
    }
    expect(csvCell("Ada =Obi")).toBe("Ada =Obi");
    expect(csvCell("-")).toBe("'-");
  });

  it("writes Lagos time, plain words, and a safe name for the person", () => {
    const csv = auditCsv([row(), row({ who: "=cmd|' /C calc'!A0", at: "2026-10-15T23:30:00Z", action: "care.call", area: "Care", ref: null }), row({ who: "Young member", group: "young", person_id: null })]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines[1]).toBe("2026-10-15 10:30,Ada Obi,Member,shared a testimony,testimony.submitted,Testimonies,testimony,1a2b3c4d");
    expect(lines[2].startsWith("2026-10-16 00:30,'=cmd|' /C calc'!A0,Member,")).toBe(true);
    expect(lines[3]).toContain("Young member,Young member,");
    expect(lines.at(-1)).toBe("");
    expect(csv).not.toMatch(/person_id|p1/);
  });

  it("names the file for the day in Lagos", () => {
    expect(lagosStamp("2026-10-15T23:30:00Z")).toBe("2026-10-16 00:30");
    expect(lagosStamp("nonsense")).toBe("");
    expect(auditFileName("2026-10-15T23:30:00Z")).toBe("united-tribes-audit-2026-10-16.csv");
  });
});
