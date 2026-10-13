import { describe, expect, it } from "vitest";
import { ERASURE_BLOCKERS } from "@/lib/admin/types";
import { buildExport, exportFilename } from "@/lib/privacy/export";
import { BLOCKER_TEXT, blockerText, readMyRequest, readQueue, whatItTouches } from "@/lib/privacy/wording";

const row = (over: Record<string, unknown> = {}) => ({
  person: "p1",
  name: "Ada Okafor",
  email: "ada@example.org",
  status: "open",
  note: "Please",
  by_office: false,
  requested_at: "2026-10-01T10:00:00Z",
  decided_at: null,
  decision_note: null,
  roles: ["member"],
  in_tribes: 1,
  care_records: 0,
  blockers: [],
  ...over,
});

describe("what the office reads", () => {
  it("has a plain sentence for everything that can stand in the way", () => {
    for (const b of ERASURE_BLOCKERS) expect(blockerText(b).length).toBeGreaterThan(20);
    expect(Object.keys(BLOCKER_TEXT).sort()).toEqual([...ERASURE_BLOCKERS].sort());
  });

  it("reads the queue the database sends and drops anything that is not the right shape", () => {
    const q = readQueue([row(), row({ person: "p2", status: "declined", decision_note: "Not yet", decided_at: "2026-10-02T10:00:00Z", blockers: ["leads_a_tribe", "something_new"] }), { person: 3 }, null, "x", row({ status: "weird" })]);
    expect(q.map((r) => r.person)).toEqual(["p1", "p2"]);
    expect(q[1].blockers).toEqual(["leads_a_tribe"]);
    expect(q[1].decision_note).toBe("Not yet");
    expect(readQueue(null)).toEqual([]);
    expect(readQueue({})).toEqual([]);
  });

  it("says what a deletion would touch, and only what applies", () => {
    const plain = whatItTouches({ in_tribes: 0, care_records: 0, roles: ["member"] });
    expect(plain).toHaveLength(1);
    const full = whatItTouches({ in_tribes: 2, care_records: 1, roles: ["member", "coach", "care_lead"] }).join(" ");
    expect(full).toMatch(/2 tribes/);
    expect(full).toMatch(/1 care record\b/);
    expect(full).toMatch(/coach, care lead roles/);
    expect(whatItTouches({ in_tribes: 1, care_records: 0, roles: ["coach"] }).join(" ")).toMatch(/1 tribe:/);
    expect(whatItTouches({ in_tribes: 0, care_records: 0, roles: ["coach"] }).join(" ")).toMatch(/Their coach role\./);
  });
});

describe("what a member reads about their own request", () => {
  it("has three states", () => {
    expect(readMyRequest(null)).toEqual({ status: "none" });
    expect(readMyRequest({})).toEqual({ status: "none" });
    expect(readMyRequest({ status: "open", requested_at: "2026-10-01T10:00:00Z" })).toEqual({ status: "open", requested_at: "2026-10-01T10:00:00Z" });
    expect(readMyRequest({ status: "declined", decided_at: "2026-10-02T10:00:00Z", decision_note: "We must keep a record" })).toEqual({ status: "declined", decided_at: "2026-10-02T10:00:00Z", decision_note: "We must keep a record" });
    expect(readMyRequest({ status: "open" })).toEqual({ status: "none" });
  });
});

describe("the member's file", () => {
  const data = { about_this_file: "About.", made_at: "2026-10-12T10:00:00Z", you: { name: "Ada" }, tribes: [] };

  it("starts with the explanation and carries the private notes, with the choices in words", () => {
    const file = buildExport(data, { supportChips: ["quiet", "grief", "not-a-known-chip"], supportNote: "Evenings are hard.", leaderNote: "Please call me Ada." });
    expect(Object.keys(file)[0]).toBe("about_this_file");
    expect(file.you).toEqual({ name: "Ada" });
    expect(file.your_private_notes).toEqual({
      what_would_help_care_for_you: { chosen: ["A quieter, smaller tribe", "I am grieving", "not-a-known-chip"], in_your_words: "Evenings are hard." },
      note_to_your_leader: "Please call me Ada.",
    });
  });

  it("says nothing was written when nothing was, and leaves the database's answer as it was", () => {
    const copy = JSON.parse(JSON.stringify(data));
    const file = buildExport(data, {});
    expect(file.your_private_notes).toEqual({ what_would_help_care_for_you: { chosen: [], in_your_words: null }, note_to_your_leader: null });
    expect(data).toEqual(copy);
  });

  it("is named by the day it was made", () => {
    expect(exportFilename(new Date("2026-10-12T23:30:00Z"))).toBe("my-united-tribes-data-2026-10-12.json");
  });
});
