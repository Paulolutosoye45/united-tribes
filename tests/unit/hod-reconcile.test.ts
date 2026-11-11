import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTIONS, crumbsFor } from "@/lib/admin/nav";
import { readXlsx, writeXlsx } from "@/lib/leaders/referee/sheet/xlsx";
import { LEADER_CARD_ACT_ROLES, LEADER_CARD_ROLES } from "@/lib/auth/roles";
import {
  HOD_HEADER, HOD_MAX_ROWS, HOD_RESULTS, HOD_TEMPLATE, HOD_WORDS, hodActions, hodCounts, hodHeadline, hodListCsv, hodMissingCsv, parseHodList, parseHodReport,
  hodWorkbook, pickEmail, pickPhone, readHodRows, readHodSheet, readHodText, type HodReport, type HodReportRow,
} from "@/lib/leader-cards/hod";

// Fix 7: the report on the heads-of-department list. What these prove:
//   * the list is read from a pasted table or a file in the ways a church spreadsheet really comes: titles in any usual words, a title row below a heading, a name in two columns,
//     two addresses in one cell, a number a spreadsheet has turned into 2.348E+12; rows with nothing on them are left out and nothing else is dropped without a word
//   * what the report reads from the database is read defensively, and anything unclear means "not available"
//   * each tap says how many people it will touch before it is made, from the report as it reads now
//   * the two spreadsheets: the leaders who are not on the list never carry a number or an address, the list report carries the list's own contacts only for those who act, and a
//     spreadsheet cannot run a name or a number as a formula
//   * the roles on the page, the actions, the download and the database agree; making a report sends nothing, appoints nobody and writes nothing to a person's account

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const sql = read("supabase/migrations/20270124000100_hod_reconcile.sql");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const rowsOf = (text: string) => {
  const r = readHodText(text);
  if (!r.ok) throw new Error(r.message);
  return r.rows;
};

describe("reading the list", () => {
  it("reads titles in the usual words, in any order and case", () => {
    const rows = rowsOf("Head of Department,E-mail Address,Mobile Number,Dept,Goal if known\nAda Obi,ada@example.org,08031234567,Ushers,Marriage\n");
    expect(rows).toEqual([{ line: 2, name: "Ada Obi", email: "ada@example.org", phone: "08031234567", department: "Ushers", goal: "Marriage" }]);
  });

  it("reads a tab-separated table pasted from a spreadsheet, and a semicolon list", () => {
    expect(rowsOf("Name\tEmail\tDepartment\nAda\tada@example.org\tMedia")).toHaveLength(1);
    expect(rowsOf("Name;Phone;Department\nAda;08031234567;Media")[0]).toMatchObject({ name: "Ada", phone: "08031234567", department: "Media" });
  });

  it("finds the titles below a heading, and counts lines from the top", () => {
    const rows = rowsOf("Heads of department, October\n\nName,Email,Department\nAda,ada@example.org,Ushers\n,,\nBen,ben@example.org,Choir\n");
    expect(rows.map((r) => [r.line, r.name])).toEqual([[4, "Ada"], [6, "Ben"]]);
  });

  it("joins a first name and a last name, and prefers a single name column when both are there", () => {
    expect(rowsOf("First name,Surname,Email\nAda,Obi,ada@example.org")[0].name).toBe("Ada Obi");
    expect(rowsOf("Name,First name,Email\nAda Obi,Adaeze,ada@example.org")[0].name).toBe("Ada Obi");
  });

  it("takes the first address from a cell with more than one, or with a name round it", () => {
    expect(pickEmail("ada@example.org; ada.work@example.org")).toBe("ada@example.org");
    expect(pickEmail("Ada Obi <ada@example.org>")).toBe("ada@example.org");
    expect(pickEmail("ada@example.org / 08031234567")).toBe("ada@example.org");
    expect(pickEmail("not an email")).toBe("not an email");
    expect(pickEmail("")).toBe("");
  });

  it("puts right a number a spreadsheet has spoiled, and takes the first of two", () => {
    expect(pickPhone("2.348031234567E+12")).toBe("2348031234567");
    expect(pickPhone("8031234567.0")).toBe("8031234567");
    expect(pickPhone("0803 123 4567")).toBe("0803 123 4567");
    expect(pickPhone("+234 803 123 4567")).toBe("+234 803 123 4567");
    expect(pickPhone("08031234567, 08051234567")).toBe("08031234567");
    expect(pickPhone("0803 123 4567 / 0805 123 4567")).toBe("0803 123 4567");
    expect(pickPhone("")).toBe("");
  });

  it("leaves out rows with nothing on them and the example row, and keeps every other row, however little it says", () => {
    const rows = rowsOf("Name,Email,Phone,Department\n(example) Ada,ada@example.org,,Ushers\n , , ,\nBen,,,\n,not an email,,\n");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Ben", email: "", phone: "" });
    expect(rows[1]).toMatchObject({ email: "not an email" });
  });

  it("cuts each cell to what the database keeps, and tidies spaces", () => {
    const r = rowsOf(`Name,Email,Department,Goal\n${"x".repeat(300)},a@example.org,${"d  e".repeat(40)},${"g".repeat(200)}`)[0];
    expect(r.name).toHaveLength(120);
    expect(r.department.length).toBeLessThanOrEqual(60);
    expect(r.department).not.toMatch(/ {2}/);
    expect(r.goal).toHaveLength(120);
  });

  it("reads up to 500 people and says so when there are more", () => {
    const lines = Array.from({ length: 503 }, (_, i) => `P${i},p${i}@example.org`);
    const r = readHodText(["Name,Email", ...lines].join("\n"));
    expect(r.ok && r.rows.length).toBe(HOD_MAX_ROWS);
    expect(r.ok && r.problems).toEqual([{ line: 502, text: "Only the first 500 people are read." }]);
  });

  it("says what is wrong with a list it cannot use, in words", () => {
    expect(readHodText("")).toEqual({ ok: false, message: "Paste the list first." });
    expect(readHodText("Name,Department\nAda,Ushers")).toMatchObject({ ok: false, message: expect.stringContaining("couldn’t find the columns") });
    expect(readHodText("Name,Email\n")).toEqual({ ok: false, message: "There is nobody on that list." });
    expect(readHodRows([])).toMatchObject({ ok: false });
  });

  it("reads a CSV file with a byte-order mark, and refuses files it cannot read with a way forward", () => {
    const csv = Buffer.from("﻿Name,Email\nAda,ada@example.org\n", "utf8");
    expect(readHodSheet("list.csv", csv)).toMatchObject({ ok: true, rows: [{ name: "Ada" }] });
    expect(readHodSheet("list.csv", Buffer.alloc(0))).toEqual({ ok: false, message: "That file is empty." });
    expect(readHodSheet("list.pdf", Buffer.from("%PDF-1.4"))).toMatchObject({ ok: false, message: expect.stringContaining("Excel (.xlsx) or CSV") });
    expect(readHodSheet("list.xlsx", Buffer.from("PK\u0003\u0004 not a real workbook"))).toMatchObject({ ok: false, message: expect.any(String) });
    expect(readHodSheet("big.csv", Buffer.alloc(2 * 1024 * 1024 + 1, "a"))).toMatchObject({ ok: false, message: expect.stringContaining("too large") });
  });

  it("reads a real Excel workbook, the first sheet, with a number a spreadsheet kept as text", () => {
    const bytes = writeXlsx([
      { name: "HODs", header: ["Name", "Email", "Phone number", "Department"], rows: [["Ada Obi", "ada@example.org", "08031234567", "Ushers"], ["", "", "", ""], ["Ben Ade", "", "2348051234567", "Choir"]] },
      { name: "Other", header: ["Name", "Email"], rows: [["Not read", "no@example.org"]] },
    ]);
    const r = readHodSheet("heads.xlsx", bytes);
    expect(r.ok && r.rows.map((x) => [x.name, x.email, x.phone, x.department])).toEqual([
      ["Ada Obi", "ada@example.org", "08031234567", "Ushers"],
      ["Ben Ade", "", "2348051234567", "Choir"],
    ]);
  });

  it("offers a template whose titles the reader understands", () => {
    expect(HOD_HEADER).toEqual(["Name", "Email", "Phone", "Department", "Goal"]);
    expect(readHodText(HOD_TEMPLATE)).toEqual({ ok: false, message: "There is nobody on that list." });
  });
});

const row = (over: Partial<HodReportRow> = {}): HodReportRow => ({
  line: 1, name: "Ada Obi", department: "Ushers", goal: "", result: "appointed", note: "", leaderDept: "", email: "ada@example.org", phone: "0803", ...over,
});
const report = (rows: HodReportRow[], over: Partial<Extract<HodReport, { ok: true }>> = {}): Extract<HodReport, { ok: true }> => ({
  ok: true, role: "act", run: { id: "r1", madeAt: "2026-11-11T08:00:00Z", rows: rows.length, note: "", by: "", taggedAt: null, invitedAt: null, invitedN: null }, rows, missing: [], ...over,
});

describe("what the report reads", () => {
  const good = {
    role: "act",
    run: { id: "r1", made_at: "2026-11-11T08:00:00Z", rows: 3, note: "October", by: "Admin Test", tagged_at: null, invited_at: "2026-11-12T09:00:00Z", invited_n: 2 },
    rows: [
      { line: 1, name: "Ada", department: "Ushers", result: "appointed", leader_dept: "Media", email: "ada@example.org", phone: "0803" },
      { line: 2, result: "no_account", note: "There is no email address to invite" },
      { line: 3, result: "no-such-result" },
      { name: "No line", result: "unclear" },
    ],
    missing: [{ name: "Ben", tribe: "Ben’s tribe", department: "Choir", state: "approved" }, { tribe: "No name" }],
  };

  it("reads a good answer and skips rows it cannot understand", () => {
    const r = parseHodReport(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.role).toBe("act");
    expect(r.run).toMatchObject({ id: "r1", note: "October", by: "Admin Test", taggedAt: null, invitedAt: "2026-11-12T09:00:00Z", invitedN: 2 });
    expect(r.rows.map((x) => x.line)).toEqual([1, 2]);
    expect(r.rows[0]).toMatchObject({ result: "appointed", leaderDept: "Media", email: "ada@example.org" });
    expect(r.rows[1]).toMatchObject({ name: "", note: "There is no email address to invite", email: "" });
    expect(r.missing).toEqual([{ name: "Ben", tribe: "Ben’s tribe", department: "Choir", state: "approved" }]);
  });

  it("means not available for anything that is not an answer", () => {
    for (const bad of [null, undefined, "x", 3, [], {}, { role: "member", run: {}, rows: [], missing: [] }, { role: "act", run: { id: 3 }, rows: [], missing: [] }, { role: "act", run: { id: "r" }, rows: {}, missing: [] }, { role: "act", run: { id: "r" }, rows: [] }]) {
      expect(parseHodReport(bad)).toEqual({ ok: false });
    }
  });

  it("reads the list of reports the same way", () => {
    const l = parseHodList({
      role: "look",
      runs: [{ id: "a", made_at: "2026-11-11T08:00:00Z", rows: 4, note: "n", counts: { appointed: 2, no_account: 1, bogus: 9, unclear: "x" }, tagged_at: "2026-11-12T00:00:00Z", invited_at: null }, { rows: 1 }, null],
    });
    expect(l).toEqual({ ok: true, role: "look", runs: [{ id: "a", madeAt: "2026-11-11T08:00:00Z", rows: 4, note: "n", counts: { appointed: 2, no_account: 1 }, taggedAt: "2026-11-12T00:00:00Z", invitedAt: null }] });
    for (const bad of [null, {}, { role: "act" }, { role: "x", runs: [] }, { role: "act", runs: "no" }]) expect(parseHodList(bad)).toEqual({ ok: false });
  });
});

describe("what each tap would do", () => {
  const rows = [
    row({ line: 1, result: "appointed", department: "Ushers", leaderDept: "" }),
    row({ line: 2, result: "appointed", department: "Media", leaderDept: "Media" }),
    row({ line: 3, result: "appointed", department: "Choir", leaderDept: "Media" }),
    row({ line: 4, result: "appointed", department: "", leaderDept: "" }),
    row({ line: 5, result: "appointed", department: "x", leaderDept: "" }),
    row({ line: 6, result: "has_account", department: "Prayer" }),
    row({ line: 7, result: "no_account", email: "New@Example.org" }),
    row({ line: 8, result: "no_account", email: " new@example.org" }),
    row({ line: 9, result: "no_account", email: "other@example.org" }),
    row({ line: 10, result: "no_account", email: "", phone: "0809" }),
    row({ line: 11, result: "no_account", email: "bad" }),
    row({ line: 12, result: "duplicate" }),
    row({ line: 13, result: "unclear" }),
  ];

  it("counts the departments to put on, the ones that differ, the people to invite, and the people it cannot invite", () => {
    expect(hodActions(rows)).toEqual({ tag: 1, differs: 1, invite: 2, noEmail: 2 });
  });

  it("counts each way a person stands, and always has all five", () => {
    expect(hodCounts(rows)).toEqual({ appointed: 5, has_account: 1, no_account: 5, duplicate: 1, unclear: 1 });
    expect(hodCounts([])).toEqual({ appointed: 0, has_account: 0, no_account: 0, duplicate: 0, unclear: 0 });
  });

  it("says it in a line: how many people, how many are leaders, and who the list left out", () => {
    const c = { appointed: 3, has_account: 1, no_account: 2, duplicate: 1, unclear: 0 };
    expect(hodHeadline(c, 2)).toBe("6 people on the list, 3 already leaders, 1 with an account but not appointed, 2 with no account. 2 leaders on the platform are not on the list.");
    expect(hodHeadline({ appointed: 1, has_account: 0, no_account: 0, duplicate: 0, unclear: 1 }, 1)).toBe(
      "2 people on the list, 1 already a leader, 0 with an account but not appointed, 0 with no account, 1 we could not tell. 1 leader on the platform is not on the list.",
    );
    expect(hodHeadline({ appointed: 2, has_account: 0, no_account: 0, duplicate: 0, unclear: 0 }, 0)).toContain("Every leader on the platform is on the list.");
  });

  it("has words for every result, none of them blaming", () => {
    for (const k of HOD_RESULTS) {
      expect(HOD_WORDS[k].label.length, k).toBeGreaterThan(3);
      expect(HOD_WORDS[k].line, k).toMatch(/\.$/);
      expect(`${HOD_WORDS[k].label} ${HOD_WORDS[k].line}`, k).not.toMatch(/\b(fail|wrong|error|fault|refus)/i);
    }
  });
});

describe("the two spreadsheets", () => {
  const r = report(
    [row({ line: 1, name: "=HYPERLINK(\"x\")", email: "ada@example.org", phone: "+2348031234567", note: "Already holds the leader role" }), row({ line: 2, name: "Ben, Jr", result: "no_account" })],
    { missing: [{ name: "Cee", tribe: "Cee’s tribe", department: "", state: "not_started" }] },
  );

  it("gives the office the list's contacts and nobody else", () => {
    const act = hodListCsv(r);
    expect(act).toContain("Email,Phone");
    expect(act).toContain("ada@example.org");
    expect(act).toContain("'+2348031234567");
    const look = hodListCsv({ ...r, role: "look", rows: r.rows.map((x) => ({ ...x, email: "", phone: "" })) });
    expect(look).not.toContain("Email,Phone");
    expect(look.split("\r\n")[0]).toBe("﻿Line,Name,Department on the list,Goal,Where they stand,Note,Department on the platform");
  });

  it("cannot run a name as a formula, and quotes a comma", () => {
    const text = hodListCsv(r);
    expect(text).toContain("'=HYPERLINK");
    expect(text).not.toMatch(/,=HYPERLINK/);
    expect(text).toContain('"Ben, Jr"');
  });

  it("names the leaders the list left out with no number and no address, and says where their card is in words", () => {
    const text = hodMissingCsv(r);
    expect(text).toBe("﻿Name,Tribe,Department,Where their card is\r\nCee,Cee’s tribe,No department yet,Not started\r\n");
    expect(text).not.toMatch(/@|\+234|phone|email/i);
  });
});

describe("one sheet for each head of department", () => {
  const r = report(
    [
      row({ line: 1, name: "Ada Obi", department: "Ushers", result: "appointed", email: "ada@example.org", phone: "0803", leaderDept: "Ushers" }),
      row({ line: 2, name: "Ben Ade", department: "ushers ", result: "no_account", email: "ben@example.org", phone: "" }),
      row({ line: 3, name: "Cee Eze", department: "Choir", result: "has_account", note: "Already holds the leader role", email: "", phone: "0805" }),
      row({ line: 4, name: "Dee", department: "", result: "unclear", email: "", phone: "" }),
      row({ line: 5, name: "Eve", department: "A/B: C?", result: "no_account", email: "eve@example.org", phone: "" }),
      row({ line: 6, name: "Fay", department: "A B  C ", result: "no_account", email: "fay@example.org", phone: "" }),
    ],
    { missing: [{ name: "Gus Ola", tribe: "Gus’s tribe", department: "Choir", state: "submitted" }, { name: "Hal", tribe: "Hal’s tribe", department: "", state: "" }] },
  );
  const sheets = (rep: Extract<HodReport, { ok: true }>) => readXlsx(hodWorkbook(rep));
  const cells = (rows: { cells: string[] }[]) => rows.map((x) => x.cells);

  it("opens with a summary, then a sheet for each department in order, and the ones with none last", () => {
    const s = sheets(r);
    expect(s.map((x) => x.name)).toEqual(["Summary", "A B C", "A B C 2", "Choir", "Ushers", "No department"]);
    expect(cells(s[0].rows)).toEqual([
      ["Where they stand", "People"], ["Already a leader", "1"], ["Has an account, not appointed", "1"], ["No account yet", "3"], ["On the list twice", "0"], ["Could not tell", "1"],
      ["Leaders on the platform, not on the list", "2"],
    ]);
  });

  it("puts the people on the list and the leaders the list left out on their own department's sheet, and merges departments written two ways", () => {
    const s = sheets(r);
    const ushers = cells(s.find((x) => x.name === "Ushers")!.rows);
    expect(ushers[0]).toEqual(["Line", "Name", "Where they stand", "Note", "Department on the platform", "Email", "Phone"]);
    expect(ushers.slice(1).map((x) => x[1])).toEqual(["Ada Obi", "Ben Ade"]);
    const choir = cells(s.find((x) => x.name === "Choir")!.rows);
    expect(choir.slice(1).map((x) => [x[1], x[2], x[3]])).toEqual([
      ["Cee Eze", "Has an account, not appointed", "Already holds the leader role"],
      ["Gus Ola", "On the platform, not on your list", "Gus’s tribe, card: sent in"],
    ]);
    const none = cells(s.find((x) => x.name === "No department")!.rows);
    expect(none.slice(1).map((x) => x[1])).toEqual(["Dee", "Hal"]);
  });

  it("gives the contacts from the list to the office and nobody else", () => {
    const act = cells(sheets(r).find((x) => x.name === "Ushers")!.rows).flat().join("|");
    expect(act).toContain("ada@example.org");
    const look = cells(sheets({ ...r, role: "look" }).find((x) => x.name === "Ushers")!.rows);
    expect(look[0]).toEqual(["Line", "Name", "Where they stand", "Note", "Department on the platform"]);
    expect(look.flat().join("|")).not.toMatch(/@|0803/);
  });

  it("keeps a sheet name to what a workbook allows, and still makes a workbook of a report with one person", () => {
    const long = report([row({ department: "x".repeat(60) })]);
    expect(sheets(long)[1].name.length).toBeLessThanOrEqual(31);
    expect(sheets(report([row()])).map((x) => x.name)).toEqual(["Summary", "Ushers"]);
  });
});

describe("who may, and what it never does", () => {
  const page = read("src/app/(app)/admin/people/leader-cards/reconcile/page.tsx");
  const actions = read("src/app/(app)/admin/people/leader-cards/reconcile/actions.ts");
  const route = read("src/app/(app)/admin/people/leader-cards/reconcile/download/route.ts");

  it("opens the page and the download to the roles that read the board, and the actions to the roles that act", () => {
    expect(page).toMatch(/requireRole\(LEADER_CARD_ROLES,/);
    expect(route).toMatch(/hasAnyRole\(session\.roles, LEADER_CARD_ROLES\)/);
    expect(actions).toMatch(/hasAnyRole\(session\.roles, LEADER_CARD_ACT_ROLES\)/);
    expect([...LEADER_CARD_ROLES].sort()).toEqual(["admin", "data_lead", "director", "pastor"]);
    expect([...LEADER_CARD_ACT_ROLES].sort()).toEqual(["admin", "director", "pastor"]);
  });

  it("shows the invite button only to an admin or a director, and the contacts and the buttons only to those who act", () => {
    expect(page).toMatch(/canInvite=\{hasAnyRole\(session\.roles, \["admin", "director"\]\)\}/);
    expect(page).toMatch(/act \? \(\s*<HodActions/);
    expect(page).toMatch(/\{act \? <th scope="col" className="p-3">From the list<\/th> : null\}/);
  });

  it("checks the address of a report before it asks the database for it", () => {
    expect(page).toMatch(/isUuid\(q\.run\)/);
    expect(route).toMatch(/part !== "list" && part !== "missing" && part !== "sheets"/);
    expect(route).toMatch(/isUuid\(run\)/);
    expect(actions.match(/isUuid\(id\)/g)?.length).toBe(4);
  });

  it("is a page the menu knows below Leader cards, with a way back to it", () => {
    const lc = SECTIONS.flatMap((s) => s.pages).find((p) => p.href === "/admin/people/leader-cards");
    expect(lc?.children).toEqual([{ href: "/admin/people/leader-cards/reconcile", label: "Check the heads-of-department list" }]);
    expect(existsSync(join(ROOT, "src/app/(app)/admin/people/leader-cards/reconcile/page.tsx"))).toBe(true);
    expect(crumbsFor("/admin/people/leader-cards/reconcile").map((c) => c.label)).toEqual(["Admin", "People", "Leader cards", "Check the heads-of-department list"]);
    expect(page).toMatch(/back=\{BACK\}/);
    expect(read("src/app/(app)/admin/people/leader-cards/page.tsx")).toContain('href="/admin/people/leader-cards/reconcile"');
  });

  it("makes a report without sending anything, appointing anyone or touching an account", () => {
    expect(code).not.toMatch(/enqueue_message|notify_role|insert\s+into\s+public\.messages/i);
    expect(code).not.toMatch(/insert\s+into\s+public\.person_roles|update\s+public\.people|update\s+auth\.|insert\s+into\s+public\.leader_appointments|update\s+public\.tribes/i);
    // The one place anything is sent or written about a person: tagging puts a label, inviting uses the existing function
    expect([...code.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]).sort()).toEqual(["hod_reconcile_rows", "hod_reconciles", "leader_departments"]);
    expect([...code.matchAll(/perform\s+public\.(\w+)/gi)].map((m) => m[1]).filter((f) => f !== "write_event")).toEqual(["invite_person"]);
  });

  it("leaves the tables and helpers shut and opens the six functions to signed-in people only, who are checked inside", () => {
    expect(code).toMatch(/revoke all on table public\.hod_reconciles from public, anon, authenticated;/);
    expect(code).toMatch(/revoke all on table public\.hod_reconcile_rows from public, anon, authenticated;/);
    expect(code).toMatch(/revoke execute on function public\.hod_email_norm\(text\), public\.hod_results\(uuid\) from public, anon, authenticated;/);
    const grants = code.match(/grant execute on function([\s\S]*?)to authenticated;/)![1];
    expect([...grants.matchAll(/public\.(hod_\w+)\(/g)].map((m) => m[1]).sort()).toEqual(["hod_reconcile_delete", "hod_reconcile_get", "hod_reconcile_invite", "hod_reconcile_list", "hod_reconcile_run", "hod_reconcile_tag"]);
    for (const fn of ["run", "get", "list", "tag", "invite", "delete"]) {
      const body = code.match(new RegExp(`create function public\\.hod_reconcile_${fn}\\([\\s\\S]*?\\n\\$\\$;`))![0];
      expect(body, fn).toMatch(/auth\.uid\(\) is null/);
      expect(body, fn).toMatch(/leader_cards_role\(\)|has_any_role\(/);
    }
  });

  it("writes the log without a name, an address or a number", () => {
    const events = [...code.matchAll(/write_event\([^;]*;/g)].map((m) => m[0]);
    expect(events.length).toBe(4);
    for (const e of events) expect(e).not.toMatch(/email|phone|name|\.department/i);
  });

  it("answers with the same five results the page has words for, and the same keys the page reads", () => {
    for (const k of HOD_RESULTS) expect(code, k).toContain(`'${k}'`);
    for (const key of ["leader_dept", "tagged_at", "invited_at", "invited_n", "'missing'", "'rows'", "'run'", "'by'", "'note'", "'counts'", "'made_at'"]) expect(code, key).toContain(key.replace(/'/g, ""));
  });
});
