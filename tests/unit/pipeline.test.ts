import { describe, expect, it } from "vitest";
import { SWITCHES, SWITCH_BY_ID, positionWord } from "@/lib/admin/wording";
import {
  DEFAULT_PIPELINE,
  ELIGIBILITY_KEYS,
  PRESETS,
  SWITCH_IDS,
  WIRED,
  changedSwitches,
  isWired,
  parsePipeline,
  parsePipelineLog,
  settingValue,
} from "@/lib/leaders/pipeline";

// What the database sends (leader_pipeline_public), at today's positions
const TODAY_JSON = {
  eligibility: { member6: "required", foundation: "required", serving: "required", age21: "required", time: "required", safeguarding: "required", confidentiality: "required" },
  references: "required",
  interview: "required",
  tribe_fit: "off",
  academy: "required",
  declaration: "required",
  preset: "full",
  updated_at: "2026-10-19T10:00:00Z",
};

describe("reading the positions", () => {
  it("reads what the database sends", () => {
    expect(parsePipeline(TODAY_JSON)).toEqual(DEFAULT_PIPELINE);
    const open = parsePipeline({ ...TODAY_JSON, eligibility: { ...TODAY_JSON.eligibility, member6: "off", foundation: "optional" }, references: "off", interview: "optional", tribe_fit: "on", academy: "off", declaration: "off", preset: "empty" });
    expect(open.eligibility.member6).toBe("off");
    expect(open.eligibility.foundation).toBe("optional");
    expect(open.eligibility.age21).toBe("required");
    expect(open.references).toBe("off");
    expect(open.interview).toBe("optional");
    expect(open.tribeFit).toBe(true);
    expect(open.academy).toBe("off");
    expect(open.declaration).toBe("off");
    expect(open.preset).toBe("empty");
  });

  it("gives today's process for anything it cannot read, and never throws", () => {
    for (const bad of [undefined, null, "", "nonsense", 7, [], [1, 2], {}, { eligibility: "x" }, { eligibility: [] }, { references: 3, interview: null, academy: {}, declaration: [] }]) {
      expect(parsePipeline(bad), JSON.stringify(bad)).toEqual(DEFAULT_PIPELINE);
    }
  });

  it("keeps what it can read and falls back to today's position for the rest", () => {
    const some = parsePipeline({ references: "off", interview: "maybe", eligibility: { age21: "off", time: "sometimes", extra: "off" } });
    expect(some.references).toBe("off");
    expect(some.interview).toBe("required");
    expect(some.eligibility.age21).toBe("off");
    expect(some.eligibility.time).toBe("required");
    expect(Object.keys(some.eligibility)).toEqual([...ELIGIBILITY_KEYS]);
  });

  it("treats a declaration that is anything but off as required, and Find your tribe as off unless it says on", () => {
    expect(parsePipeline({ declaration: "optional" }).declaration).toBe("required");
    expect(parsePipeline({ declaration: "off" }).declaration).toBe("off");
    expect(parsePipeline({ tribe_fit: "yes" }).tribeFit).toBe(false);
    expect(parsePipeline({ tribe_fit: "on" }).tribeFit).toBe(true);
  });

  it("does not hand out a shared object, so one screen cannot change another's view", () => {
    const a = parsePipeline(null);
    a.eligibility.age21 = "off";
    a.references = "off";
    expect(parsePipeline(null)).toEqual(DEFAULT_PIPELINE);
    expect(DEFAULT_PIPELINE.eligibility.age21).toBe("required");
  });
});

describe("the presets", () => {
  it("full process is today's positions", () => {
    expect(PRESETS.full).toEqual({
      eligibility: DEFAULT_PIPELINE.eligibility,
      references: "required",
      interview: "required",
      tribeFit: "off",
      academy: "required",
      declaration: "required",
    });
  });

  it("open door asks age, time, safeguarding and confidentiality only, and keeps training on", () => {
    expect(PRESETS.open_door.eligibility).toEqual({ member6: "off", foundation: "off", serving: "off", age21: "required", time: "required", safeguarding: "required", confidentiality: "required" });
    expect(PRESETS.open_door.references).toBe("off");
    expect(PRESETS.open_door.interview).toBe("off");
    expect(PRESETS.open_door.tribeFit).toBe("when_ready");
    for (const p of [PRESETS.full, PRESETS.open_door]) {
      expect(p.academy).toBe("required");
      expect(p.declaration).toBe("required");
    }
  });
});

describe("what is connected", () => {
  it("every switch is connected, Find your tribe being the last one", () => {
    expect(isWired("tribe_fit")).toBe(true);
    expect(WIRED.tribeFit).toBe(true);
    for (const id of SWITCH_IDS) expect(isWired(id), id).toBe(true);
    expect(WIRED.academy).toBe(true);
    expect(WIRED.declaration).toBe(true);
  });

  it("answers for every switch, and the page describes every switch once", () => {
    expect(SWITCH_IDS).toHaveLength(12);
    expect(SWITCHES.map((s) => s.id).sort()).toEqual([...SWITCH_IDS].sort());
    for (const id of SWITCH_IDS) {
      expect(typeof isWired(id)).toBe("boolean");
      const info = SWITCH_BY_ID[id];
      expect(info.title.length, id).toBeGreaterThan(3);
      // Each position the switch takes is explained, and today's position is one of them
      for (const o of info.options) expect(info.means[o]?.length, `${id} ${o}`).toBeGreaterThan(15);
      expect(info.options).toContain(settingValue(DEFAULT_PIPELINE, id));
    }
  });

  it("reads each switch's position by the name the database uses", () => {
    const p = parsePipeline({ ...TODAY_JSON, eligibility: { ...TODAY_JSON.eligibility, serving: "off" }, references: "optional", declaration: "off", tribe_fit: "on" });
    expect(settingValue(p, "elig_serving")).toBe("off");
    expect(settingValue(p, "elig_age21")).toBe("required");
    expect(settingValue(p, "references_mode")).toBe("optional");
    expect(settingValue(p, "interview_mode")).toBe("required");
    expect(settingValue(p, "tribe_fit")).toBe("on");
    expect(settingValue(p, "academy_mode")).toBe("required");
    expect(settingValue(p, "declaration_mode")).toBe("off");
  });

  it("lists only the switches that differ from where they stand", () => {
    expect(changedSwitches(DEFAULT_PIPELINE, {})).toEqual({});
    expect(changedSwitches(DEFAULT_PIPELINE, { elig_age21: "required", references_mode: "off" })).toEqual({ references_mode: "off" });
    expect(changedSwitches(DEFAULT_PIPELINE, { elig_age21: "off", tribe_fit: "off", declaration_mode: "off" })).toEqual({ elig_age21: "off", declaration_mode: "off" });
  });

  it("puts the positions in plain words", () => {
    expect(positionWord("required")).toBe("Required");
    expect(positionWord("optional")).toBe("Optional");
    expect(positionWord("off")).toBe("Off");
    expect(positionWord("on")).toBe("On");
  });
});

describe("the change log", () => {
  it("reads rows and drops the ones it cannot read", () => {
    const rows = parsePipelineLog([
      { at: "2026-10-19T10:00:00Z", batch: "b1", setting: "elig_time", label: "Time each week", old_value: "required", new_value: "off", preset: "open_door", reason: "  ", shown_as: "an administrator" },
      { at: "2026-10-19T09:00:00Z", batch: "b0", setting: "references_mode", old_value: "required", new_value: "optional", preset: "weird", reason: "agreed", shown_as: "" },
      { setting: "broken" },
      null,
      "x",
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ label: "Time each week", preset: "open_door", reason: null, shownAs: "an administrator" });
    expect(rows[1]).toMatchObject({ label: "references_mode", preset: "empty", reason: "agreed", shownAs: "an administrator" });
    expect(parsePipelineLog(undefined)).toEqual([]);
    expect(parsePipelineLog({})).toEqual([]);
  });
});
