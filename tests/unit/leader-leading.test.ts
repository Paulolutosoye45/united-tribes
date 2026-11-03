import { describe, expect, it } from "vitest";
import { leadingFills, leadingLine, leadingTitle, parseLeadingPeople, parseMyLeading, peopleLine, type MyLeading } from "@/lib/leaders/leading";

// What the Lead page and the My tribe page say to a leader who leads a tribe, however they came to lead it.

const T = "44444444-4444-4444-8444-444444444444";
const lead = (o: Partial<MyLeading> = {}): MyLeading => ({ role: "leader", tribeId: T, tribeName: "Ada’s Professionals tribe", tribeStatus: "approved", members: 3, certified: true, ...o });

describe("reading what the database gives", () => {
  it("reads the tribe, its card, the people and whether they are certified, and nothing else", () => {
    expect(parseMyLeading({ role: "leader", tribe_id: T, tribe_name: "Ada’s Professionals tribe", tribe_status: "approved", members: 3, certified: true, appointed_by: "x", note: "y" })).toEqual(lead());
  });

  it("is null for nothing, for an odd answer, and for a tribe it cannot place, and never throws", () => {
    for (const raw of [null, undefined, "x", 3, [], true, {}, { role: "leader" }, { role: "member", tribe_id: T, tribe_status: "approved" }, { role: "leader", tribe_id: "nope", tribe_status: "approved" }, { role: "leader", tribe_id: T, tribe_status: "closed" }]) {
      expect(parseMyLeading(raw)).toBeNull();
    }
  });

  it("treats a missing or odd name as no name, and odd numbers as nobody", () => {
    expect(parseMyLeading({ role: "assistant", tribe_id: T, tribe_status: "draft" })).toEqual({ role: "assistant", tribeId: T, tribeName: null, tribeStatus: "draft", members: 0, certified: false });
    expect(parseMyLeading({ role: "leader", tribe_id: T, tribe_status: "draft", tribe_name: "  " })?.tribeName).toBeNull();
    expect(parseMyLeading({ role: "leader", tribe_id: T, tribe_status: "draft", tribe_name: "x".repeat(121) })?.tribeName).toBeNull();
    for (const members of [-2, NaN, "3", null, Infinity]) expect(parseMyLeading({ role: "leader", tribe_id: T, tribe_status: "approved", members })?.members).toBe(0);
    expect(parseMyLeading({ role: "leader", tribe_id: T, tribe_status: "approved", members: 4.9 })?.members).toBe(4);
    expect(parseMyLeading({ role: "leader", tribe_id: T, tribe_status: "approved", certified: "yes" })?.certified).toBe(false);
  });

  it("reads the people from the leader's own list, and drops what is not a person", () => {
    expect(
      parseLeadingPeople({
        members: [
          { person_id: "a", name: "Ngozi Eze", joined_at: "2026-10-12T09:00:00Z", called: true, whatsapp: "+234", note_enc: "secret" },
          { name: "  Tunde Bello ", joined_at: "soon", called: false },
          { name: "" },
          { joined_at: "2026-10-01" },
          null,
          5,
        ],
      }),
    ).toEqual([
      { name: "Ngozi Eze", joinedOn: "2026-10-12", called: true, mark: null },
      { name: "Tunde Bello", joinedOn: null, called: false, mark: null },
    ]);
  });

  it("is null when the list cannot be read", () => {
    for (const raw of [null, undefined, "x", {}, { members: "no" }]) expect(parseLeadingPeople(raw)).toBeNull();
    expect(parseLeadingPeople({ members: [] })).toEqual([]);
  });
});

describe("a leader's list marks the people the church placed", () => {
  it("lists a church-placed member by name with where their details stand, and carries no number or email", () => {
    const people = parseLeadingPeople({
      members: [
        { name: "Ada Okafor", first_name: "Ada", joined_at: "2026-10-12T09:00:00Z", called: false, placement: "pending", contact: "holding", contact_opens_at: "2026-10-13T10:00:00Z", whatsapp: null },
        { name: "Bola Ade", first_name: "Bola", joined_at: "2026-10-12", called: false, placement: "confirmed", contact: "open", whatsapp: "+2348030000000" },
        { name: "Chi Eze", first_name: "Chi", joined_at: "2026-10-12", called: false, placement: "pending", contact: "withheld", withheld: true },
        { name: "Dayo Bello", first_name: "Dayo", joined_at: "2026-10-12", called: false, placement: "pending", contact: "not_reached" },
        { name: "Eze Obi", first_name: "Eze", joined_at: "2026-10-12", called: false },
      ],
    });
    expect(people?.map((p) => p.mark)).toEqual([
      "Placed by the church · waiting for a reply",
      "Placed by the church · said yes",
      "Placed by the church · details withheld",
      "Placed by the church · not yet reached",
      null,
    ]);
    expect(JSON.stringify(people)).not.toMatch(/\+234|@/);
  });
});

describe("the words", () => {
  it("names the tribe in the heading when it has a name", () => {
    expect(leadingTitle(lead())).toBe("You lead Ada’s Professionals tribe.");
    expect(leadingTitle(lead({ tribeName: null }))).toBe("You lead a tribe.");
    expect(leadingTitle(lead({ role: "assistant" }))).toBe("You are the assistant leader of Ada’s Professionals tribe.");
    expect(leadingTitle(lead({ role: "assistant", tribeName: null }))).toBe("You are an assistant leader.");
  });

  it("counts the people in plain words", () => {
    expect(peopleLine(0)).toBe("No one has joined yet.");
    expect(peopleLine(1)).toBe("1 person has joined.");
    expect(peopleLine(7)).toBe("7 people have joined.");
  });

  it("says where the card stands, and how many have joined once it is approved", () => {
    expect(leadingLine(lead())).toBe("The Tribe Card is approved and members can find the tribe. 3 people have joined.");
    expect(leadingLine(lead({ members: 0 }))).toBe("The Tribe Card is approved and members can find the tribe. No one has joined yet.");
    expect(leadingLine(lead({ certified: false, members: 1 }))).toBe("The Tribe Card is approved. Members can find the tribe once the leader is certified. 1 person has joined.");
    expect(leadingLine(lead({ tribeStatus: "submitted", members: 0 }))).toBe("Your Tribe Card is with a pastor for approval.");
    expect(leadingLine(lead({ tribeStatus: "changes_requested", members: 0 }))).toBe("A pastor asked for changes to your Tribe Card. Open it to see what to change.");
    expect(leadingLine(lead({ tribeStatus: "draft", members: 0 }))).toBe("Your Tribe Card is started. Check it, then send it to a pastor.");
  });

  it("speaks to an assistant leader about the leader's card, not their own", () => {
    expect(leadingLine(lead({ role: "assistant", tribeStatus: "draft", members: 0 }))).toBe("The Tribe Card is still being written. You can read it here.");
    expect(leadingLine(lead({ role: "assistant", tribeStatus: "submitted", members: 0 }))).toBe("The Tribe Card is with a pastor for approval.");
  });

  it("never says how a leader came to lead, or that they applied", () => {
    for (const role of ["leader", "assistant"] as const) {
      for (const tribeStatus of ["draft", "submitted", "changes_requested", "approved"] as const) {
        const said = `${leadingTitle(lead({ role, tribeStatus }))} ${leadingLine(lead({ role, tribeStatus }))}`;
        expect(said).not.toMatch(/appoint|applic|invit|administrator|owner/i);
      }
    }
  });
});

describe("the shield", () => {
  it("fills as the card is sent, approved, the leader certified and someone joined", () => {
    expect(leadingFills(lead({ tribeStatus: "draft", certified: false, members: 0 }))).toEqual([0, 0, 0, 0]);
    expect(leadingFills(lead({ tribeStatus: "submitted", certified: false, members: 0 }))).toEqual([1, 0, 0, 0]);
    expect(leadingFills(lead({ tribeStatus: "approved", certified: false, members: 0 }))).toEqual([1, 1, 0, 0]);
    expect(leadingFills(lead())).toEqual([1, 1, 1, 1]);
  });
});
