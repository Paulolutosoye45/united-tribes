import { describe, expect, it } from "vitest";
import {
  changedWeights,
  checkProposal,
  parseFitModels,
  parseFitStatus,
  parseQuiet,
  proposalFrom,
  quietSentence,
  weightsLine,
  whatIsMissing,
  type FitModel,
} from "@/lib/leaders/fit-admin";

const W = { calling: 35, judgement: 20, style: 20, need: 15, stage: 10, care_bar: 70, unassessed_judgement: 60 };
const model = (over: Record<string, unknown> = {}) => ({ version: "lf-1", weights: W, min_degree: 60, active: false, notes: "First proposal", parent: null, created_at: "2026-10-01T00:00:00Z", approved_at: null, approved_by: null, ...over });

describe("reading the model versions", () => {
  it("reads them in order", () => {
    const got = parseFitModels([model(), model({ version: "lf-2", active: true, approved_by: "Pastor Ade", approved_at: "2026-10-02T00:00:00Z" })]);
    expect(got.map((m) => m.version)).toEqual(["lf-1", "lf-2"]);
    expect(got[1].active).toBe(true);
    expect(got[1].approvedBy).toBe("Pastor Ade");
    expect(got[0].weights.care_bar).toBe(70);
  });
  it("leaves out a version whose numbers are not whole numbers from 0 to 100", () => {
    expect(parseFitModels([model({ weights: { ...W, calling: 35.5 } }), model({ weights: { ...W, need: 101 } }), model({ weights: { calling: 100 } }), null, "x"])).toEqual([]);
    expect(parseFitModels("nope")).toEqual([]);
  });
});

describe("reading where it stands", () => {
  const status = { tribe_fit: "off", ready: false, model: null, cards: { signed_off: 0, total: 100 }, leaders: { total: 8, quiet_run: 0 } };
  it("reads a status", () => {
    const s = parseFitStatus({ ...status, tribe_fit: "on", ready: true, model: { version: "lf-1", approved_at: "2026-10-02T00:00:00Z", approved_by: null }, cards: { signed_off: 23, total: 100 }, leaders: { total: 8, quiet_run: 8 } })!;
    expect(s.on).toBe(true);
    expect(s.ready).toBe(true);
    expect(s.model?.version).toBe("lf-1");
    expect(s.cardsSignedOff).toBe(23);
    expect(s.quietRun).toBe(8);
    expect(parseFitStatus(null)).toBeNull();
    expect(parseFitStatus([])).toBeNull();
  });
  it("says what is missing, and nothing when the switch can be turned on", () => {
    expect(whatIsMissing(parseFitStatus(status)!)).toHaveLength(2);
    expect(whatIsMissing(parseFitStatus({ ...status, model: { version: "lf-1" }, cards: { signed_off: 1, total: 100 } })!)).toEqual([]);
    expect(whatIsMissing(parseFitStatus({ ...status, model: { version: "lf-1" } })!)).toEqual([expect.stringContaining("No tribe card")]);
  });
});

describe("proposing a new version", () => {
  const start = proposalFrom(parseFitModels([model()])[0] as FitModel);
  it("starts from the numbers of the version it follows", () => {
    expect(start.calling).toBe("35");
    expect(start.care_bar).toBe("70");
  });
  it("accepts five parts that add to 100", () => {
    const r = checkProposal({ ...start, calling: "40", need: "10" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.weights.calling).toBe(40);
  });
  it("says in words what is wrong", () => {
    const sum = checkProposal({ ...start, calling: "40" });
    expect(sum).toEqual({ ok: false, message: "The five parts add up to 105. They must add up to 100.", total: 105 });
    const bad = checkProposal({ ...start, style: "twenty" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toBe("Leading style must be a whole number from 0 to 100.");
    expect(checkProposal({ ...start, care_bar: "" }).ok).toBe(false);
    expect(checkProposal({ ...start, care_bar: "1.5" }).ok).toBe(false);
    expect(checkProposal({ ...start, care_bar: "-1" }).ok).toBe(false);
    expect(checkProposal({ ...start, care_bar: "1000" }).ok).toBe(false);
  });
  it("sends only what changed", () => {
    expect(changedWeights(W, { ...W, calling: 40, need: 10 })).toEqual({ calling: 40, need: 10 });
    expect(changedWeights(W, W)).toEqual({});
  });
  it("writes a version out in words", () => {
    expect(weightsLine(W)).toBe("calling 35, judgement 20, leading style 20, need 15, stage of life 10");
  });
});

describe("the quiet run", () => {
  it("reads and says what happened", () => {
    const r = parseQuiet({ model: "lf-1", ran: 6, already: 1, no_inputs: 1, no_application: 0 })!;
    expect(quietSentence(r)).toBe("6 leaders were looked at, 1 had been done already, 1 could not be done because their saved answers are not complete.");
    expect(quietSentence({ ran: 1, already: 0, noInputs: 0, noApplication: 2 })).toBe("1 leader was looked at, 2 have no application on file.");
    expect(parseQuiet(null)).toBeNull();
  });
});
