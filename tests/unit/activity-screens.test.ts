import { describe, expect, it } from "vitest";
import { SCREENS, deviceOf, screenOf, speedOf, type Screen } from "@/lib/activity/screens";

// One real address for each of the 24 named screens. A page the list does not cover is never recorded.
const EXAMPLES: [string, Screen][] = [
  ["/home", "home"],
  ["/join", "join"],
  ["/tribe", "tribe"],
  ["/tribe/choose/7b1c1f4e-0000-4000-8000-000000000001", "tribe_choose"],
  ["/tribe/testimony", "testimony"],
  ["/testimonies", "testimonies"],
  ["/profile", "profile"],
  ["/community", "community"],
  ["/lead/apply", "lead_apply"],
  ["/lead", "lead_home"],
  ["/lead/week", "lead_week"],
  ["/lead/tribe", "lead_tribe"],
  ["/lead/update", "lead_update"],
  ["/lead/progress", "lead_progress"],
  ["/lead/academy", "lead_academy"],
  ["/lead/academy/declaration", "lead_academy"],
  ["/lead/academy/some-module", "lead_academy"],
  ["/review", "review"],
  ["/review/cards/abc", "review"],
  ["/care", "care"],
  ["/care/asks", "care"],
  ["/dashboard", "dashboard"],
  ["/reports", "reports"],
  ["/reports/abc", "reports"],
  ["/growth", "growth"],
  ["/growth/swaps", "growth"],
  ["/admin", "admin"],
  ["/admin/seasons", "admin"],
  ["/admin/people", "admin_people"],
  ["/admin/messages", "admin_messages"],
  ["/admin/signin", "admin_signin"],
];

describe("which screen an address is", () => {
  it("names every screen on the list from a real address", () => {
    for (const [path, screen] of EXAMPLES) expect(screenOf(path), path).toBe(screen);
    expect(new Set(EXAMPLES.map(([, s]) => s))).toEqual(new Set(SCREENS));
  });

  it("ignores a query, a fragment and a trailing slash, and never looks at them", () => {
    expect(screenOf("/home/")).toBe("home");
    expect(screenOf("/home?utm=x#top")).toBe("home");
    expect(screenOf("/tribe?id=1")).toBe("tribe");
  });

  it("records nothing for the owner's console, sign-in, public links or anything unlisted", () => {
    for (const path of ["/god", "/god/activity", "/god/activity/audit", "/god/people/abc", "/god/unlock", "/sign-in", "/auth/callback", "/privacy", "/r/abc", "/e/abc", "/reference/abc", "/guardian/abc", "/design", "/offline", "/", "", "home", "/homepage", "/api/track", "/tribes", "/leadership"]) {
      expect(screenOf(path), path).toBeNull();
    }
    expect(screenOf(null)).toBeNull();
    expect(screenOf(undefined)).toBeNull();
  });
});

describe("what kind of device, and how fast", () => {
  it("sorts a window into phone, tablet or desktop and nothing finer", () => {
    expect(deviceOf(320)).toBe("phone");
    expect(deviceOf(639)).toBe("phone");
    expect(deviceOf(640)).toBe("tablet");
    expect(deviceOf(1023)).toBe("tablet");
    expect(deviceOf(1024)).toBe("desktop");
    expect(deviceOf(0)).toBe("desktop");
    expect(deviceOf(Number.NaN)).toBe("desktop");
  });

  it("puts a load time into one of three bands, or says nothing", () => {
    expect(speedOf(250)).toBe("fast");
    expect(speedOf(999)).toBe("fast");
    expect(speedOf(1000)).toBe("ok");
    expect(speedOf(2999)).toBe("ok");
    expect(speedOf(3000)).toBe("slow");
    expect(speedOf(0)).toBeNull();
    expect(speedOf(-5)).toBeNull();
    expect(speedOf(null)).toBeNull();
    expect(speedOf(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
