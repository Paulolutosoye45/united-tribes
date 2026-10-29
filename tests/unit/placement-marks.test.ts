import { describe, expect, it } from "vitest";
import { placementMark } from "@/lib/placement/marks";
import { contactLine, groupNote } from "@/lib/placement/placed";
import type { PlacedState } from "@/lib/placement/types";

// What a leader sees beside a church-placed member, and what a placed member is told about their details and the group link.

describe("the mark beside a member the church placed", () => {
  it("is nothing for a member who chose their own seat", () => {
    expect(placementMark({}, "Ada")).toBeNull();
    expect(placementMark({ placement: null, contact: "open" }, "Ada")).toBeNull();
  });

  it("says yes, details open, or yet to answer, in that order of what is known", () => {
    expect(placementMark({ placement: "confirmed", contact: "open" }, "Ada")?.label).toBe("Placed by the church · said yes");
    expect(placementMark({ placement: "pending", contact: "open" }, "Ada")?.label).toBe("Placed by the church · details open");
    expect(placementMark({ placement: "pending", contact: "holding", contact_opens_at: "2027-02-12T10:00:00Z" }, "Ada")?.label).toBe("Placed by the church · yet to answer");
  });

  it("says when a held member's details open, in Lagos time, and that a no still stops it", () => {
    const m = placementMark({ placement: "pending", contact: "holding", contact_opens_at: "2027-02-12T10:00:00Z" }, "Ada");
    expect(m?.note).toMatch(/open Fri 12 Feb, 11:00 am/);
    expect(m?.note).toMatch(/unless Ada says no first/);
  });

  it("says a member who was not reached is not reached, and that their contact is not open", () => {
    for (const contact of ["waiting", "not_reached"]) {
      const m = placementMark({ placement: "pending", contact }, "Dayo");
      expect(m?.label).toBe("Placed by the church · not yet reached");
      expect(m?.note).toMatch(/not open/);
    }
  });

  it("says a member who held back held back, whichever way the database says it", () => {
    for (const input of [{ placement: "pending", contact: "withheld" }, { placement: "pending", withheld: true }, { placement: "confirmed", withheld: true }]) {
      const m = placementMark(input, "Chi");
      expect(m?.label).toBe("Placed by the church · details withheld");
      expect(m?.note).toMatch(/They have your details/);
    }
  });

  it("never carries a number, an email or anything the member told us in private", () => {
    for (const contact of ["open", "holding", "waiting", "not_reached", "withheld", undefined]) {
      const m = placementMark({ placement: "pending", contact, contact_opens_at: "2027-02-12T10:00:00Z" }, "Ada");
      expect(`${m?.label} ${m?.note}`).not.toMatch(/\+\d|@|faith|grief|score|percent/i);
    }
  });
});

const placed = (o: Partial<PlacedState> = {}): PlacedState => ({
  found: true,
  firstName: "Ada",
  active: true,
  confirmed: false,
  withheld: false,
  leaderTold: false,
  canChange: true,
  fit: "strong",
  hasWhatsapp: true,
  contact: "waiting",
  contactOpensAt: null,
  contactLate: false,
  groupVisible: false,
  groupOpensAt: null,
  tribe: { name: "Builders", leaderFirst: "Ngozi", assistantFirst: null, meetingDay: 3, meetingTime: "18:00", mode: "online", placeNote: "", groupUrl: null, firstMeetingBy: null, season: "S1", startsOn: "2027-02-14", god: "", others: "", life: "" },
  ...o,
});

describe("what a placed member is told about their details", () => {
  it("says the leader can already see their name, and when the rest opens", () => {
    expect(contactLine(placed({ contact: "waiting" }))).toMatch(/Ngozi can see your name\. A day after we have emailed you/);
    expect(contactLine(placed({ contact: "holding", contactOpensAt: "2027-02-12T10:00:00Z" }))).toMatch(/Ngozi can see your name\. They are given your email and your WhatsApp number on Fri 12 Feb, 11:00 am/);
    expect(contactLine(placed({ contact: "open" }))).toBe("Ngozi has been given your name, your email and your WhatsApp number.");
    expect(contactLine(placed({ contact: "withheld", withheld: true }))).toMatch(/will not be given your email and your WhatsApp number/);
  });

  it("leaves out the WhatsApp number when they gave none", () => {
    expect(contactLine(placed({ contact: "open", hasWhatsapp: false }))).toBe("Ngozi has been given your name, your email.");
  });

  it("explains why there is no group link yet, and warns that joining shows their number", () => {
    expect(groupNote(placed())).toMatch(/as soon as you press “Yes, I’m in”, or a day after we have emailed you/);
    expect(groupNote(placed({ groupOpensAt: "2027-02-12T10:00:00Z" }))).toMatch(/on Fri 12 Feb, 11:00 am/);
    expect(groupNote(placed())).toMatch(/shows your number to everyone in it/);
  });

  it("says nothing about the group when the link is shown, or the member was not placed by the church", () => {
    expect(groupNote(placed({ groupVisible: true }))).toBeNull();
    expect(groupNote(null)).toBeNull();
    expect(groupNote(placed({ active: false }))).toBeNull();
  });
});
