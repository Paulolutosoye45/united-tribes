import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// Profiles and the Weekly Rhythm, stage 1: the facts, the leader's own page, the pastor's review and the hold on a Tribe Card. What these prove:
//   * one fact, one owner: the office only proposes, and a value counts as confirmed only when the person says so
//   * a change that touches other people (a leader with members, a member in a tribe) waits for the pastor of the person's centre, the old value
//     stays in force, and nobody is moved; a change nobody can be affected by applies at once
//   * a change across 17 and 18 is never self-service, and a young person's range is never offered
//   * with the switches Off nothing here answers, and a card is approved exactly as before

let c: Cast;
const PHRASE = /^\d+ (to \d+|and over), the [A-Za-z ]+ stage$/;

beforeAll(async () => {
  c = await makeCast();
  await c.noticesOn();
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

const history = (person: string, key = "life_stage") => c.sql("select event, old_value, new_value, by_kind, via, note from public.profile_fact_history where person_id = $1 and key = $2 order by id", [person, key]);
const trackOf = async (tribe: string) => (await c.one("select k.slug from public.tribes t join public.tracks k on k.id = t.track_id where t.id = $1", [tribe])).slug as string;
const page = (who: string) => c.as(who, "my_page_state");

describe("with the switches Off, nothing answers", () => {
  it("shows nobody a page, takes no answer, and holds no card", async () => {
    await c.reset();
    for (const who of [c.appointed.id, c.seasoned.id, c.member]) expect(await page(who)).toEqual({ enabled: false });
    expect(await c.as(c.appointed.id, "my_page_answer", "life_stage", "yes", null)).toEqual({ ok: false, reason: "off" });
    expect((await c.one("select count(*)::int n from public.profile_facts")).n).toBe(0);
    expect((await c.one("select count(*)::int n from public.profile_fact_history")).n).toBe(0);
    expect(await c.as(c.pastor, "tribe_stage_status", c.appointed.tribe)).toBeNull();
  });

  it("is closed to visitors", async () => {
    await expectCode(c.db.asAnon((q) => q("select public.my_page_state()")), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.my_page_answer('life_stage', 'yes', null)")), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.stage_reviews_list()")), "42501");
  });
});

describe("what the platform holds, and who said it", () => {
  it("reads the office's suggestion at the appointment as a proposal the leader has not yet confirmed", async () => {
    const cur = await c.one("select public.profile_fact_current($1, 'life_stage') as r", [c.appointed.id]);
    expect(cur.r).toMatchObject({ state: "unconfirmed", value: "builders", by: "office", source: "appointment" });
    expect(cur.r.label).toBe("26 to 40, the Builders stage");
    expect(cur.r.label).toMatch(PHRASE);
  });

  it("reads a leader's stage from the tribe they lead, and counts it as theirs only if it began from their own application", async () => {
    const cur = await c.one("select public.profile_fact_current($1, 'life_stage') as r", [c.seasoned.id]);
    expect(cur.r).toMatchObject({ state: "unconfirmed", value: "stewards", by: "office", source: "tribe", label: "41 to 60, the Stewards stage" });
    await c.db.admin.query("insert into public.leader_applications (person_id, status, answers, consent_version) values ($1, 'approved_leader', $2::jsonb, 'test')", [c.seasoned.id, JSON.stringify({ calling: { track: "stewards" } })]);
    const again = await c.one("select public.profile_fact_current($1, 'life_stage') as r", [c.seasoned.id]);
    expect(again.r).toMatchObject({ state: "confirmed", by: "person" });
    await c.db.admin.query("delete from public.leader_applications where person_id = $1", [c.seasoned.id]);
  });

  it("holds nothing for a person it has no fact for, and for a fact that does not apply to them", async () => {
    expect((await c.one("select public.profile_fact_current($1, 'life_stage') as r", [c.member])).r).toEqual({ state: "none" });
    expect((await c.one("select public.profile_fact_current($1, 'age_range') as r", [c.member])).r).toEqual({ state: "none" });
    expect((await c.one("select public.profile_fact_current($1, 'something_else') as r", [c.member])).r).toEqual({ state: "none" });
    expect((await c.one("select public.profile_fact_applies($1, 'life_stage') as a, public.profile_fact_applies($1, 'age_range') as b", [c.member]))).toEqual({ a: false, b: false });
  });

  it("offers only real, adult choices: never a young person's range or the teen stage", async () => {
    const stages = (await c.one("select public.profile_fact_options('life_stage') as r")).r;
    expect(stages.map((o: { value: string }) => o.value)).toEqual(["rising", "builders", "stewards", "sages"]);
    expect(stages.every((o: { detail: string }) => PHRASE.test(o.detail))).toBe(true);
    const ranges = (await c.one("select public.profile_fact_options('age_range') as r")).r;
    expect(ranges.map((o: { value: string }) => o.value)).toEqual(["18-25", "26-32", "33-40", "41-50", "51-60", "60-plus"]);
    expect((await c.one("select public.profile_fact_options('nothing') as r")).r).toEqual([]);
  });

  it("keeps the registry as the blueprint's first two facts, each with a class and who it applies to", async () => {
    const rows = await c.sql("select key, layer, change_class, applies_to from public.profile_fact_registry order by sort");
    expect(rows).toEqual([
      { key: "life_stage", layer: "facts", change_class: "C", applies_to: ["leader"] },
      { key: "age_range", layer: "facts", change_class: "C", applies_to: ["member"] },
    ]);
  });
});

describe("a leader's own page", () => {
  it("shows the leader the question, with what we hold and who said it, once My page is On for leaders", async () => {
    await c.reset();
    await c.set("my_page", "on", { roles: ["leader"] });
    expect(await page(c.member)).toEqual({ enabled: false });
    const mine = await page(c.appointed.id);
    expect(mine.enabled).toBe(true);
    expect(mine.facts).toHaveLength(1);
    expect(mine.facts[0]).toMatchObject({ key: "life_stage", label: "Stage of life", state: "unconfirmed", value: "builders", valueLabel: "26 to 40, the Builders stage", question: "We have you down as 26 to 40, the Builders stage. Is that right?", by: "office", change: null, last: null });
    expect(JSON.stringify(mine)).not.toContain("{value}");
    expect(mine.facts[0].options.map((o: { value: string }) => o.value)).toEqual(["rising", "builders", "stewards", "sages"]);
  });

  it("takes a yes, stamps it as confirmed by the person, and keeps every step", async () => {
    const r = await c.as(c.appointed.id, "my_page_answer", "life_stage", "yes", null);
    expect(r).toEqual({ ok: true, outcome: "confirmed" });
    expect((await c.one("select public.profile_fact_current($1, 'life_stage') as r", [c.appointed.id])).r).toMatchObject({ state: "confirmed", value: "builders", source: "fact" });
    const fact = await c.one("select value, set_by_kind, confirmed_via, confirmed_at is not null as ok from public.profile_facts where person_id = $1", [c.appointed.id]);
    expect(fact).toEqual({ value: "builders", set_by_kind: "office", confirmed_via: "my_page", ok: true });
    expect(await history(c.appointed.id)).toEqual([{ event: "confirmed", old_value: "builders", new_value: "builders", by_kind: "person", via: "my_page", note: null }]);
    expect((await page(c.appointed.id)).facts[0]).toMatchObject({ state: "confirmed", last: { event: "confirmed" } });
  });

  it("offers only yes and change on the page; 'not me' and 'later' belong to the private link", async () => {
    for (const action of ["not_me", "later", "maybe"]) expect(await c.as(c.appointed.id, "my_page_answer", "life_stage", action, null)).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses a fact that does not apply to the person, and a value that is not one of the choices", async () => {
    expect(await c.as(c.member, "my_page_answer", "life_stage", "yes", null)).toEqual({ ok: false, reason: "off" });
    await c.set("my_page", "on", { reason: "Everyone sees their own page" });
    expect(await c.as(c.member, "my_page_answer", "life_stage", "yes", null)).toEqual({ ok: false, reason: "not_applicable" });
    expect(await c.as(c.appointed.id, "my_page_answer", "age_range", "yes", null)).toEqual({ ok: false, reason: "not_applicable" });
    expect(await c.as(c.appointed.id, "my_page_answer", "nothing", "yes", null)).toEqual({ ok: false, reason: "not_applicable" });
    expect(await c.as(c.appointed.id, "my_page_answer", "life_stage", "change", "teens")).toMatchObject({ ok: false, reason: "bad_value" });
    expect(await c.as(c.appointed.id, "my_page_answer", "life_stage", "change", "")).toMatchObject({ ok: false, reason: "bad_value", message: "Choose one from the list" });
  });

  it("treats choosing what is already held as saying it is right", async () => {
    const r = await c.as(c.appointed.id, "my_page_answer", "life_stage", "change", "builders");
    expect(r).toEqual({ ok: true, outcome: "confirmed" });
  });
});

describe("a change nobody can be affected by applies at once", () => {
  it("changes a Tribe Card that is not approved and has nobody in it, and records it", async () => {
    await c.open();
    const ada = await c.appoint("Zara");
    expect(await trackOf(ada.tribe)).toBe("builders");
    const r = await c.as(ada.id, "my_page_answer", "life_stage", "change", "rising");
    expect(r).toEqual({ ok: true, outcome: "applied_now", tribe: ada.tribe });
    expect(await trackOf(ada.tribe)).toBe("rising");
    expect((await c.one("select value, confirmed_via from public.profile_facts where person_id = $1 and key = 'life_stage'", [ada.id]))).toEqual({ value: "rising", confirmed_via: "my_page" });
    expect(await history(ada.id)).toEqual([{ event: "applied", old_value: "builders", new_value: "rising", by_kind: "person", via: "my_page", note: "The Tribe Card was not approved and nobody had joined, so the change applied at once" }]);
    expect((await c.one("select count(*)::int n from public.event_log where action = 'profile.stage_corrected' and actor_id = $1", [ada.id])).n).toBe(1);
    expect((await c.one("select count(*)::int n from public.profile_changes where person_id = $1", [ada.id])).n).toBe(0);
  });

  it("keeps the answer when there is no tribe yet, for the pastor to see beside the card", async () => {
    const lone = await c.k.staff("NoTribe", "leader");
    await c.db.admin.query("insert into public.leader_applications (person_id, status, answers, consent_version, decided_at) values ($1, 'approved_leader', $2::jsonb, 'test', now())", [lone.id, JSON.stringify({ calling: { track: "sages" } })]);
    const cur = (await c.one("select public.profile_fact_current($1, 'life_stage') as r", [lone.id])).r;
    expect(cur).toMatchObject({ state: "confirmed", value: "sages", source: "application" });
    const r = await c.as(lone.id, "my_page_answer", "life_stage", "change", "stewards");
    expect(r).toEqual({ ok: true, outcome: "recorded" });
    expect((await c.one("select public.profile_fact_current($1, 'life_stage') as r", [lone.id])).r).toMatchObject({ value: "stewards", source: "fact" });
    expect((await history(lone.id))[0]).toMatchObject({ event: "changed", old_value: "sages", new_value: "stewards", note: "No tribe is started yet" });
  });

  it("applies a member's range at once only when they are in no tribe", async () => {
    const free = await c.k.person("Free");
    await c.k.profile(free.id, c.season, { age: "33-40" });
    await c.set("my_page", "on", { reason: "Everyone sees their own page" });
    const r = await c.as(free.id, "my_page_answer", "age_range", "change", "41-50");
    expect(r).toEqual({ ok: true, outcome: "applied_now" });
    expect((await c.one("select a.slug from public.member_profiles m join public.age_ranges a on a.id = m.age_range_id where m.person_id = $1", [free.id])).slug).toBe("41-50");
    expect((await history(free.id, "age_range"))[0]).toMatchObject({ event: "applied", old_value: "33-40", new_value: "41-50", note: "Not in a tribe, so nobody is affected" });
  });
});

describe("a change that touches other people waits for a pastor", () => {
  let reviewId: string;

  it("holds a leader's change when the tribe has members or the card is approved, and leaves the old value in force", async () => {
    await c.open();
    const before = await trackOf(c.seasoned.tribe);
    const r = await c.as(c.seasoned.id, "my_page_answer", "life_stage", "change", "rising");
    expect(r).toMatchObject({ ok: true, outcome: "pending_review" });
    reviewId = r.change;
    expect(await trackOf(c.seasoned.tribe)).toBe(before);
    expect((await c.one("select public.profile_fact_current($1, 'life_stage') as r", [c.seasoned.id])).r).toMatchObject({ value: "stewards" });
    const ch = await c.one("select old_value, new_value, status, due_on = public.today_lagos() + 5 as five from public.profile_changes where id = $1", [reviewId]);
    expect(ch).toEqual({ old_value: "stewards", new_value: "rising", status: "pending", five: true });
    expect((await history(c.seasoned.id)).map((h) => h.event)).toEqual(["pending"]);
    // nobody was moved
    expect((await c.sql("select person_id from public.tribe_members where tribe_id = $1 and status = 'active' order by person_id", [c.seasoned.tribe])).map((r) => r.person_id).sort()).toEqual([...c.seasoned.members].sort());
  });

  it("holds a second change while the first waits, and shows the leader where it stands", async () => {
    expect(await c.as(c.seasoned.id, "my_page_answer", "life_stage", "change", "sages")).toMatchObject({ ok: false, reason: "waiting" });
    expect(await c.as(c.seasoned.id, "my_page_answer", "life_stage", "yes", null)).toMatchObject({ ok: false, reason: "waiting" });
    const mine = (await page(c.seasoned.id)).facts[0];
    expect(mine.change).toMatchObject({ status: "pending", newLabel: "18 to 25, the Rising stage" });
    expect(mine.value).toBe("stewards");
  });

  it("tells the pastors and directors of the person's centre, once, and never the person", async () => {
    const items = await c.sql("select p.id as person, i.kind, i.event from public.notice_items i join public.people p on p.id = i.person_id where i.kind = 'pastor_stage_review' order by i.id");
    expect(items.map((i) => i.person).sort()).toEqual([c.pastor, c.director].sort());
    expect(items.every((i) => i.event === `stage:${reviewId}`)).toBe(true);
    expect(items.map((i) => i.person)).not.toContain(c.seasoned.id);
    // Staff hear in their daily summary: the line names the first name and the kind of detail, never the stage asked for
    const lines = await c.sql("select label, path, delivery from public.notice_items where kind = 'pastor_stage_review'");
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toEqual({ label: expect.stringMatching(/^[A-Za-z0-9]+ asked to change their stage of life$/), path: "/review/stages", delivery: "digest" });
    expect(JSON.stringify(lines)).not.toMatch(/rising|stewards|Rising|Stewards/);
  });

  it("lists the review for the pastor, the director and the admin of the centre, and lets only a pastor decide", async () => {
    const list = await c.as(c.pastor, "stage_reviews_list");
    expect(list.canDecide).toBe(true);
    expect(list.reviews).toHaveLength(1);
    expect(list.reviews[0]).toMatchObject({ id: reviewId, status: "pending", fact: "Stage of life", oldLabel: "41 to 60, the Stewards stage", newLabel: "18 to 25, the Rising stage", tribe: "Seasoned Tribe", members: 2, overdue: false });
    expect((await c.as(c.director, "stage_reviews_list")).canDecide).toBe(false);
    expect((await c.as(c.admin, "stage_reviews_list")).reviews).toHaveLength(1);
    for (const who of [c.seasoned.id, c.member]) expect(await c.as(who, "stage_reviews_list").then(() => "ok", (e: { code?: string }) => e.code)).toBe("42501");
    for (const who of [c.director, c.admin, c.seasoned.id, c.member]) {
      expect(await c.as(who, "stage_review_decide", reviewId, true, null).then(() => "ok", (e: { code?: string }) => e.code), String(who)).toBe("42501");
    }
    expect((await c.one("select status from public.profile_changes where id = $1", [reviewId])).status).toBe("pending");
  });

  it("calls a review overdue after five days", async () => {
    await c.db.admin.query("update public.profile_changes set due_on = public.today_lagos() - 1 where id = $1", [reviewId]);
    expect((await c.as(c.pastor, "stage_reviews_list")).reviews[0].overdue).toBe(true);
    await c.db.admin.query("update public.profile_changes set due_on = public.today_lagos() + 5 where id = $1", [reviewId]);
  });

  it("declines: nothing moves, the old value stays, and the leader is told in plain words", async () => {
    expect(await c.as(c.pastor, "stage_review_decide", reviewId, false, "Your members chose this tribe for the Stewards stage")).toEqual({ ok: true, approved: false });
    expect(await trackOf(c.seasoned.tribe)).toBe("stewards");
    expect((await c.one("select public.profile_fact_current($1, 'life_stage') as r", [c.seasoned.id])).r).toMatchObject({ value: "stewards" });
    const mine = (await page(c.seasoned.id)).facts[0];
    expect(mine.change).toMatchObject({ status: "declined", note: "Your members chose this tribe for the Stewards stage" });
    expect((await history(c.seasoned.id)).map((h) => h.event)).toEqual(["pending", "declined"]);
    await expectCode(c.as(c.pastor, "stage_review_decide", reviewId, true, null), "22023");
  });

  it("approves a later request: the tribe's stage is updated, the person's answer is recorded, and nobody is moved", async () => {
    const r = await c.as(c.seasoned.id, "my_page_answer", "life_stage", "change", "sages");
    expect(r.outcome).toBe("pending_review");
    expect(await c.as(c.pastor, "stage_review_decide", r.change, true, null)).toEqual({ ok: true, approved: true });
    expect(await trackOf(c.seasoned.tribe)).toBe("sages");
    expect((await c.one("select value, confirmed_via, set_by_kind from public.profile_facts where person_id = $1", [c.seasoned.id]))).toEqual({ value: "sages", confirmed_via: "review", set_by_kind: "person" });
    expect((await history(c.seasoned.id)).map((h) => h.event)).toEqual(["pending", "declined", "pending", "approved"]);
    expect((await c.sql("select person_id from public.tribe_members where tribe_id = $1 and status = 'active'", [c.seasoned.tribe])).map((r) => r.person_id).sort()).toEqual([...c.seasoned.members].sort());
    expect((await c.as(c.pastor, "stage_reviews_list")).reviews.map((x: { status: string }) => x.status)).toEqual(expect.arrayContaining(["approved", "declined"]));
    await c.db.admin.query("update public.tribes set track_id = (select id from public.tracks where slug = 'stewards') where id = $1", [c.seasoned.tribe]);
    await c.db.admin.query("delete from public.profile_facts where person_id = $1", [c.seasoned.id]);
  });

  it("is a pastor's of the same centre only, and a note is at most 300 characters", async () => {
    const other = (await c.one("insert into public.centres (slug, name) values ('other', 'Other') returning id")).id as string;
    const away = await c.k.staff("Away", "pastor");
    await c.db.admin.query("update public.people set centre_id = $2 where id = $1", [away.id, other]);
    await c.db.admin.query("update public.person_roles set centre_id = $2 where person_id = $1", [away.id, other]);
    const r = await c.as(c.seasoned.id, "my_page_answer", "life_stage", "change", "rising");
    expect((await c.as(away.id, "stage_reviews_list")).reviews).toEqual([]);
    await expectCode(c.as(away.id, "stage_review_decide", r.change, true, null), "P0002");
    await expect(c.as(c.pastor, "stage_review_decide", r.change, false, "x".repeat(301))).rejects.toThrow(/under 300/);
    await expectCode(c.as(c.pastor, "stage_review_decide", NOBODY, false, null), "P0002");
    expect(await c.as(c.pastor, "stage_review_decide", r.change, false, null)).toEqual({ ok: true, approved: false });
  });

  it("holds a member's range the same way when they are in a tribe, and never crosses 17 and 18", async () => {
    const [bola] = c.seasoned.members;
    await c.set("my_page", "on", { reason: "Everyone sees their own page" });
    const r = await c.as(bola, "my_page_answer", "age_range", "change", "41-50");
    expect(r.outcome).toBe("pending_review");
    expect((await c.one("select a.slug from public.member_profiles m join public.age_ranges a on a.id = m.age_range_id where m.person_id = $1", [bola])).slug).toBe("33-40");
    await c.as(c.pastor, "stage_review_decide", r.change, true, null);
    expect((await c.one("select a.slug from public.member_profiles m join public.age_ranges a on a.id = m.age_range_id where m.person_id = $1", [bola])).slug).toBe("41-50");
    // a young person's range is never changed here, and never offered
    const teen = await c.k.person("Teen");
    await c.k.profile(teen.id, c.season, { age: "33-40" });
    await c.db.admin.query("begin");
    try {
      await c.db.admin.query("set local session_replication_role = replica");
      await c.db.admin.query("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [teen.id]);
      await c.db.admin.query("commit");
    } catch (e) {
      await c.db.admin.query("rollback");
      throw e;
    }
    // My page is never shown to someone under 18, and takes nothing from them
    expect(await page(teen.id)).toEqual({ enabled: false });
    expect(await c.as(teen.id, "my_page_answer", "age_range", "change", "18-25")).toEqual({ ok: false, reason: "off" });
    // and if an answer ever reached the inner function (an old private link), it still refuses to cross 17 and 18
    const inner = (await c.one("select public.profile_fact_answer($1, 'age_range', 'change', '18-25', 'details_check') as r", [teen.id])).r;
    expect(inner).toMatchObject({ ok: false, reason: "special_route" });
    expect(inner.message).toMatch(/young people.s rules/);
    expect((await c.one("select a.slug from public.member_profiles m join public.age_ranges a on a.id = m.age_range_id where m.person_id = $1", [teen.id])).slug).toBe("13-17");
    expect((await c.one("select count(*)::int n from public.profile_changes where person_id = $1", [teen.id])).n).toBe(0);
  });
});

describe("the hold on a Tribe Card", () => {
  const submitted = async (name: string) => {
    const l = await c.k.tribe(c.season, { name, status: "submitted", track: "builders", certified: false });
    return l;
  };
  const approve = (tribe: string) => c.as(c.pastor, "decide_tribe_card", tribe, "approve", null);

  it("changes nothing while the Details Check is Off: a card is approved exactly as it always was", async () => {
    await c.reset();
    const t = await submitted("Hold Off");
    await approve(t.tribe);
    expect((await c.one("select status from public.tribes where id = $1", [t.tribe])).status).toBe("approved");
    // even the strictest setting does nothing while the function it needs is not on
    await c.set("my_page", "on", { reason: "Everyone sees their own page" });
    const u = await submitted("Hold Needs");
    await approve(u.tribe);
    expect((await c.one("select status from public.tribes where id = $1", [u.tribe])).status).toBe("approved");
  });

  it("is only a note under Optional: the pastor is told, and may still approve", async () => {
    await c.open("optional");
    const t = await submitted("Hold Optional");
    const status = await c.as(c.pastor, "tribe_stage_status", t.tribe);
    expect(status).toMatchObject({ state: "unconfirmed", leader: "26 to 40, the Builders stage", card: "26 to 40, the Builders stage", differs: false, hold: "optional", pending: null });
    await approve(t.tribe);
    expect((await c.one("select status from public.tribes where id = $1", [t.tribe])).status).toBe("approved");
  });

  it("cannot approve a card under Required until the leader has confirmed their stage", async () => {
    await c.open("required");
    const t = await submitted("Hold Required");
    expect((await c.as(c.pastor, "tribe_stage_status", t.tribe)).hold).toBe("required");
    await expectCode(approve(t.tribe), "22023");
    await expect(approve(t.tribe)).rejects.toThrow(/has not confirmed their stage of life/);
    expect((await c.one("select status from public.tribes where id = $1", [t.tribe])).status).toBe("submitted");
    await c.as(t.leader.id, "my_page_answer", "life_stage", "yes", null);
    await approve(t.tribe);
    expect((await c.one("select status from public.tribes where id = $1", [t.tribe])).status).toBe("approved");
  });

  it("stops asking the moment the switch is moved back, and the Master pause lifts it too", async () => {
    await c.open("required");
    const t = await submitted("Hold Lifted");
    await expectCode(approve(t.tribe), "22023");
    await c.o.call("god_feature_master", true, "Lifting every hold for a moment");
    await approve(t.tribe);
    expect((await c.one("select status from public.tribes where id = $1", [t.tribe])).status).toBe("approved");
    await c.o.call("god_feature_master", false, null);
  });

  it("shows only what the pastor, director and admin already see, and only while the Details Check is open for that leader", async () => {
    await c.open("optional");
    const t = await submitted("Hold Visible");
    for (const who of [c.pastor, c.director, c.admin]) expect((await c.as(who, "tribe_stage_status", t.tribe)).state).toBe("unconfirmed");
    for (const who of [t.leader.id, c.member]) expect(await c.as(who, "tribe_stage_status", t.tribe).then(() => "ok", (e: { code?: string }) => e.code)).toBe("42501");
    expect(await c.as(c.pastor, "tribe_stage_status", NOBODY)).toBeNull();
    // a card that no longer agrees with what the leader was appointed for says so
    const drifted = await c.appoint("Drift");
    await c.db.admin.query("update public.tribes set track_id = (select id from public.tracks where slug = 'rising') where id = $1", [drifted.tribe]);
    expect(await c.as(c.pastor, "tribe_stage_status", drifted.tribe)).toMatchObject({ differs: true, leader: "26 to 40, the Builders stage", card: "18 to 25, the Rising stage" });
    await c.reset();
    expect(await c.as(c.pastor, "tribe_stage_status", t.tribe)).toBeNull();
  });
});
