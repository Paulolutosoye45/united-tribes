import { describe, expect, it } from "vitest";
import { AGREEMENT_VERSION, COVENANT_PROMISES, labelFor, reasonsFor, reasonText, seatsLine, welcomeMessage, whenLine, whereLine } from "@/lib/matching/wording";
import type { TribeCardForMember } from "@/lib/matching/types";

const card: TribeCardForMember = {
  id: "c1",
  name: "Tola’s Professionals tribe",
  community: "Professionals",
  track: "Builders",
  goal: "Step into a leadership role",
  tribe_type: "mixed",
  story: "My story.",
  leader_photo_id: null,
  leader_first_name: "Tola",
  meeting_day: 3,
  meeting_time: "20:00",
  duration_minutes: 75,
  mode: "in_person",
  zone: "mainland",
  place_note: null,
  capacity: 10,
  seats_left: 4,
  open: true,
  god: "a",
  others: "b",
  life: "c",
  season_starts_on: "2027-02-14",
};

describe("matching wording", () => {
  it("labels degrees the same way the database does", () => {
    expect(labelFor(97)).toBe("excellent");
    expect(labelFor(85)).toBe("excellent");
    expect(labelFor(84)).toBe("strong");
    expect(labelFor(70)).toBe("strong");
    expect(labelFor(69)).toBe("good");
    expect(labelFor(60)).toBe("good");
  });

  it("writes one plain sentence for every reason the engine can store", () => {
    const keys = ["goal_same", "goal_family", "stage_same", "community_same", "community_related", "community_second", "stage_near", "place_same", "place_near", "place_online", "rhythm_fit", "style_leader", "style_balance", "faith_needed", "seats_open"];
    for (const key of keys) {
      const text = reasonText(key, card);
      expect(text, key).toBeTruthy();
      expect(text, key).toMatch(/[.]$/);
      expect(text, key).not.toMatch(/undefined|null/);
    }
    expect(reasonText("goal_same", card)).toContain("Step into a leadership role");
    expect(reasonText("rhythm_fit", card)).toContain("Wednesdays at 8:00 pm");
  });

  it("drops a key it does not know, and never shows more than three", () => {
    expect(reasonText("made_up", card)).toBeNull();
    expect(reasonsFor(["goal_same", "made_up", "stage_same", "community_same", "rhythm_fit"], card)).toHaveLength(3);
  });

  it("describes when, where and how many seats", () => {
    expect(whenLine(card)).toBe("Wednesdays at 8:00 pm");
    expect(whereLine(card)).toBe("In person · Lagos Mainland · 75 minutes");
    expect(whereLine({ mode: "online", zone: "mainland", duration_minutes: 75 })).toBe("Online · 75 minutes");
    expect(seatsLine(0)).toBe("Full");
    expect(seatsLine(1)).toBe("1 seat left");
    expect(seatsLine(4)).toBe("4 seats left");
  });

  it("has a versioned agreement with four promises", () => {
    expect(AGREEMENT_VERSION).toMatch(/^[A-Za-z0-9._-]{1,24}$/);
    expect(COVENANT_PROMISES).toHaveLength(4);
  });

  it("writes a short welcome a leader can send", () => {
    const text = welcomeMessage({ memberFirst: "Ada", leaderFirst: "Tola", tribe: "Tola’s Professionals tribe", when: "Wednesday 18 Feb" });
    expect(text).toContain("Hello Ada");
    expect(text).toContain("Wednesday 18 Feb");
    expect(welcomeMessage({ memberFirst: "Ada", leaderFirst: "Tola", tribe: "X", when: null })).not.toContain("first time on");
  });
});
