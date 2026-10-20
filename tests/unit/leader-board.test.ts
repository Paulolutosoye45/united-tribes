import { describe, expect, it } from "vitest";
import { BOARD_OFFER_ROLES, BOARD_VIEW_ROLES, OFFICE_ROLES } from "@/lib/auth/roles";
import {
  gapSentence,
  goalsInNeed,
  interestSentence,
  noSuggestionsLine,
  offerFootnote,
  otherGoals,
  parseBoard,
  parseMyOffer,
  parseOffers,
  parseSuggestions,
  waitingLine,
  type BoardGoal,
} from "@/lib/leaders/board";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const goal = (o: Partial<BoardGoal> = {}): BoardGoal => ({
  goalId: ID(1), title: "Win my first ten paying customers", community: "Business", waiting: 6, seatsOpen: 0, gap: 6,
  interestedFirst: 0, interestedBackup: 0, ready: true, card: "signed_off", openOffers: 0, ...o,
});

describe("who sees the board", () => {
  it("is the office to read, and the pastor, directors and admin to offer: the data lead reads only", () => {
    expect([...BOARD_VIEW_ROLES].sort()).toEqual([...OFFICE_ROLES].sort());
    expect([...BOARD_OFFER_ROLES].sort()).toEqual(["admin", "director", "pastor"]);
    expect(BOARD_OFFER_ROLES.every((r) => BOARD_VIEW_ROLES.includes(r))).toBe(true);
    expect(BOARD_OFFER_ROLES).not.toContain("data_lead");
  });
});

describe("reading the board", () => {
  const raw = {
    season: { id: ID(9), name: "Season 3" },
    model: "lf-1",
    cards_signed: 100,
    missing: null,
    goals: [
      { goal_id: ID(1), title: "A", community_name: "Business", waiting: 6, seats_open: 0, gap: 6, interested_first: 2, interested_backup: 1, ready: true, card: "signed_off", open_offers: 1 },
      { goal_id: "nope", title: "B" },
      { goal_id: ID(2), title: "", waiting: 3 },
      { goal_id: ID(3), title: "C", community_name: "Marriage", waiting: 1, seats_open: 4, gap: -3, interested_first: 0, interested_backup: 0, ready: false, card: "draft", open_offers: 0 },
    ],
    few_options: [{ person_id: ID(5), name: "Ngozi", shown: 1, source: "quiet", ran_at: "2026-10-01T10:00:00Z" }, { person_id: "x" }],
  };

  it("keeps what is in the expected shape and leaves out the rest", () => {
    const b = parseBoard(raw);
    expect(b).not.toBeNull();
    expect(b?.goals.map((g) => g.title)).toEqual(["A", "C"]);
    expect(b?.season).toEqual({ id: ID(9), name: "Season 3" });
    expect(b?.cardsSigned).toBe(100);
    expect(b?.fewOptions.map((f) => f.name)).toEqual(["Ngozi"]);
    expect(b?.goals[0]).toMatchObject({ waiting: 6, gap: 6, interestedFirst: 2, interestedBackup: 1, ready: true, openOffers: 1 });
    expect(b?.goals[1]).toMatchObject({ gap: -3, ready: false });
  });

  it("gives nothing for a reply that is not an object, and never throws", () => {
    for (const bad of [null, undefined, "x", 3, [], true]) expect(parseBoard(bad)).toBeNull();
    expect(parseBoard({})?.goals).toEqual([]);
    expect(parseBoard({ goals: "x", few_options: 5 })).toMatchObject({ goals: [], fewOptions: [] });
  });

  it("splits the goals the board shows into the ones needing a leader and the rest", () => {
    const b = parseBoard(raw)!;
    expect(goalsInNeed(b).map((g) => g.title)).toEqual(["A"]);
    expect(otherGoals(b).map((g) => g.title)).toEqual(["C"]);
  });

  it("never reads a negative count as a count of people", () => {
    const b = parseBoard({ goals: [{ goal_id: ID(1), title: "A", waiting: -4, seats_open: -1, gap: -5 }] })!;
    expect(b.goals[0]).toMatchObject({ waiting: 0, seatsOpen: 0, gap: -5 });
  });
});

describe("saying it in words", () => {
  it("says the gap, with the seats already open", () => {
    expect(gapSentence(goal())).toBe("6 people waiting. 6 more seats are needed.");
    expect(gapSentence(goal({ waiting: 1, gap: 1 }))).toBe("1 person waiting. One more seat is needed.");
    expect(gapSentence(goal({ waiting: 5, seatsOpen: 2, gap: 3 }))).toBe("5 people waiting, and 2 seats are open. 3 more seats are needed.");
    expect(gapSentence(goal({ waiting: 5, seatsOpen: 1, gap: 4 }))).toContain("1 seat is open");
    expect(gapSentence(goal({ waiting: 2, seatsOpen: 4, gap: -2 }))).toBe("2 people waiting, and the open seats cover them.");
    expect(gapSentence(goal({ waiting: 0, gap: 0 }))).toBe("Nobody is waiting.");
  });

  it("says how many leaders chose it", () => {
    expect(interestSentence(goal())).toBe("No leader has chosen it.");
    expect(interestSentence(goal({ interestedFirst: 1 }))).toBe("1 leader chose it first.");
    expect(interestSentence(goal({ interestedFirst: 2, interestedBackup: 1 }))).toBe("2 leaders chose it first, 1 leader named it as a backup.");
    expect(interestSentence(goal({ interestedBackup: 3 }))).toBe("3 leaders named it as a backup.");
  });

  it("counts in words up to twelve and never says nobody is waiting", () => {
    expect(waitingLine(1)).toBe("One person is waiting");
    expect(waitingLine(9)).toBe("Nine people are waiting");
    expect(waitingLine(13)).toBe("13 people are waiting");
    expect(waitingLine(0)).toBe("One person is waiting");
  });
});

describe("reading suggestions", () => {
  const ok = {
    status: "ok", model: "lf-1", waiting: 6, seats_open: 0, gap: 6,
    suggestions: [
      { person_id: ID(1), name: "Ngozi", degree: 88, label: "excellent", next_to: false, choice: "first", reason: "Her calling is close to this tribe." },
      { person_id: ID(2), name: "Tunde", degree: 72, label: "strong", next_to: true, choice: null },
      { person_id: ID(3), name: "Bad", degree: 90, label: "superb" },
      { person_id: "x", name: "Worse", label: "good" },
    ],
  };

  it("keeps well-formed suggestions and supplies a plain reason when one is missing", () => {
    const s = parseSuggestions(ok)!;
    expect(s.suggestions.map((x) => x.name)).toEqual(["Ngozi", "Tunde"]);
    expect(s.suggestions[1]).toMatchObject({ choice: null, nextToTheirStage: true, reason: "Their answers fit this tribe." });
    expect(s.suggestions[0]).toMatchObject({ choice: "first", degree: 88, label: "excellent" });
  });

  it("caps the degree at 100 and refuses a status it does not know", () => {
    expect(parseSuggestions({ ...ok, suggestions: [{ person_id: ID(1), name: "A", degree: 140, label: "good" }] })?.suggestions[0].degree).toBe(100);
    expect(parseSuggestions({ status: "mystery", suggestions: [] })).toBeNull();
    expect(parseSuggestions(null)).toBeNull();
  });

  it("says why nobody is suggested", () => {
    expect(noSuggestionsLine(parseSuggestions({ status: "no_card", message: "This goal’s card is not signed off.", suggestions: [] })!)).toBe("This goal’s card is not signed off.");
    expect(noSuggestionsLine(parseSuggestions({ status: "ok", suggestions: [] })!)).toMatch(/No leader without a tribe fits this one well enough yet/);
    expect(noSuggestionsLine(parseSuggestions({ status: "no_model", suggestions: [] })!)).toBe("Nobody can be suggested yet.");
  });
});

describe("reading offers", () => {
  it("keeps the offers in the expected shape, with no name where the owner made one", () => {
    const offers = parseOffers([
      { id: ID(1), person_id: ID(2), goal_id: ID(3), name: "Ngozi", goal: "A", community: "Business", status: "offered", waiting_at_offer: 4, offered_by: null, tribe_id: null },
      { id: ID(4), person_id: ID(2), goal_id: ID(3), status: "mystery" },
      { id: "x" },
      { id: ID(5), person_id: ID(6), goal_id: ID(3), name: "Tunde", goal: "B", status: "accepted", tribe_id: ID(7), offered_by: "Pastor Femi" },
    ]);
    expect(offers.map((o) => o.name)).toEqual(["Ngozi", "Tunde"]);
    expect(offers[0].offeredBy).toBeNull();
    expect(offers[1]).toMatchObject({ status: "accepted", tribeId: ID(7), offeredBy: "Pastor Femi" });
    expect(parseOffers("x")).toEqual([]);
  });

  it("reads the leader’s own offer, and nothing when it is missing or incomplete", () => {
    expect(parseMyOffer(null)).toBeNull();
    expect(parseMyOffer({ offer_id: ID(1) })).toBeNull();
    const mine = parseMyOffer({ offer_id: ID(1), goal_id: ID(2), goal: "A", community: "Business", waiting: 4, waiting_at_offer: 6, expires_at: "2026-11-03T10:00:00Z" })!;
    expect(mine).toMatchObject({ offerId: ID(1), waiting: 4, waitingAtOffer: 6 });
    expect(Object.keys(mine).sort()).toEqual(["community", "expiresAt", "goal", "goalId", "offerId", "offeredAt", "waiting", "waitingAtOffer"]);
  });

  it("tells the leader plainly how the number has changed since the offer", () => {
    const base = { offerId: ID(1), goalId: ID(2), goal: "A", community: "", offeredAt: null, expiresAt: null };
    expect(offerFootnote({ ...base, waiting: 6, waitingAtOffer: 6 })).toBeNull();
    expect(offerFootnote({ ...base, waiting: 9, waitingAtOffer: 6 })).toBeNull();
    expect(offerFootnote({ ...base, waiting: 4, waitingAtOffer: 6 })).toBe("When we asked, 6 were waiting.");
    expect(offerFootnote({ ...base, waiting: 0, waitingAtOffer: 6 })).toMatch(/offer stands/);
  });
});
