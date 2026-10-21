import { describe, expect, it } from "vitest";
import { previewOf } from "@/lib/admin/notice-preview";
import { DELIVERY_WORDS, MODE_WORDS, logStatus, noticeTitle, noticesOf, parseLog, parseOverview, parsePrefs } from "@/lib/admin/notices";
import { NOTICE_CATALOGUE, NOTICE_GROUPS } from "@/lib/messaging/templates-notices";

describe("what the Notifications page reads", () => {
  const raw = {
    can_edit: true,
    groups: [
      { key: "pastors", mode: "rehearsal", updated_at: "2027-01-04T09:00:00Z", people: [{ id: "p1", name: "Tunde A.", role: "pastor", can_be_told: true, delivery: "daily" }, { id: "p2", name: "Bola", role: "pastor", can_be_told: false, delivery: "instant" }] },
      { key: "members", mode: "off", updated_at: null, people: null },
      { key: "wizards", mode: "on", people: [] },
    ],
    numbers: [{ key: "decision_days", value: 7, note: "Days an application can wait" }, { key: "bad", value: "x", note: "no" }],
    faults: [{ at: "2027-01-04T09:00:00Z", source: "notice_card", message: "boom" }],
  };

  it("reads the groups, leaving out one we do not know and a number that is not a number", () => {
    const o = parseOverview(raw)!;
    expect(o.canEdit).toBe(true);
    expect(o.groups.map((g) => g.key)).toEqual(["pastors", "members"]);
    expect(o.groups[0].mode).toBe("rehearsal");
    expect(o.groups[0].people).toEqual([
      { id: "p1", name: "Tunde A.", role: "pastor", canBeTold: true, delivery: "daily" },
      { id: "p2", name: "Bola", role: "pastor", canBeTold: false, delivery: "instant" },
    ]);
    expect(o.groups[1].people).toBeNull();
    expect(o.numbers).toEqual([{ key: "decision_days", value: 7, note: "Days an application can wait" }]);
    expect(o.faults).toHaveLength(1);
  });

  it("treats a mode it does not know as Off, so an odd value never looks switched on", () => {
    expect(parseOverview({ groups: [{ key: "admin", mode: "maybe" }] })!.groups[0].mode).toBe("off");
    expect(parseOverview({ groups: [{ key: "admin", mode: "on" }] })!.groups[0].mode).toBe("on");
  });

  it("never throws on a surprise", () => {
    for (const bad of [null, undefined, 4, "x", [], true]) expect(parseOverview(bad)).toBeNull();
    const o = parseOverview({ groups: [null, 3, { key: "admin", people: [null, {}, { id: "x" }] }], numbers: "x", faults: [null] })!;
    expect(o.canEdit).toBe(false);
    expect(o.groups[0].people).toEqual([{ id: "x", name: "Someone", role: "", canBeTold: false, delivery: "daily" }]);
    expect(o.numbers).toEqual([]);
  });

  it("reads the log, and says what each row came to", () => {
    const rows = parseLog([
      { id: "40220e07-5120-4619-9a55-a90d91e2c6de", template: "pastor_decision_ready", group: "pastors", status: "skipped", error: "Rehearsal: written to the log, not sent", at: "2027-01-04T09:00:00Z", sent_at: null, to: "Tunde", rehearsal: true },
      { id: "fe7f57f4-f35a-4b75-bdc5-bee08e09aa0e", template: "admin_queue_stuck", group: "admin", status: "failed", error: "mailbox full", at: "2027-01-04T08:00:00Z", sent_at: null, to: "Mary", rehearsal: false },
      { id: "x" }, null, { id: 3 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["40220e07-5120-4619-9a55-a90d91e2c6de", "fe7f57f4-f35a-4b75-bdc5-bee08e09aa0e"]);
    expect(logStatus(rows[0])).toEqual({ label: "Rehearsal: not sent", tone: "quiet" });
    expect(logStatus(rows[1])).toEqual({ label: "Failed", tone: "bad" });
    expect(logStatus({ status: "delivered", rehearsal: false }).tone).toBe("ok");
    expect(logStatus({ status: "read", rehearsal: false }).label).toBe("Opened");
    expect(logStatus({ status: "queued", rehearsal: false }).tone).toBe("wait");
    expect(logStatus({ status: "weird", rehearsal: false }).label).toBe("weird");
    expect(noticeTitle("pastor_decision_ready")).toBe("An application is ready for a pastor's decision");
    expect(noticeTitle("something_else")).toBe("something else");
  });

  it("reads a person's own choices, only for groups it knows", () => {
    expect(parsePrefs([{ group: "admin", delivery: "weekly", mode: "on" }, { group: "pastors", delivery: "nonsense", mode: "nonsense" }, { group: "wizards" }, null])).toEqual([
      { group: "admin", delivery: "weekly", mode: "on" },
      { group: "pastors", delivery: "daily", mode: "off" },
    ]);
    expect(parsePrefs("x")).toEqual([]);
  });

  it("has words for every mode and every choice", () => {
    expect(Object.keys(MODE_WORDS)).toEqual(["off", "rehearsal", "on"]);
    expect(DELIVERY_WORDS).toEqual({ instant: "Right away", daily: "A daily summary", weekly: "A weekly summary" });
  });

  it("lists each group's notices", () => {
    for (const g of NOTICE_GROUPS) expect(noticesOf(g.key).length, g.key).toBeGreaterThan(0);
    expect(noticesOf("pastors").map((n) => n.key)).toContain("pastor_referee_concern");
    expect(NOTICE_CATALOGUE.filter((n) => n.group !== "digest").length).toBe(NOTICE_GROUPS.reduce((n, g) => n + noticesOf(g.key).length, 0));
  });
});

describe("how a notice reads on the Notifications page", () => {
  it("shows every notice with a subject, the words and where its button goes", () => {
    for (const n of NOTICE_CATALOGUE) {
      const p = previewOf(n.key);
      expect(p, n.key).not.toBeNull();
      expect(p!.subject.length, n.key).toBeGreaterThan(8);
      expect(p!.paragraphs.length + p!.sections.length, n.key).toBeGreaterThan(0);
      if (p!.button) expect(p!.button.path.startsWith("/"), n.key).toBe(true);
    }
  });

  it("is made by the real template, with made-up names", () => {
    const p = previewOf("pastor_referee_concern")!;
    expect(p.paragraphs.join(" ")).toContain("not in this email");
    expect(p.greeting).toBe("Hi Ada,");
    expect(p.button).toEqual({ label: "Read it on the review page", path: "/review" });
    expect(previewOf("referee_thanks")!.button).toBeNull();
  });

  it("shows the summary with a part for each role", () => {
    const p = previewOf("staff_digest")!;
    expect(p.sections.map((s) => s.title)).toEqual(["Admin", "Pastor"]);
    expect(p.sections[1].items.length).toBe(3);
  });

  it("gives nothing for a notice that does not exist", () => {
    expect(previewOf("nope")).toBeNull();
  });
});
