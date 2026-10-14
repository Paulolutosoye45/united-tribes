import { describe, expect, it } from "vitest";
import { REFEREE_CARE_ROLES, REFEREE_DECIDER_ROLES, REFEREE_MANAGER_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { isBrowserMarker, newBrowserMarker, wantsMarker } from "@/lib/leaders/referee/marker";
import { askOutcome, checkOutcome } from "@/lib/leaders/referee/outcome";
import { cleanRows, isMode } from "@/lib/leaders/referee/rows";
import type { PlanRow } from "@/lib/leaders/referee/types";
import {
  MAX_UPLOAD_BYTES, applyLabel, doneLine, fileProblem, filterRows, needsRetireConfirm, nothingToDo, orderRows, retireLimit,
} from "@/lib/leaders/referee/upload";

const counts = (c: Partial<Record<"add" | "update" | "unchanged" | "retire" | "error", number>>) => ({ add: 0, update: 0, unchanged: 0, retire: 0, error: 0, total: 0, ...c });

describe("choosing a file", () => {
  it("accepts a spreadsheet and says what is wrong with anything else", () => {
    expect(fileProblem({ name: "pastors.xlsx", size: 40_000 })).toBeNull();
    expect(fileProblem({ name: "Pastors List.CSV", size: 900 })).toBeNull();
    expect(fileProblem({ name: "pastors.xlsx", size: 0 })).toMatch(/empty/);
    expect(fileProblem({ name: "pastors.xlsx", size: MAX_UPLOAD_BYTES + 1 })).toMatch(/too large/);
    expect(fileProblem({ name: "pastors.xls", size: 5000 })).toMatch(/Save As/);
    expect(fileProblem({ name: "pastors.pdf", size: 5000 })).toMatch(/isn’t a spreadsheet/);
    expect(fileProblem({ name: "pastors.numbers", size: 5000 })).toMatch(/Excel \(\.xlsx\) or CSV/);
  });
});

describe("the safety check on a big removal", () => {
  it("uses the same sum as the database: more than the larger of 5 and 40% of the list", () => {
    expect(retireLimit(10)).toBe(5);
    expect(retireLimit(100)).toBe(40);
    expect(retireLimit(48)).toBe(19);
    expect(needsRetireConfirm({ retire: 5 }, 10)).toBe(false);
    expect(needsRetireConfirm({ retire: 6 }, 10)).toBe(true);
    expect(needsRetireConfirm({ retire: 40 }, 100)).toBe(false);
    expect(needsRetireConfirm({ retire: 41 }, 100)).toBe(true);
    expect(needsRetireConfirm({ retire: 0 }, 0)).toBe(false);
  });
});

describe("what the buttons say", () => {
  it("names what pressing it will do", () => {
    expect(applyLabel(counts({ add: 5, update: 3 }))).toBe("Add 5, update 3");
    expect(applyLabel(counts({ retire: 2 }))).toBe("Take 2 off");
    expect(applyLabel(counts({ add: 1, update: 2, retire: 3 }))).toBe("Add 1, update 2, take 3 off");
    expect(applyLabel(counts({ unchanged: 9, error: 1 }))).toBe("Nothing to change");
    expect(nothingToDo(counts({ unchanged: 9 }))).toBe(true);
    expect(nothingToDo(counts({ add: 1 }))).toBe(false);
  });

  it("sums up an upload in numbers a person can check", () => {
    expect(doneLine(counts({ add: 5, update: 3 }))).toBe("5 added, 3 updated.");
    expect(doneLine(counts({ add: 1, update: 0, retire: 2, unchanged: 40, error: 1 }))).toBe("1 added, 0 updated, 2 taken off the list, 40 already up to date, 1 row left out.");
    expect(doneLine(counts({ error: 3 }))).toContain("3 rows left out");
  });
});

describe("the preview list", () => {
  const row = (action: PlanRow["action"], line: number | null, name = "X"): PlanRow => ({ line, action, entryId: null, name, standing: null, unit: null, contacts: [], changes: [], warn: [], message: null });
  const rows = [row("add", 9, "Late add"), row("update", 3), row("error", 7, "Bad"), row("retire", 12), row("error", 2, "Worse"), row("add", 4), row("revive", 5)];

  it("puts what needs attention first, then keeps the file’s order", () => {
    expect(orderRows(rows).map((r) => `${r.action}:${r.line}`)).toEqual(["error:2", "error:7", "retire:12", "update:3", "add:4", "revive:5", "add:9"]);
  });

  it("filters by what a person can act on, counting a returning person as updated", () => {
    expect(filterRows(rows, "problems")).toHaveLength(2);
    expect(filterRows(rows, "add")).toHaveLength(2);
    expect(filterRows(rows, "update").map((r) => r.action).sort()).toEqual(["revive", "update"]);
    expect(filterRows(rows, "retire")).toHaveLength(1);
    expect(filterRows(rows, "all")).toHaveLength(7);
  });
});

describe("what the server trusts from the browser", () => {
  it("cleans every row and never lets a standing the database does not know through", () => {
    const out = cleanRows([
      { line: 4, name: "  Pastor   Ife  ", standing: "pastor", unit: "Ushers", note: "n", contacts: ["0803 111 2222", "", "  ife@church.org "] },
      { line: 5, name: "Bro Tunde", standing: "bishop", contacts: "nope" },
      { name: "Off", standing: "unit_head", contacts: ["0805 000 0000"], active: false },
      { line: -3, name: "Odd line", standing: "unit_head", contacts: [] },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows[0]).toEqual({ line: 4, name: "Pastor Ife", standing: "pastor", unit: "Ushers", note: "n", contacts: ["0803 111 2222", "ife@church.org"] });
    expect(out.rows[1]).toMatchObject({ standing: "", contacts: [] });
    expect(out.rows[2]).toMatchObject({ line: 4, active: false });
    expect(out.rows[3].line).toBe(5);
    expect("roleText" in out.rows[0]).toBe(false);
  });

  it("limits length and number, and refuses what is not a list", () => {
    const long = cleanRows([{ line: 2, name: "N".repeat(400), standing: "pastor", unit: "U".repeat(400), note: "x".repeat(900), contacts: Array.from({ length: 40 }, (_, i) => `080311122${i}`) }]);
    if (!long.ok) throw new Error("expected rows");
    expect(long.rows[0].name.length).toBe(120);
    expect(long.rows[0].note.length).toBe(300);
    expect(long.rows[0].contacts).toHaveLength(12);
    expect(cleanRows([])).toMatchObject({ ok: false });
    expect(cleanRows("rows")).toMatchObject({ ok: false });
    expect(cleanRows([null])).toMatchObject({ ok: false });
    expect(cleanRows(Array.from({ length: 5001 }, () => ({ name: "A B", standing: "pastor", contacts: ["0803 111 2222"] })))).toMatchObject({ ok: false });
    expect(isMode("update") && isMode("replace")).toBe(true);
    expect(isMode("delete")).toBe(false);
  });
});

describe("what a referee is told", () => {
  it("explains a code request that cannot go out", () => {
    expect(askOutcome({ ok: true, kind: "email", masked: "a•••@x.org" })).toEqual({ ok: true, kind: "email", masked: "a•••@x.org" });
    expect(askOutcome({ ok: false, reason: "wait", seconds: 1 })).toMatchObject({ reason: "wait", seconds: 1, message: expect.stringContaining("1 second.") });
    expect(askOutcome({ ok: false, reason: "wait", seconds: 42 }).ok).toBe(false);
    expect(askOutcome({ ok: false, reason: "limit" })).toMatchObject({ message: expect.stringContaining("tomorrow") });
    expect(askOutcome({ ok: false, reason: "locked", minutes: 1 })).toMatchObject({ message: expect.stringContaining("1 minute.") });
    expect(askOutcome({ ok: false, reason: "locked", minutes: 30 })).toMatchObject({ minutes: 30, message: expect.stringContaining("30 minutes") });
    expect(askOutcome({ ok: false, reason: "expired" })).toMatchObject({ message: expect.stringContaining("expired") });
    expect(askOutcome({ ok: false, reason: "unreachable" })).toMatchObject({ message: expect.stringContaining("applicant") });
    expect(askOutcome(null)).toMatchObject({ ok: false, reason: "error" });
  });

  it("counts the tries left and never gives the code away", () => {
    expect(checkOutcome({ ok: true })).toEqual({ ok: true });
    expect(checkOutcome({ ok: false, reason: "wrong", tries_left: 3 })).toMatchObject({ triesLeft: 3, message: "That isn’t the code. You have 3 tries left." });
    expect(checkOutcome({ ok: false, reason: "wrong", tries_left: 1 }).ok).toBe(false);
    expect(checkOutcome({ ok: false, reason: "wrong", tries_left: 1 })).toMatchObject({ message: "That isn’t the code. You have one try left." });
    expect(checkOutcome({ ok: false, reason: "locked", minutes: 30 })).toMatchObject({ minutes: 30 });
    expect(checkOutcome({ ok: false, reason: "expired" })).toMatchObject({ message: expect.stringContaining("run out") });
    expect(checkOutcome({ ok: false, reason: "format" })).toMatchObject({ message: expect.stringContaining("six numbers") });
    expect(checkOutcome({ ok: false, reason: "closed" })).toMatchObject({ reason: "closed" });
    expect(checkOutcome("???")).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("the browser marker", () => {
  it("is long, random and only handed out on the applicant’s pages and the referee’s link", () => {
    const a = newBrowserMarker();
    expect(isBrowserMarker(a)).toBe(true);
    expect(a).toHaveLength(48);
    expect(newBrowserMarker()).not.toBe(a);
    expect(isBrowserMarker("abc")).toBe(false);
    expect(isBrowserMarker(undefined)).toBe(false);
    expect(wantsMarker("/lead")).toBe(true);
    expect(wantsMarker("/lead/apply")).toBe(true);
    expect(wantsMarker("/reference/abc")).toBe(true);
    expect(wantsMarker("/leaders")).toBe(false);
    expect(wantsMarker("/home")).toBe(false);
    expect(wantsMarker("/api/referees/read")).toBe(false);
  });
});

describe("who may do what with the list", () => {
  it("lets the pastorate and the office keep the list, only deciders confirm, and the care team make the calls", () => {
    expect(hasAnyRole(["admin"], REFEREE_MANAGER_ROLES)).toBe(true);
    expect(hasAnyRole(["data_lead"], REFEREE_MANAGER_ROLES)).toBe(false);
    expect(hasAnyRole(["coach"], REFEREE_MANAGER_ROLES)).toBe(false);
    expect(hasAnyRole(["admin"], REFEREE_DECIDER_ROLES)).toBe(false);
    expect(hasAnyRole(["pastor"], REFEREE_DECIDER_ROLES)).toBe(true);
    expect(hasAnyRole(["care_lead"], REFEREE_CARE_ROLES)).toBe(true);
    expect(hasAnyRole(["coach"], REFEREE_CARE_ROLES)).toBe(false);
  });
});
