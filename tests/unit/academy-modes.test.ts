import { describe, expect, it } from "vitest";
import { CARD_STATUS, certificationSummary, checklist, nextAction, shieldFills } from "@/lib/academy/options";
import { REQUIRED_MODES, academyOpen, andList, needsOf, parseAcademyModes, sinceLabel, trainingShown, type AcademyModes } from "@/lib/academy/modes";
import { afterDecision, approvedLine, trainingAsk, trainingButton, welcomeAsk } from "@/lib/academy/wording";
import type { CertState, ModuleSummary, MyAcademy } from "@/lib/academy/types";
import { statusLine, welcomeStages } from "@/lib/leaders/wording";

const modes = (academy: AcademyModes["academy"], declaration: AcademyModes["declaration"]): AcademyModes => ({ academy, declaration, academySince: null, declarationSince: null });
const ACADEMY = ["required", "optional", "off"] as const;
const DECLARATION = ["required", "off"] as const;

/** What the database says for a person, under the switches given (the keys it adds are named in 20261218000100_academy_switch.sql). */
const state = (academy: AcademyModes["academy"], declaration: AcademyModes["declaration"], over: Partial<CertState> = {}): CertState => ({
  modules_total: 6,
  modules_passed: 0,
  modules_done: false,
  declaration: false,
  practice: false,
  card_required: true,
  card: false,
  certified: false,
  modules_needed: academy === "required",
  practice_needed: academy === "required",
  declaration_needed: declaration === "required",
  ...over,
});

const modules = (passed: number): ModuleSummary[] =>
  Array.from({ length: 6 }, (_, i) => ({
    slug: `m${i + 1}`,
    number: i + 1,
    title: `Module ${i + 1}`,
    outcome: "",
    format: "30 min online",
    minutes: 30,
    opened: i < passed,
    attempts: i < passed ? 1 : 0,
    best: i < passed ? 100 : null,
    passed: i < passed,
  }));

const mine = (academy: AcademyModes["academy"], declaration: AcademyModes["declaration"], over: Partial<MyAcademy> = {}, stateOver: Partial<CertState> = {}): MyAcademy => ({
  is_leader: true,
  pass_mark: 80,
  modules: modules(0),
  sessions: [],
  attended: { practice_workshop: false, commissioning_workshop: false },
  declaration: null,
  practice: null,
  card: null,
  state: state(academy, declaration, stateOver),
  certified_at: null,
  modes: { academy, declaration },
  ...over,
});

describe("reading the switches", () => {
  it("reads what the database gives", () => {
    expect(parseAcademyModes({ academy: "optional", declaration: "off", academy_since: "2026-10-12T09:00:00Z", declaration_since: null })).toEqual({
      academy: "optional",
      declaration: "off",
      academySince: "2026-10-12T09:00:00Z",
      declarationSince: null,
    });
  });

  it("asks for everything when the switches cannot be read, whatever arrives", () => {
    for (const raw of [null, undefined, "", 7, [], [1], {}, { academy: 1 }, { academy: "maybe", declaration: "sometimes" }, { academy: null, declaration: null }]) {
      const m = parseAcademyModes(raw);
      expect(m.academy, JSON.stringify(raw)).toBe("required");
      expect(m.declaration, JSON.stringify(raw)).toBe("required");
    }
    expect(parseAcademyModes(null)).toEqual(REQUIRED_MODES);
  });

  it("ignores a date that is not a date", () => {
    expect(parseAcademyModes({ academy: "off", declaration: "off", academy_since: "soon", declaration_since: 5 }).academySince).toBeNull();
    expect(parseAcademyModes({ academy: "off", declaration: "off", academy_since: "soon", declaration_since: 5 }).declarationSince).toBeNull();
  });

  it("treats a missing key in a person's state as needed", () => {
    expect(needsOf(undefined)).toEqual({ modules: true, practice: true, declaration: true });
    expect(needsOf(null)).toEqual({ modules: true, practice: true, declaration: true });
    expect(needsOf({})).toEqual({ modules: true, practice: true, declaration: true });
    expect(needsOf({ modules_needed: false, practice_needed: false, declaration_needed: false })).toEqual({ modules: false, practice: false, declaration: false });
  });

  it("knows when there is any training to show", () => {
    expect(trainingShown(modes("required", "required"))).toBe(true);
    expect(trainingShown(modes("optional", "off"))).toBe(true);
    expect(trainingShown(modes("off", "required"))).toBe(true);
    expect(trainingShown(modes("off", "off"))).toBe(false);
    expect(academyOpen(modes("off", "required"))).toBe(false);
    expect(academyOpen(modes("optional", "off"))).toBe(true);
  });

  it("joins lists and writes dates by hand", () => {
    expect(andList([])).toBe("");
    expect(andList(["a"])).toBe("a");
    expect(andList(["a", "b"])).toBe("a and b");
    expect(andList(["a", "b", "c"])).toBe("a, b and c");
    expect(sinceLabel("2026-10-12T09:00:00Z")).toBe("12 October 2026");
    // 23:30 UTC is already the next day in Lagos
    expect(sinceLabel("2026-10-12T23:30:00Z")).toBe("13 October 2026");
    expect(sinceLabel(null)).toBeNull();
    expect(sinceLabel("never")).toBeNull();
  });
});

describe("with both switches Required, every line is the line it has always been", () => {
  const both = modes("required", "required");

  it("keeps the four conditions in their order, all needed", () => {
    const rows = checklist(mine("required", "required"));
    expect(rows.map((r) => r.id)).toEqual(["modules", "declaration", "practice", "card"]);
    expect(rows.every((r) => r.needed)).toBe(true);
    expect(rows[0].label).toBe("Six modules, 80% or better on each quiz");
    expect(rows[0].detail).toBe("0 of 6 passed");
    expect(rows[1].detail).toBe("Opens when you pass the care and safeguarding module");
    expect(rows[2].detail).toBe("Your coach arranges this after the first workshop");
    expect(rows[3].detail).toBe("Not started");
  });

  it("is the same when the database sends no new keys at all (an older reading)", () => {
    const old = mine("required", "required");
    const bare: Partial<CertState> = { ...old.state };
    delete bare.modules_needed;
    delete bare.practice_needed;
    delete bare.declaration_needed;
    expect(checklist({ ...old, state: bare as CertState, modes: undefined })).toEqual(checklist(old));
    expect(shieldFills({ state: bare as CertState })).toEqual(shieldFills(old));
    expect(certificationSummary({ is_leader: true, state: bare as CertState })).toEqual(certificationSummary(old));
  });

  it("sums up what certification needs", () => {
    expect(certificationSummary(mine("required", "required"))).toEqual({
      total: 4,
      done: 0,
      sentence: "Certification needs your modules, the safeguarding declaration, a practice session and an approved Tribe Card.",
    });
    expect(certificationSummary({ is_leader: false, state: state("required", "required", { card_required: false }) })).toMatchObject({ total: 3 });
  });

  it("sends a leader to the first module, then the declaration, then the workshops, then the card", () => {
    expect(nextAction(mine("required", "required")).href).toBe("/lead/academy/m1");
    expect(nextAction(mine("required", "required", { modules: modules(6) }, { modules_passed: 6, modules_done: true })).href).toBe("/lead/academy/declaration");
    expect(nextAction(mine("required", "required", { modules: modules(6) }, { modules_passed: 6, modules_done: true, declaration: true })).href).toBe("/lead/academy#workshops");
    expect(nextAction(mine("required", "required", { modules: modules(6) }, { modules_passed: 6, modules_done: true, declaration: true, practice: true })).href).toBe("/lead/tribe");
  });

  it("says what has always been said before an application and after approval", () => {
    expect(trainingAsk(both)).toBe("About 10 hours of training before your tribe begins, with a safeguarding course.");
    expect(approvedLine("approved_leader", both)).toBe("Welcome. Leader training is next.");
    expect(approvedLine("approved_assistant", both)).toBe("Welcome. You will serve beside a leader. Training is next.");
    expect(trainingButton(both)).toEqual({ label: "Open my training", href: "/lead/academy" });
    expect(statusLine("approved_leader")).toBe("Welcome. Leader training is next.");
  });
});

describe("what a screen asks of a person under each position", () => {
  for (const academy of ACADEMY) {
    for (const declaration of DECLARATION) {
      const label = `Academy ${academy}, declaration ${declaration}`;

      it(`${label}: the checklist shows what is on, and marks what is not needed`, () => {
        const rows = checklist(mine(academy, declaration));
        const ids = rows.map((r) => r.id);
        expect(ids.includes("modules"), "modules row").toBe(academy !== "off");
        expect(ids.includes("practice"), "practice row").toBe(academy !== "off");
        expect(ids.includes("declaration"), "declaration row").toBe(declaration === "required");
        expect(ids.includes("card"), "card row").toBe(true);
        for (const r of rows) {
          if (r.id === "modules" || r.id === "practice") expect(r.needed, r.id).toBe(academy === "required");
          if (r.id === "modules" && academy === "optional") expect(r.detail.startsWith("Not needed.")).toBe(true);
          if (r.id === "declaration" || r.id === "card") expect(r.needed, r.id).toBe(true);
        }
      });

      it(`${label}: the summary counts only what certification waits for`, () => {
        const want = [academy === "required" ? 1 : 0, declaration === "required" ? 1 : 0, academy === "required" ? 1 : 0, 1].reduce((a, b) => a + b, 0);
        const sum = certificationSummary(mine(academy, declaration));
        expect(sum.total).toBe(want);
        expect(sum.done).toBe(0);
        expect(sum.sentence).toContain("an approved Tribe Card");
        if (academy !== "required") expect(sum.sentence).not.toMatch(/module|practice/);
        if (declaration === "off") expect(sum.sentence).not.toContain("declaration");
      });

      it(`${label}: the shield is full wherever nothing stands in the way`, () => {
        const f = shieldFills(mine(academy, declaration));
        expect(f[0] === 1, "modules").toBe(academy !== "required");
        expect(f[1] === 1, "declaration").toBe(declaration === "off");
        expect(f[2] === 1, "practice").toBe(academy !== "required");
        expect(f[3]).toBe(0);
      });

      it(`${label}: a leader is never sent to something that is not needed`, () => {
        const a = nextAction(mine(academy, declaration));
        if (academy === "required") expect(a.href).toBe("/lead/academy/m1");
        else if (declaration === "required") expect(a.href).toBe("/lead/academy/declaration");
        else expect(a.href).toBe("/lead/tribe");
        // With nothing else left, the card is the last thing, and then there is only the pastorate
        const done = mine(academy, declaration, { modules: modules(6) }, { modules_passed: 6, modules_done: true, declaration: true, practice: true, card: true });
        expect(nextAction(done).title).toBe("Nearly there");
      });

      it(`${label}: the words before and after approval do not promise what is off`, () => {
        const m = modes(academy, declaration);
        const ask = trainingAsk(m);
        const line = approvedLine("approved_leader", m);
        const button = trainingButton(m);
        if (academy === "off" && declaration === "off") {
          expect(ask).toBeNull();
          expect(button).toBeNull();
          expect(line).toBe("Welcome. Your Tribe Card is next.");
        } else {
          expect(ask).toBeTruthy();
          expect(button).not.toBeNull();
        }
        if (academy !== "required") expect(`${ask ?? ""} ${line}`).not.toMatch(/10 hours|Training is next/);
        if (declaration === "off") expect(`${ask ?? ""} ${line}`).not.toMatch(/declaration/);
        if (academy === "off" && declaration === "required") expect(button).toEqual({ label: "Sign the safeguarding declaration", href: "/lead/academy/declaration" });
      });
    }
  }

  it("an assistant with both off has nothing left to do and nothing to wait for", () => {
    const assistant = { is_leader: false, state: state("off", "off", { card_required: false }) };
    expect(certificationSummary(assistant)).toEqual({ total: 0, done: 0, sentence: "Nothing more is needed to be certified." });
    expect(shieldFills(assistant)).toEqual([1, 1, 1, 1]);
    expect(approvedLine("approved_assistant", modes("off", "off"))).toBe("Welcome. You will serve beside a leader.");
  });

  it("an optional Academy stays open and does not push a leader into a module", () => {
    const my = mine("optional", "off");
    expect(nextAction(my).href).not.toMatch(/academy\/m\d/);
    expect(checklist(my).find((r) => r.id === "modules")?.done).toBe(false);
    // What has been done is still shown as done, whatever the switch asks
    const done = mine("optional", "off", { modules: modules(6) }, { modules_passed: 6, modules_done: true });
    expect(checklist(done).find((r) => r.id === "modules")?.done).toBe(true);
    expect(checklist(done).find((r) => r.id === "modules")?.detail).toBe("Not needed. 6 of 6 passed");
  });

  it("a certified leader is thanked, and sent to the card only if it is not yet approved", () => {
    const certified = mine("off", "off", { card: { id: "c", status: "approved", role: "leader" } }, { certified: true, card: true });
    expect(nextAction(certified).title).toBe("You are certified.");
    expect(nextAction(certified).href).toBe("/lead/academy");
    const waiting = mine("off", "off", { card: { id: "c", status: "submitted", role: "leader" } }, { certified: true });
    expect(nextAction(waiting).href).toBe("/lead/tribe");
    expect(CARD_STATUS.submitted).toBeDefined();
  });
});

describe("the Lead page status line", () => {
  it("uses the approval line for the positions given, and leaves every other status alone", () => {
    expect(statusLine("approved_leader", undefined, modes("off", "off"))).toBe("Welcome. Your Tribe Card is next.");
    expect(statusLine("approved_assistant", undefined, modes("optional", "required"))).toBe("Welcome. You will serve beside a leader. Leader training is optional, and there is a short safeguarding declaration to sign.");
    expect(statusLine("not_approved", undefined, modes("off", "off"))).toBe(statusLine("not_approved"));
    expect(statusLine("submitted", undefined, modes("off", "off"))).toBe(statusLine("submitted"));
  });
});

describe("the first screen of the application", () => {
  it("says what it has always said with the Academy and the declaration both required", () => {
    expect(welcomeAsk(modes("required", "required"))).toBe("What it asks of you: 75 minutes a week for 12 weeks, plus about 10 hours of training before your tribe begins.");
    expect(afterDecision(modes("required", "required"))).toBe("Training follows.");
    const stages = welcomeStages();
    expect(stages[stages.length - 1]).toEqual({ title: "A pastor decides", body: "You see the result here, with a short note. Training follows." });
    expect(welcomeStages(undefined, modes("required", "off"))).toEqual(stages);
  });

  for (const academy of ACADEMY) {
    for (const declaration of DECLARATION) {
      it(`Academy ${academy}, declaration ${declaration}: promises only the training that is on`, () => {
        const m = modes(academy, declaration);
        const words = `${welcomeAsk(m)} ${afterDecision(m)} ${welcomeStages(undefined, m).map((p) => p.body).join(" ")}`;
        if (academy !== "required") expect(words).not.toMatch(/10 hours/);
        if (academy === "off") expect(words).not.toMatch(/Academy|modules|workshop/i);
        if (declaration === "off") expect(words).not.toMatch(/declaration/);
        if (academy === "off" && declaration === "off") {
          expect(welcomeAsk(m)).toBe("What it asks of you: 75 minutes a week for 12 weeks.");
          expect(afterDecision(m)).toBe("");
          const last = welcomeStages(undefined, m).at(-1)!;
          expect(last.body).toBe("You see the result here, with a short note.");
        }
        if (academy === "optional") expect(welcomeAsk(m)).toContain("optional");
        if (declaration === "required" && academy !== "required") expect(`${welcomeAsk(m)} ${afterDecision(m)}`).toContain("declaration");
      });
    }
  }
});
