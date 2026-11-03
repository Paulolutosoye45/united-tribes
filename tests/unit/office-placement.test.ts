import { describe, expect, it } from "vitest";
import {
  parseFind, parseOfficeCounts, parseOfficePerson, parseOfficeTribe, parseOfficeTribes, parseOneCheck, parseOneOptions, parseRequests,
} from "@/lib/placement/types";

// Place or move one person from Admin: what the pages read from the database, and what they drop when it is not usable.

const P = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";

describe("the check for an admin or a director", () => {
  const base = {
    ok: true,
    blockers: [],
    warnings: [
      { code: "after_cutoff", text: "Joining for this season closed on 15 November 2026", owner_only: false },
      { code: "no_score", text: "There is no fit score", owner_only: true },
      { code: "held", text: "Held", source: "removal" },
    ],
    person: { id: P, name: "Tobi" },
    tribe: { id: T, name: "Mid", leader: "Ngozi", active: 3, capacity: 12 },
    degree: 72, label: "strong", window: null, who: "director", move: true, from: { id: R, name: "Old" },
  };

  it("keeps whose authority it ran with, whether it is a move, the tribe they would leave, and which warnings only the owner may accept", () => {
    const c = parseOneCheck(base);
    expect(c).toMatchObject({ who: "director", move: true, from: { id: R, name: "Old" } });
    expect(c?.warnings.map((w) => [w.code, w.ownerOnly])).toEqual([["after_cutoff", false], ["no_score", true], ["held", false]]);
  });

  it("reads an older answer as the owner's, a placement and not a move", () => {
    const c = parseOneCheck({ ...base, who: undefined, move: undefined, from: null, warnings: [{ code: "full", text: "Full" }] });
    expect(c).toMatchObject({ who: "owner", move: false, from: null });
    expect(c?.warnings[0].ownerOnly).toBe(false);
  });

  it("marks a tribe the person sits in, and one the church took them out of", () => {
    const o = parseOneOptions([
      { tribe: T, name: "A", leader: "N", active: 1, capacity: 12, degree: 70, label: "strong", below_floor: false, removed: true, current: false },
      { tribe: R, name: "B", leader: "N", active: 1, capacity: 12, degree: null, label: null, below_floor: false, current: true },
    ]);
    expect(o.map((x) => [x.removed, x.current])).toEqual([[true, false], [false, true]]);
  });
});

describe("finding a member", () => {
  it("reads who they are, where they sit, whether they finished the form and whether they lead; drops what has no id", () => {
    const rows = parseFind([{ id: P, name: "Tobi A", email: "t@example.org", tribe: "Mid", has_form: true, leads: false }, { name: "no id" }, 4]);
    expect(rows).toEqual([{ id: P, name: "Tobi A", email: "t@example.org", tribe: "Mid", hasForm: true, leads: false }]);
    expect(parseFind(null)).toEqual([]);
  });
});

describe("one person, one tribe and the tribes of the season", () => {
  it("reads a person with their seat, their hold and their last placement", () => {
    const p = parseOfficePerson({
      mode: "on", role: "admin", person: { id: P, name: "Tobi", email: "t@example.org" }, member: true, leads: false, form: true,
      seat: { tribe: T, name: "Mid", leader: "Ngozi" }, hold: { source: "care", until: null },
      last: { run: R, tribe: "Mid", at: "2026-11-03T10:00:00Z", moved: true, by: "Ada", undoable: true },
    });
    expect(p).toMatchObject({ mode: "on", role: "admin", seat: { tribe: T }, hold: { source: "care", until: null }, last: { run: R, moved: true, undoable: true } });
    expect(parseOfficePerson({ mode: "on" })).toBeNull();
    expect(parseOfficePerson({ person: { id: "bad" } })).toBeNull();
    expect(parseOfficePerson({ person: { id: P, name: "T", email: "e" }, mode: "maybe", role: "root" })).toMatchObject({ mode: "off", role: "owner", seat: null, last: null });
  });

  it("reads the tribes and one tribe, and drops what is not usable", () => {
    const list = parseOfficeTribes({ mode: "rehearsal", role: "director", tribes: [{ id: T, name: "Mid", leader: "N", active: 2, capacity: 12, open: true }, { id: "bad" }] });
    expect(list).toMatchObject({ mode: "rehearsal", role: "director" });
    expect(list?.tribes).toHaveLength(1);
    const one = parseOfficeTribe({
      mode: "on", role: "admin", tribe: { id: T, name: "Mid", leader: "N", active: 2, capacity: 12, open: false, window: null },
      recent: [{ run: R, person: P, name: "Tobi", at: null, moved: false, by: null, undoable: false }, { run: R }],
    });
    expect(one?.tribe.open).toBe(false);
    expect(one?.recent).toHaveLength(1);
    expect(one?.recent[0]).toMatchObject({ run: R, person: P, tribe: "Mid", name: "Tobi" });
    expect(parseOfficeTribe({})).toBeNull();
    expect(parseOfficeTribes("no")).toBeNull();
  });
});

describe("the requests to the owner", () => {
  const row = { id: R, person: P, name: "Tobi", tribe: T, tribe_name: "Mid", move: false, asked_by: "Ada", asked_role: "director", mine: true, codes: ["no_score", 4], reason: "Asked in person", told: true, asked_at: "2026-11-03T10:00:00Z", expires_at: "2026-11-10T10:00:00Z", status: "open", decided_at: null, decision_note: null, run: null };

  it("reads a request with its words, drops an unknown status and a row with no person", () => {
    const rows = parseRequests([row, { ...row, status: "maybe" }, { ...row, person: "bad" }, null]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ askedRole: "director", mine: true, codes: ["no_score"], told: true, status: "open", tribeName: "Mid", run: null });
    expect(parseRequests(undefined)).toEqual([]);
  });

  it("reads the owner's counts by person", () => {
    const c = parseOfficeCounts({ requests_open: 2, by_person: [{ name: "Ada", role: "admin", placed: 3, moved: 1, undone: 1, today: 2, last: "2026-11-03T10:00:00Z" }, 5] });
    expect(c).toEqual({ requestsOpen: 2, byPerson: [{ name: "Ada", role: "admin", placed: 3, moved: 1, undone: 1, today: 2, last: "2026-11-03T10:00:00Z" }] });
    expect(parseOfficeCounts([])).toBeNull();
  });
});
