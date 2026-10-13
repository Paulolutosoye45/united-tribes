import { describe, expect, it } from "vitest";
import { mockProvider } from "@/lib/ai/providers/mock";
import { GOLD, LEADER_BARS, checkLeaderBars, memoryPrints, runGold, summarise } from "../../scripts/bakeoff/leaders-lib";
import { WRITTEN_FIELDS } from "@/lib/leaders/quality/fields";

// The labelled applications, run offline. The stand-in judge reads word patterns only, so this proves the plumbing and the
// parts that never depend on a model (plain checks, fingerprints, quote checking, the decision rule). What a real model does
// with the rest is measured with `npm run bakeoff:leaders` and a key, before the switch is turned on.

describe("the labelled leader applications", () => {
  it("has about seventy answers over fourteen applications, every one complete", () => {
    expect(GOLD).toHaveLength(14);
    for (const c of GOLD) {
      expect(c.expect.length, c.id).toBeGreaterThan(0);
      for (const f of WRITTEN_FIELDS) expect(c.answers[f]?.trim().length, `${c.id} ${f}`).toBeGreaterThan(10);
    }
    expect(new Set(GOLD.map((c) => c.id)).size).toBe(GOLD.length);
    // a copy always comes after its source, so the fingerprints find it
    for (const c of GOLD.filter((x) => x.copiesFrom)) expect(GOLD.findIndex((x) => x.id === c.copiesFrom)).toBeLessThan(GOLD.indexOf(c));
  });

  it("covers what the check must be fair to and what it must catch", () => {
    const ids = GOLD.map((c) => c.id).join(" ");
    for (const wanted of ["pidgin", "mixed", "brief", "honest", "mashing", "instruction", "copied", "duplicate", "generic", "thin", "off-topic", "hollow"]) {
      expect(ids, wanted).toContain(wanted);
    }
  });
});

describe("the fingerprints, in memory", () => {
  it("finds the same words in another application, and the same words twice in one", async () => {
    const rpc = memoryPrints();
    const print = (app: string, field: string, norm: string, sim: string, words: number) => rpc("worker_leader_print", { p_app: app, p_field: field, p_norm_hash: norm, p_simhash: sim, p_words: words });
    await print("a", "why", "h1", "100", 20);
    expect((await print("b", "why", "h1", "100", 20)).data).toMatchObject({ other_apps: ["a"], same_in_own: [] });
    expect((await print("c", "why", "h2", "101", 20)).data).toMatchObject({ other_apps: ["a", "b"] }); // one bit apart is a copy
    expect((await print("d", "why", "h3", String(BigInt("-1")), 20)).data).toMatchObject({ other_apps: [] }); // far apart is not
    expect((await print("e", "why", "h1", "100", 6)).data).toMatchObject({ other_apps: [] }); // short answers never count
    await print("f", "why", "h9", "5000000", 20);
    expect((await print("f", "walkNote", "h9", "5000000", 20)).data).toMatchObject({ same_in_own: ["why"] });
  });
});

describe("on the offline stand-in judge", () => {
  it("passes every good application, in Pidgin, with Yoruba, brief and honest included", async () => {
    const results = await runGold(mockProvider());
    const strong = results.filter((r) => r.expect.length === 1 && r.expect[0] === "clear");
    expect(strong.length).toBeGreaterThanOrEqual(5);
    for (const r of strong) expect(r.outcome, r.id).toBe("clear");
  });

  it("never clears what no model is needed to catch, and holds each for a person", async () => {
    const results = await runGold(mockProvider());
    const deterministic = results.filter((r) => r.deterministic);
    expect(deterministic.map((r) => r.id).sort()).toEqual(["copied-yemi", "duplicate-jide", "instruction-tobi", "mashing-femi", "same-twice-seyi"]);
    for (const r of deterministic) {
      expect(r.outcome, r.id).toBe("held");
      expect(r.falseClear, r.id).toBe(false);
    }
    const flagsOf = (id: string) => new Set(results.find((r) => r.id === id)!.runs.flatMap((x) => x.flags));
    expect(flagsOf("mashing-femi").has("gibberish")).toBe(true);
    expect(flagsOf("instruction-tobi").has("instruction_attempt")).toBe(true);
    expect(flagsOf("copied-yemi").has("copied_or_templated")).toBe(true);
    expect(flagsOf("duplicate-jide").has("duplicate_of_other")).toBe(true);
    expect(flagsOf("same-twice-seyi").has("same_in_two_answers")).toBe(true);
    // no AI is asked about answers that are plainly not real
    for (const id of ["mashing-femi", "instruction-tobi"]) expect(results.find((r) => r.id === id)!.runs.every((x) => !x.aiRan), id).toBe(true);
  });

  it("does not clear generic, thin or hollow applications", async () => {
    const results = await runGold(mockProvider());
    for (const id of ["generic-emeka", "thin-kunle", "hollow-ifeanyi"]) expect(results.find((r) => r.id === id)!.outcome, id).not.toBe("clear");
  });

  it("is honest about what it cannot do: it reads words, not meaning, so an off-topic application can slip through it", async () => {
    // This is why the switch's page warns about test mode, and why `npm run bakeoff:leaders` with a real key comes first.
    const results = await runGold(mockProvider());
    const summary = summarise(results);
    const bars = checkLeaderBars(summary);
    expect(bars.map((b) => b.name)).toContain("Cleared when it must not be");
    expect(summary.falseClears).toBeLessThanOrEqual(1);
    expect(summary.quotesDropped).toBe(0);
    expect(summary.failureRate).toBe(0);
    expect(summary.agreement).toBeGreaterThanOrEqual(LEADER_BARS.agreement);
  });

  it("gives the same outcomes every time", async () => {
    const results = await runGold(mockProvider(), { runs: 3 });
    expect(results.every((r) => r.stable)).toBe(true);
    expect(results.every((r) => r.runs.length === 3)).toBe(true);
  });

  it("counts a reading that fails as no score, never as a pass", async () => {
    const broken = { ...mockProvider(), name: "broken", async judge() { throw new Error("down"); } };
    const results = await runGold(broken, { cases: GOLD.slice(0, 2) });
    expect(results.every((r) => r.outcome === "unscored" && r.runs.every((x) => x.failed))).toBe(true);
    expect(summarise(results).failureRate).toBe(1);
  });
});
