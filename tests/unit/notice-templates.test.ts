import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmail, renderWhatsApp, renderSms } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import { NOTICE_CATALOGUE, NOTICE_GROUPS, NOTICE_SAMPLES, NOTICE_TEMPLATES } from "@/lib/messaging/templates-notices";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

const SITE = "https://unitedtribes.example";
const keys = NOTICE_TEMPLATES.map((t) => t.key);

function message(template: string, params: Params, over: Partial<ClaimedMessage["to"]> = {}): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    template,
    channel: "email",
    params,
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "ada@example.org", phone: null, name: "Ada Okafor", first_name: "Ada", ...over },
  };
}

const read = (file: string) => readFileSync(join(__dirname, "../../supabase/migrations", file), "utf8");
const SQL = `${read("20261225000100_notices.sql")}\n${read("20261225000200_notice_triggers.sql")}\n${read("20261229000100_application_sent_notice.sql")}\n${read("20261231000100_exports.sql")}\n${read("20270101000100_profiles_stage1.sql")}\n${read("20270102000100_profiles_stage2.sql")}\n${read("20270103000400_removal_requests.sql")}\n${read("20270108000100_removal_admin.sql")}\n${read("20270109000100_office_placement.sql")}\n${read("20270115000100_owner_requests.sql")}\n${read("20270119000100_desk_open.sql")}\n${read("20270120000100_seat_window.sql")}\n${read("20270121000100_seat_release.sql")}`;

describe("the notices, as templates", () => {
  it("has the 75 notices (the 57 of the blueprint, the one for a new application, the one for an unusual number of named files, the two of Profiles stage 1: a stage change for a pastor, a leader who has not confirmed for a coach, the one of stage 2: a person tells the Care Team their age range is not right, and the six of leader removal requests: a request for the coach and for the Care Team, the waiting reminder for each, the week-old one for a director, and a member's appeal, and the two of admin approval: one for admins and directors when a request comes in, one when it has waited three days, and the one of placing from Admin: the answer to an admin or a director who asked the owner, and the one for a request to the owner that ran out unanswered, and the one of the Leader Desk: a Tribe Card it formed that has waited a day for the pastors, and the two of the seat window: a safety limit that holds a release back, and the office's email at 7 am), each registered with the sender", () => {
    expect(keys).toHaveLength(75);
    expect(new Set(keys).size).toBe(75);
    for (const key of keys) expect(TEMPLATES[key], key).toBeDefined();
    expect(NOTICE_CATALOGUE.map((n) => n.key).sort()).toEqual([...keys].sort());
    expect(Object.keys(NOTICE_SAMPLES).sort()).toEqual([...keys].sort());
  });

  it("matches the database: every kind it queues has wording, and every wording is queued by something", () => {
    // Names in the SQL that look like a kind but are a function, a role, a row of the Admin list, a field of the params or a table of the feeds.
    const notKinds = new Set([
      "admin_attention", "applicant_first", "care_lead", "care_weekly", "data_lead", "data_requests", "leader_first",
      "referee_concern", "referee_concerns", "referee_days", "referee_first",
      // Profiles stage 1: a function key on the Features switchboard, and a message template (email only, not a notice)
      "coach_card", "leader_welcome",
      // Leader removal requests: fields of the params and rows (the member's first name and id), not kinds
      "member_first", "member_id",
      // The Leader Desk, Phase 2b-2: the function key it updates the blurb of on the Features switchboard
      "leader_desk",
      // Package 7: the leader's note about seats, a message template (email only), not a notice
      "leader_seat_note",
    ]);
    const queued = new Set([...SQL.matchAll(/'((?:pastor|director|admin|coach|care|leader|member|applicant|referee|champion|data|staff)_[a-z_]+)'/g)].map((m) => m[1]).filter((k) => !notKinds.has(k)));
    expect([...queued].filter((k) => !keys.includes(k))).toEqual([]);
    expect(keys.filter((k) => !queued.has(k))).toEqual([]);
  });

  it.each(keys)("%s is email only, has a title, and a known audience", (key) => {
    const def = TEMPLATES[key];
    expect(def.emailOnly).toBe(true);
    expect(def.title.length).toBeGreaterThan(8);
    expect(["member", "leader", "coach", "care", "applicant", "referee", "office"]).toContain(def.audience);
  });

  it.each(keys)("%s renders from the fields the database gives, with a short subject and one button to our own site", (key) => {
    const mail = renderEmail(message(key, NOTICE_SAMPLES[key]), SITE);
    expect(mail.subject.length).toBeGreaterThan(8);
    expect(mail.subject.length).toBeLessThan(80);
    expect(mail.subject).not.toMatch(/undefined|null|NaN|\[object/);
    expect(mail.text).not.toMatch(/undefined|null|NaN|\[object/);
    expect(mail.html).not.toMatch(/undefined|NaN|\[object/);
    for (const url of mail.text.match(/https?:\/\/\S+/g) ?? []) expect(url.startsWith(SITE) || url.startsWith("https://meet.example.org")).toBe(true);
    expect(mail.text).toContain("Hi Ada,");
    expect(mail.text.length).toBeLessThan(1500);
  });

  it.each(keys)("%s still renders when the database sends nothing at all", (key) => {
    const mail = renderEmail(message(key, {}), SITE);
    expect(mail.subject.length).toBeGreaterThan(5);
    expect(mail.subject).not.toMatch(/undefined|null|NaN|\[object/);
    expect(mail.text).not.toMatch(/undefined|null|NaN|\[object/);
  });

  it.each(keys)("%s has a button to the page where the thing is done, unless it is a reply to an address with none", (key) => {
    const mail = renderEmail(message(key, NOTICE_SAMPLES[key]), SITE);
    const noButton = ["member_deletion_done", "referee_reminder", "referee_thanks"];
    if (noButton.includes(key)) expect(mail.html).not.toMatch(/border-radius:999px;color:#ffffff/);
    else expect(mail.html).toMatch(/border-radius:999px;color:#ffffff/);
  });

  it("only follows a path on our own site, however the database spells it", () => {
    for (const bad of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", "/a b", "/x?y=1"]) {
      const mail = renderEmail(message("pastor_card_review", { ...NOTICE_SAMPLES.pastor_card_review, path: bad }), SITE);
      expect(mail.text).not.toContain("evil");
      expect(mail.html).not.toContain("javascript:");
      expect(mail.text).toContain(`${SITE}/review/cards`);
    }
    const good = renderEmail(message("pastor_card_review", { ...NOTICE_SAMPLES.pastor_card_review, path: "/review/interviews" }), SITE);
    expect(good.text).toContain(`${SITE}/review/interviews`);
  });

  it("escapes what a person typed, such as a tribe's name", () => {
    const mail = renderEmail(message("pastor_card_review", { tribe: "<script>alert(1)</script>", leader: "A & B" }), SITE);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("A &amp; B");
  });
});

describe("what the notices never say", () => {
  const SECRET = {
    reason: "ZZ-REASON", note: "ZZ-NOTE", review_note: "ZZ-REVIEW", body: "ZZ-BODY", text: "ZZ-TEXT", score: "ZZ-SCORE", answer_text: "ZZ-ANSWER",
    concern: "ZZ-CONCERN", teen_first: "ZZ-TEEN", age: "ZZ-AGE", age_range: "ZZ-RANGE", email: "zz@secret.example", phone: "+2340000000", testimony: "ZZ-TESTIMONY",
    care_note: "ZZ-CARE", sealed: "ZZ-SEALED", flag: "ZZ-FLAG", kind: "ZZ-KIND",
  };

  it.each(keys)("%s carries no private field, whatever else is in its params", (key) => {
    const mail = renderEmail(message(key, { ...NOTICE_SAMPLES[key], ...SECRET }), SITE);
    expect(`${mail.subject}\n${mail.text}\n${mail.html}`).not.toMatch(/ZZ-|zz@secret|\+2340000000/);
  });

  it.each(["pastor_referee_concern", "pastor_reference_held", "care_teen_confirm", "admin_data_request", "member_deletion_received"])(
    "%s names no one, even when a name is in its params",
    (key) => {
      const mail = renderEmail(message(key, { applicant: "Ngozi Okafor", person: "Ngozi", first_name: "Ngozi", applicant_first: "Ngozi", referee: "Bola", requester: "Chi", teen_first: "Dayo" }), SITE);
      expect(`${mail.subject}\n${mail.text}`).not.toMatch(/Ngozi|Okafor|Bola|Chi\b|Dayo/);
    },
  );

  it("leader_card_changes points to the card and does not carry the pastors' note", () => {
    const mail = renderEmail(message("leader_card_changes", { tribe: "Builders Tribe", review_note: "Please rename it and drop the second goal" }), SITE);
    expect(mail.text).not.toMatch(/rename|second goal/);
    expect(mail.text).toContain("on the card in the app");
  });

  it("says a pastor decides every application", () => {
    const mail = renderEmail(message("pastor_decision_ready", NOTICE_SAMPLES.pastor_decision_ready), SITE);
    expect(mail.text).toMatch(/A pastor decides every application/);
  });

  it("is plain about what is not in an email: the concern, the reason, the note", () => {
    expect(renderEmail(message("pastor_referee_concern", {}), SITE).text).toMatch(/not in this email/);
    expect(renderEmail(message("care_teen_confirm", {}), SITE).text).toMatch(/not in this email/);
    expect(renderEmail(message("pastor_reference_held", {}), SITE).text).toMatch(/not in this email/);
  });

  it("has no address-only message carry a link to a page behind a sign-in", () => {
    for (const key of ["member_deletion_done", "referee_reminder", "referee_thanks"]) {
      const mail = renderEmail(message(key, NOTICE_SAMPLES[key]), SITE);
      expect(mail.text).not.toMatch(/\/(admin|review|care|lead|tribe)\b/);
    }
  });

  it("gives a referee their own footer, with no way into the app", () => {
    const mail = renderEmail(message("referee_reminder", NOTICE_SAMPLES.referee_reminder, { first_name: null, name: null }), SITE);
    expect(mail.text).toContain("someone named you as a referee");
    expect(mail.text).not.toContain("Change how we reach you");
    expect(mail.text).toContain("Hi there,");
  });
});

describe("the details that change with the fields", () => {
  const render = (key: string, over: Params = {}) => renderEmail(message(key, { ...NOTICE_SAMPLES[key], ...over }), SITE);

  it("counts in the singular and the plural", () => {
    expect(render("pastor_decision_overdue", { count: 1, days: 9 }).subject).toBe("1 application waiting for a decision");
    expect(render("pastor_decision_overdue", { count: 3, days: 9 }).subject).toBe("3 applications waiting for a decision");
    expect(render("pastor_card_overdue", { count: 1 }).text).toContain("1 Tribe Card has waited");
    expect(render("pastor_card_overdue", { count: 2 }).text).toContain("2 Tribe Cards have waited");
    expect(render("care_asks_waiting", { count: 1 }).subject).toBe("1 person asked for someone to reach out");
    expect(render("care_asks_waiting", { count: 4 }).subject).toBe("4 people asked for someone to reach out");
    expect(render("director_unplaced", { count: 1 }).subject).toBe("1 member still has no tribe");
    expect(render("director_unplaced", { count: 2 }).subject).toBe("2 members still have no tribe");
    expect(render("director_interviews_tomorrow", { count: 1 }).subject).toBe("Tomorrow: 1 interview");
  });

  it("tells a full tribe from one with seats left", () => {
    expect(render("leader_seats", { seats_left: 2 }).subject).toBe("Builders Tribe has 2 seats left");
    expect(render("leader_seats", { seats_left: 1 }).subject).toBe("Builders Tribe has 1 seat left");
    expect(render("leader_seats", { seats_left: 0 }).subject).toBe("Builders Tribe is full");
    expect(render("leader_seats", { seats_left: 0 }).text).toContain("No one else can join");
  });

  it("tells the team that an application was sent, and gives each person a button to a page they can open", () => {
    const toReview = render("admin_application_sent", { applicant: "Ngozi", waiting: 1, path: "/review" });
    expect(toReview.subject).toBe("A new leader application was sent");
    expect(toReview.text).toContain("Ngozi has sent a leader application.");
    expect(toReview.text).not.toMatch(/waiting to be invited/);
    expect(toReview.text).toContain("both references are in");
    expect(toReview.text).toContain("Open the applications");
    expect(toReview.text).toContain(`${SITE}/review`);
    const several = render("admin_application_sent", { applicant: "Ngozi", waiting: 3, path: "/review" });
    expect(several.text).toContain("3 applications have been sent and are waiting to be invited to an interview.");
    // An admin who cannot open the review list is sent to the figures instead, and is not told to open applications
    const toFigures = render("admin_application_sent", { applicant: "Ngozi", waiting: 1, path: "/admin/figures" });
    expect(toFigures.text).toContain("See the figures");
    expect(toFigures.text).toContain(`${SITE}/admin/figures`);
    expect(toFigures.text).not.toContain("Open the applications");
    // A young applicant or the hidden owner arrives with no name: the email says "Someone", never a blank or the word null
    const unnamed = render("admin_application_sent", { applicant: null });
    expect(unnamed.text).toContain("Someone has sent a leader application.");
    expect(unnamed.text).not.toMatch(/null|undefined/);
  });

  it("says added or removed, and what it was", () => {
    expect(render("admin_role_changed", { change: "added", role: "pastor", person: "Tunde", by: "Mary" }).subject).toBe("Tunde: pastor role added");
    expect(render("admin_role_changed", { change: "removed", role: "care_lead", person: "Tunde", by: null }).subject).toBe("Tunde: care lead role removed");
    expect(render("admin_role_changed", { change: "removed", role: "pastor", person: "Tunde", by: null }).text).not.toMatch(/ by /);
    expect(render("staff_role_welcome", { role: "pastor" }).text).toContain("You decide leader applications");
    expect(render("staff_role_welcome", { role: "something_new" }).text).toContain("Open Admin to see what is waiting");
  });

  it("states an accepted and a declined offer", () => {
    expect(render("director_offer_answered", { answer: "accepted" }).subject).toBe("Tunde accepted a leader offer");
    expect(render("director_offer_answered", { answer: "declined" }).subject).toBe("Tunde declined a leader offer");
  });

  it("writes the time of an interview in Lagos time and leaves out what it does not know", () => {
    const online = render("director_interview_booked", { starts_at: "2027-03-09T15:00:00+00:00", minutes: 30, mode: "online", place: "" });
    expect(online.text).toMatch(/Ngozi has booked an interview for .*4:00 pm.*, 30 minutes, online\./);
    const room = render("director_interview_booked", { starts_at: undefined, starts_at_label: undefined, minutes: 0, mode: "in_person", place: "the Hub" });
    expect(room.text).toContain("Ngozi has booked an interview, at the Hub.");
  });

  it("writes a changed meeting the way the rest of the app does, and the link only when it is online", () => {
    const online = render("member_meeting_changed", {});
    expect(online.text).toContain("Builders Tribe now meets Wednesdays at 8:00 pm, online.");
    expect(online.text).toContain("Meeting link: https://meet.example.org/abc-defg");
    const room = render("member_meeting_changed", { mode: "in_person", place_note: "Room 4", meeting_link: "https://meet.example.org/abc-defg" });
    expect(room.text).toContain("in person (Room 4)");
    expect(room.text).not.toContain("meet.example.org");
  });

  it("tells who a testimony was shared with", () => {
    expect(render("member_testimony_shared", { shared_with: "church" }).text).toContain("shared with the church");
    expect(render("member_testimony_shared", { shared_with: "tribe" }).text).toContain("shared with your tribe");
  });

  it("says assistant leader when that is what the certificate is for", () => {
    expect(render("leader_certified", { as_role: "assistant_leader" }).text).toContain("an assistant leader");
    expect(render("leader_certified", { as_role: "leader" }).text).toContain("a leader");
  });

  it("reminds a referee of the days left, singular or plural, without a link", () => {
    expect(render("referee_reminder", { days: 1 }).text).toContain("stops working in 1 day.");
    expect(render("referee_reminder", { days: 3 }).text).toContain("stops working in 3 days.");
  });
});

describe("the summary for the team (one email a day, or a week, whatever roles a person holds)", () => {
  const digest = (over: Params = {}, to: Partial<ClaimedMessage["to"]> = {}) => renderEmail(message("staff_digest", { ...NOTICE_SAMPLES.staff_digest, ...over }, to), SITE);

  it("has a part for each role, with a link for each line", () => {
    const mail = digest();
    expect(mail.subject).toBe("4 things waiting for you");
    expect(mail.text).toMatch(/ADMIN\n- A deletion request came in \(1 day\): https:\/\/unitedtribes\.example\/admin\/privacy/);
    expect(mail.text).toMatch(/PASTOR\n- An application is ready for your decision: https:\/\/unitedtribes\.example\/review\n- Builders Tribe is ready for review \(2 days\): https:\/\/unitedtribes\.example\/review\/cards/);
    expect(mail.text.indexOf("ADMIN")).toBeLessThan(mail.text.indexOf("PASTOR"));
    expect(mail.html).toContain(">Admin<");
    expect(mail.html).toContain(">Pastor<");
    expect(mail.html).toContain('href="https://unitedtribes.example/review/cards"');
  });

  it("says once that it is everything in one place when a person holds more than one role", () => {
    expect(digest().text).toContain("You hold more than one role, so this is everything in one place");
    const one = digest({ sections: [(NOTICE_SAMPLES.staff_digest.sections as Params[])[1]], total: 3 });
    expect(one.text).not.toContain("more than one role");
    expect(one.text).toContain("PASTOR");
    expect(one.text).not.toContain("ADMIN");
  });

  it("says when there is more than fits", () => {
    expect(digest({ more: 12 }).text).toContain("And 12 more. Open Admin to see them all.");
    expect(digest({ more: 0 }).text).not.toContain("more. Open Admin");
  });

  it("is the week's when it is weekly", () => {
    const mail = digest({ period: "weekly" });
    expect(mail.subject).toBe("Your week: 4 things waiting");
    expect(mail.text).toContain("Here is what is waiting for you this week.");
    expect(digest({ period: "daily" }).text).toContain("Here is what is waiting for you today.");
  });

  it("counts a single thing in the singular", () => {
    const mail = digest({ total: 1, sections: [{ group: "admin", title: "Admin", items: [{ label: "A deletion request came in", path: "/admin/privacy", age: 0 }] }] });
    expect(mail.subject).toBe("1 thing waiting for you");
  });

  it("leaves out a part with nothing in it, a line with no words, and a link off our site", () => {
    const mail = digest({
      total: 2,
      sections: [
        { title: "Care", items: [] },
        { title: "Coach", items: [{ label: "", path: "/review" }, { label: "A leader is ready", path: "https://evil.example/x", age: 0 }, { label: "Another", path: "//evil.example", age: 0 }] },
      ],
    });
    expect(mail.text).not.toContain("CARE");
    expect(mail.text).not.toContain("evil");
    expect(mail.text).toContain("- A leader is ready: https://unitedtribes.example/admin");
    expect(mail.text).toContain("- Another: https://unitedtribes.example/admin");
  });

  it("holds up when the sections are missing or malformed", () => {
    for (const sections of [undefined, null, "x", 3, [null, 4, "z", {}], [{ title: "A", items: "no" }], [{ items: [{ label: "x" }] }]]) {
      const mail = digest({ sections, total: 0 });
      expect(mail.subject.length).toBeGreaterThan(5);
      expect(mail.text).not.toMatch(/undefined|null|NaN|\[object/);
    }
  });

  it("escapes a label", () => {
    const mail = digest({ sections: [{ title: "<b>Admin</b>", items: [{ label: "<img src=x onerror=1>", path: "/admin", age: 0 }] }], total: 1 });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<b>Admin");
  });

  it("is the same plain layout as the other emails, with the footer to change how often", () => {
    const mail = digest();
    expect(mail.text).toContain("Change how we reach you");
    expect(mail.text).toContain("under My notices");
    expect(mail.html.length).toBeLessThan(20_000);
  });
});

describe("the other channels, which the database never uses for these", () => {
  it.each(keys)("%s still has a short text and a WhatsApp wording that Meta would accept, if it were ever used", (key) => {
    const msg = message(key, NOTICE_SAMPLES[key]);
    const text = renderSms(msg, SITE);
    expect(text.length).toBeGreaterThan(5);
    expect(text.length).toBeLessThanOrEqual(320);
    const wa = renderWhatsApp(msg, SITE);
    expect(wa.name).toBe(`ut_${key}`);
    const body = TEMPLATES[key].whatsapp(NOTICE_SAMPLES[key], { site: SITE, first: "Ada", link: (p) => `${SITE}${p}`, reply: () => null });
    const slots = [...body.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect(slots).toEqual(slots.map((_, i) => i + 1));
    expect(body.example).toHaveLength(slots.length);
    expect(body.vars).toHaveLength(slots.length);
    expect(body.body.trim().endsWith("}}")).toBe(false);
    for (const v of wa.vars) expect(v).not.toMatch(/[\r\n\t]| {2,}/);
  });
});

describe("the catalogue the Notifications page shows", () => {
  const groups = new Set(NOTICE_GROUPS.map((g) => g.key));

  it("puts every notice in a known group, and says who gets it and when", () => {
    for (const n of NOTICE_CATALOGUE) {
      if (n.key === "staff_digest") expect(n.group).toBe("digest");
      else expect(groups.has(n.group as never), n.key).toBe(true);
      expect(n.who.length, n.key).toBeGreaterThan(3);
      expect(n.when.length, n.key).toBeGreaterThan(3);
      expect(n.title.length, n.key).toBeGreaterThan(8);
    }
  });

  it("matches the database's eleven groups", () => {
    const seeded = /insert into public\.notice_settings \(group_key\)\s*values ([^;]+);/.exec(SQL)?.[1] ?? "";
    const inSql = [...seeded.matchAll(/\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(new Set(inSql)).toEqual(groups);
    expect(groups.size).toBe(11);
  });

  it("marks as 'at once' only what the database sends at once", () => {
    const urgent = NOTICE_CATALOGUE.filter((n) => n.urgent).map((n) => n.key).sort();
    expect(urgent).toEqual(["admin_application_sent", "admin_data_request_due", "admin_queue_stuck", "admin_role_changed", "admin_seat_morning", "admin_seat_stopped", "director_removal_escalated", "pastor_referee_concern", "staff_role_welcome"]);
  });

  it("never lists the same group twice, and only groups that have a digest say so", () => {
    expect(NOTICE_GROUPS.length).toBe(groups.size);
    expect(NOTICE_GROUPS.filter((g) => g.digest).map((g) => g.key).sort()).toEqual(["admin", "care", "coaches", "directors", "pastors"]);
  });
});
