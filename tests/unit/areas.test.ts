import { describe, expect, it } from "vitest";
import { AREAS, areaBySlug, areaFromStory, areaNamed, matchAreas, normalise } from "@/lib/intake/areas";
import { ZONES } from "@/lib/intake/options";

describe("areas", () => {
  it("only uses zones the matching engine knows, and has a clean unique slug for each place", () => {
    const zones = new Set<string>(ZONES.map((z) => z.id));
    const slugs = new Set<string>();
    for (const a of AREAS) {
      expect(zones.has(a.zone), a.name).toBe(true);
      expect(a.slug, a.name).toMatch(/^[a-z0-9-]{1,48}$/);
      slugs.add(a.slug);
    }
    expect(slugs.size, "a place is listed twice").toBe(AREAS.length);
  });

  it("puts the places named on the form in the zones the form describes", () => {
    const zoneOf = (n: string) => areaNamed(n)?.zone;
    expect(zoneOf("Iganmu")).toBe("iganmu-surulere");
    expect(zoneOf("Surulere")).toBe("iganmu-surulere");
    for (const n of ["Yaba", "Ikeja", "Maryland", "Ikorodu"]) expect(zoneOf(n)).toBe("mainland");
    for (const n of ["Victoria Island", "Ikoyi", "Lekki", "Ajah"]) expect(zoneOf(n)).toBe("island-lekki");
    expect(zoneOf("Abuja")).toBe("other-nigeria");
    expect(zoneOf("Port Harcourt")).toBe("other-nigeria");
    expect(zoneOf("London")).toBe("abroad");
  });

  it("finds places as people type, best match first, ignoring case, accents and punctuation", () => {
    expect(matchAreas("yab")[0].name).toBe("Yaba");
    expect(matchAreas("YABA")[0].name).toBe("Yaba");
    expect(matchAreas("ile ife")[0].name).toBe("Ile-Ife");
    expect(matchAreas("oj").map((a) => a.name)).toEqual(expect.arrayContaining(["Ojodu Berger", "Ojota", "Ojuelegba", "Ojo"]));
    expect(matchAreas("berger")[0].name).toBe("Ojodu Berger");
    expect(matchAreas("v.i.")[0]?.name).toBe("Victoria Island");
    expect(matchAreas("dubai")[0].name).toBe("United Arab Emirates");
    expect(matchAreas("a")).toEqual([]);
    expect(matchAreas("zzzz")).toEqual([]);
    expect(matchAreas("la", 3)).toHaveLength(3);
  });

  it("finds the zone for a nickname and looks places up by slug", () => {
    expect(areaNamed("VI")?.name).toBe("Victoria Island");
    expect(areaNamed("uk")?.zone).toBe("abroad");
    expect(areaNamed("nowhere")).toBeNull();
    expect(areaBySlug("yaba")?.name).toBe("Yaba");
    expect(areaBySlug("nope")).toBeNull();
    expect(normalise("  Ẹ̀pẹ́!  ")).toBe("epe");
  });

  it("reads where someone lives from their story, and not where they work", () => {
    expect(areaFromStory("I work in a bank on the Island. Married with two small kids, we live in Yaba.")?.name).toBe("Yaba");
    expect(areaFromStory("I am based in Sangotedo and I run a small shop.")?.name).toBe("Sangotedo");
    expect(areaFromStory("We moved to Abuja last year.")?.zone).toBe("other-nigeria");
    expect(areaFromStory("I work in Victoria Island and commute daily.")).toBeNull();
    expect(areaFromStory("Just finished NYSC and trusting God.")).toBeNull();
    expect(areaFromStory("")).toBeNull();
  });
});
