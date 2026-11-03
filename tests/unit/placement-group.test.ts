import { describe, expect, it } from "vitest";
import { GROUP_WORDS, parseGroupList } from "@/lib/placement/group";

// The leader's WhatsApp group list: what the screen reads from the database, and what it says.

const ID = "11111111-2222-4333-8444-555555555555";

describe("reading the group list", () => {
  it("reads who is ready to add, who is waiting, and who left", () => {
    const l = parseGroupList({
      has_link: true,
      admit: [{ person_id: ID, name: "Ada Okafor", whatsapp: "+2348031234567", private: false, admitted: true }],
      waiting: ["Bola Ade", "Chi Eze"],
      remove: [{ person_id: ID, name: "Dayo Bello", removed: false }],
    });
    expect(l).toEqual({
      has_link: true,
      admit: [{ person_id: ID, name: "Ada Okafor", whatsapp: "+2348031234567", private: false, admitted: true }],
      waiting: ["Bola Ade", "Chi Eze"],
      remove: [{ person_id: ID, name: "Dayo Bello", removed: false }],
    });
  });

  it("shows less, never more, when the answer is not the right shape", () => {
    expect(parseGroupList(null)).toBeNull();
    expect(parseGroupList("nope")).toBeNull();
    expect(parseGroupList([])).toBeNull();
    const l = parseGroupList({ admit: [null, 3, { name: "No id" }, { person_id: ID }], waiting: ["", 4, "Eze"], remove: [{ name: "No id" }] });
    expect(l).toEqual({ has_link: false, admit: [{ person_id: ID, name: "A member", whatsapp: null, private: false, admitted: false }], waiting: ["Eze"], remove: [] });
  });

  it("keeps a private number private: a member who kept it private has none to show", () => {
    const l = parseGroupList({ admit: [{ person_id: ID, name: "Ada", whatsapp: null, private: true, admitted: false }] });
    expect(l?.admit[0]).toMatchObject({ whatsapp: null, private: true });
  });
});

describe("the words", () => {
  it("says the group waits for a yes, and why", () => {
    expect(GROUP_WORDS.intro).toMatch(/only after they have said yes/);
    expect(GROUP_WORDS.intro).toMatch(/shows their number to everyone in it/);
    expect(GROUP_WORDS.waitingLine).toMatch(/not before/);
  });

  it("names the two ticks the guide points to", () => {
    expect(GROUP_WORDS.addedLabel).toBe("Added to the group");
    expect(GROUP_WORDS.removedLabel).toBe("Removed from the group");
  });

  it("never carries a number, an email or a date", () => {
    for (const line of Object.values(GROUP_WORDS)) expect(line).not.toMatch(/\+\d|@|\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|\bhours?\b|a day/);
  });
});
