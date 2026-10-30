import { describe, expect, it } from "vitest";
import { ROLES, navFor, type Role } from "@/lib/auth/roles";
import { canOpen } from "@/lib/guides/access";
import { GUIDES } from "@/lib/guides/catalogue";
import { helpFor } from "@/lib/guides/match";
import { AREA_ABOUT, controlsOf, pilotFor, searchGuides } from "@/lib/guides/pilot";
import { FRESH, pageKey, parseMemory, pulseFor, type PilotMemory } from "@/components/guides/pilot-state";
import { nameScore, norm } from "@/components/guides/pointer";

const everyone = (role: Role): Role[] => (role === "member" ? ["member"] : ["member", role]);

describe("what the How to use this app button is given", () => {
  it("offers a visitor only the guides that anyone with the link can open", () => {
    const data = pilotFor(null, []);
    expect(data.signedIn).toBe(false);
    expect(data.start.length).toBeGreaterThan(0);
    for (const g of data.start) expect(canOpen(GUIDES.find((x) => x.slug === g.slug)!, null), g.slug).toBe(true);
    for (const p of data.pages) expect(canOpen(GUIDES.find((x) => x.slug === p.slug)!, null), p.slug).toBe(true);
  });

  it("never offers a guide that would say it is for someone else, whoever is signed in", () => {
    for (const role of ROLES) {
      const held = everyone(role);
      const data = pilotFor(held, navFor(held));
      for (const g of data.start) if (g.slug !== "tribe-card") expect(canOpen(GUIDES.find((x) => x.slug === g.slug)!, held), `${role} start ${g.slug}`).toBe(true);
      for (const p of data.pages) expect(canOpen(GUIDES.find((x) => x.slug === p.slug)!, held), `${role} page ${p.slug}`).toBe(true);
    }
  });

  it("starts a signed-in person with something other than signing in, and a leader with the Tribe Card", () => {
    const member = pilotFor(["member"], navFor(["member"]));
    expect(member.start.map((g) => g.slug)).not.toContain("sign-in");
    expect(member.start.length).toBeLessThanOrEqual(4);
    const leader = pilotFor(["member", "leader"], navFor(["member", "leader"]));
    expect(leader.start[0].slug).toBe("tribe-card");
    expect(leader.start.length).toBeLessThanOrEqual(4);
  });

  it("says what every place in every person’s menu is for, so the tour never skips one", () => {
    for (const role of ROLES) {
      const held = everyone(role);
      for (const item of navFor(held)) expect(AREA_ABOUT[item.href], `${role}: ${item.href}`).toBeTruthy();
    }
    for (const owner of [true]) for (const item of navFor(["member"], owner)) expect(AREA_ABOUT[item.href], `owner: ${item.href}`).toBeTruthy();
  });

  it("lists the buttons a guide names once each, as the screen spells them", () => {
    const g = GUIDES.find((x) => x.slug === "whatsapp-health")!;
    const controls = controlsOf(g);
    expect(controls).toContain("Pause all WhatsApp messages");
    expect(controls).toContain("Check now");
    expect(new Set(controls).size).toBe(controls.length);
    for (const guide of GUIDES) expect(controlsOf(guide).length, guide.slug).toBeLessThanOrEqual(60);
  });

  it("gives each page the guide that is that person’s, and the same page a different guide for a different person", () => {
    const leader = pilotFor(["member", "leader"], []);
    const assistant = pilotFor(["member", "assistant_leader"], []);
    expect(helpFor(leader.pages, "/lead/week")?.slug).toBe("run-your-week");
    expect(helpFor(assistant.pages, "/lead/week")?.slug).toBe("assistant-leader");
    expect(helpFor(pilotFor(["member"], []).pages, "/lead/week")).toBeNull();
    // The controls the button may point at come from the guide itself
    expect(helpFor(leader.pages, "/lead/week")!.controls).toContain("Record the call");
  });
});

describe("finding a guide by what a person wants to do", () => {
  it("finds the guide whose title has the words first", () => {
    expect(searchGuides(["member", "admin"], "whatsapp health")[0]?.slug).toBe("whatsapp-health");
    expect(searchGuides(["member"], "testimony")[0]?.slug).toBe("share-a-testimony");
  });
  it("matches every word, and nothing for a word nobody uses", () => {
    expect(searchGuides(["member"], "testimony zzzzqx")).toEqual([]);
    expect(searchGuides(["member"], "   ")).toEqual([]);
    expect(searchGuides(["member"], "!!")).toEqual([]);
  });
  it("never finds a guide the person may not open", () => {
    for (const role of ROLES) {
      const held = everyone(role);
      for (const q of ["week", "tribe", "whatsapp", "decide", "place", "reference", "leader", "message"]) {
        for (const hit of searchGuides(held, q, 20)) if (hit.slug !== "tribe-card") expect(canOpen(GUIDES.find((x) => x.slug === hit.slug)!, held), `${role} "${q}" ${hit.slug}`).toBe(true);
      }
    }
    expect(searchGuides(["member"], "pause whatsapp").map((h) => h.slug)).not.toContain("whatsapp-health");
    expect(searchGuides(null, "run your week").map((h) => h.slug)).not.toContain("run-your-week");
  });
  it("offers a leader the Tribe Card guide", () => {
    expect(searchGuides(["member", "leader"], "tribe card").map((h) => h.slug)).toContain("tribe-card");
    expect(searchGuides(["member"], "tribe card").map((h) => h.slug)).not.toContain("tribe-card");
  });
  it("returns at most the number asked for", () => {
    expect(searchGuides(["member", "leader", "admin"], "the", 3).length).toBeLessThanOrEqual(3);
  });
});

describe("how the button looks, and what it remembers", () => {
  const seen = (over: Partial<PilotMemory>): PilotMemory => ({ ...FRESH, ...over });
  it("pulses boldly for someone who has never opened it", () => {
    expect(pulseFor(FRESH, "/home", false, false)).toBe("strong");
    expect(pulseFor(FRESH, "/profile", true, false)).toBe("strong");
  });
  it("then pulses softly only on a page whose guide has not been looked at", () => {
    expect(pulseFor(seen({ opens: 2 }), "/profile", true, false)).toBe("soft");
    expect(pulseFor(seen({ opens: 2, pages: ["/profile"] }), "/profile", true, false)).toBe("still");
    expect(pulseFor(seen({ opens: 2 }), "/profile", true, true)).toBe("still");
    expect(pulseFor(seen({ opens: 2 }), "/home", false, false)).toBe("still");
    expect(pulseFor(seen({ opens: 2, pages: ["/profile"] }), "/profile/", true, false)).toBe("still");
  });
  it("is still for anyone who asked for it to be, even a new person", () => {
    expect(pulseFor(seen({ quiet: true }), "/home", true, false)).toBe("still");
  });
  it("reads what was kept defensively: anything odd means a new person", () => {
    expect(parseMemory("")).toEqual(FRESH);
    expect(parseMemory("{not json")).toEqual(FRESH);
    expect(parseMemory("null")).toEqual(FRESH);
    expect(parseMemory(JSON.stringify({ opens: -4, quiet: "yes", pages: [1, "/a", { x: 1 }] }))).toEqual({ ...FRESH, pages: ["/a"] });
    expect(parseMemory(JSON.stringify({ opens: 3, quiet: true, toured: true, bubbleGone: true, pages: ["/a"] }))).toEqual({ opens: 3, quiet: true, toured: true, bubbleGone: true, pages: ["/a"] });
    expect(parseMemory(JSON.stringify({ opens: 1e12 })).opens).toBeLessThanOrEqual(1_000_000);
    expect(parseMemory(JSON.stringify({ pages: Array.from({ length: 200 }, (_, i) => `/p${i}`) })).pages.length).toBe(60);
  });
  it("treats a page with and without a trailing slash as one", () => {
    expect(pageKey("/lead/week/")).toBe("/lead/week");
    expect(pageKey("/")).toBe("/");
    expect(pageKey("")).toBe("/");
  });
});

describe("finding the real button a guide names", () => {
  it("ignores capitals, curly quotes and spacing", () => {
    expect(norm("  Ask   the church about a member’s place ")).toBe("ask the church about a member's place");
    expect(nameScore("Ask the church about a member's place", "Ask the church about a member’s place")).toBe(3);
  });
  it("prefers the exact name, then one that starts with it, then one that contains it", () => {
    expect(nameScore("Save", "Save")).toBe(3);
    expect(nameScore("Save my answers", "Save my")).toBe(2);
    expect(nameScore("Press Save my answers now", "Save my answers")).toBe(1);
    expect(nameScore("Cancel", "Save")).toBe(0);
  });
  it("never lets a short label match part of another word", () => {
    expect(nameScore("Call back", "Call")).toBe(2); // starts with a four-letter label
    expect(nameScore("Recall", "All")).toBe(0);
    expect(nameScore("Notes", "No")).toBe(0);
    expect(nameScore("", "Call")).toBe(0);
    expect(nameScore("Call", "")).toBe(0);
  });
});
