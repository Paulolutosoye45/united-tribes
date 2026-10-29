import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// Profiles and the Weekly Rhythm, stage 2: My page for everyone. What these prove:
//   * with the four new switches Off, My page is exactly what stage 1 made it: no new part, nothing saved, nothing asked
//   * a typed fact (name, area, birthday) is saved at once in the place the platform already reads it, checked by the database, and nobody is moved
//   * the person's own story is kept for them: nobody else can read it, and the office is not told
//   * a role panel gives a word or a number and a link, never another person's private detail
//   * a change across 17 and 18 is never self-service: the Care Team hears (by the care route), nothing is changed, and the person reads the answer
//   * "Still right?" asks once a season, only about what has not been confirmed since the season began, and a "not now" is kept for that season
//   * a person under 18 is never shown My page, and what they hold is in their own data file

let c: Cast;
let eze: string; // a member with a joining form and no tribe
let care: string;
const GOOD = "Trying the whole road with everyone";

beforeAll(async () => {
  c = await makeCast();
  await c.noticesOn();
  care = (await c.k.staff("Care", "care_lead")).id;
  eze = (await c.k.person("Eze")).id;
  await c.k.profile(eze, c.season, { zone: "mainland", age: "26-32" });
  await c.db.admin.query("update public.seasons set status = 'running' where id = $1", [c.season]);
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

const NEW = ["my_details", "my_story", "role_panels", "still_right"] as const;
/** My page On for everyone, and the new functions as given. */
async function open(on: readonly string[] = NEW) {
  await c.reset();
  await c.set("my_page", "on", { reason: GOOD });
  for (const f of on) await c.set(f, "on", { reason: GOOD });
}
const page = (who: string) => c.as(who, "my_page_state");
const save = (who: string, key: string, value: string | null) => c.as(who, "my_page_save", key, value);
const historyOf = (person: string, key: string) => c.sql("select event, old_value, new_value, by_kind, via, note from public.profile_fact_history where person_id = $1 and key = $2 order by id", [person, key]);
const storyOf = (person: string) => c.sql("select key, value from public.profile_story where person_id = $1 order by key", [person]);
const one = async (text: string, params: unknown[] = []) => (await c.one(text, params)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const detail = (p: any, key: string) => [...p.details, ...p.story].find((d: any) => d.key === key); // eslint-disable-line @typescript-eslint/no-explicit-any
const rangeOf = async (person: string) => (await one("select a.slug from public.member_profiles m join public.age_ranges a on a.id = m.age_range_id where m.person_id = $1", [person])).slug as string;

async function makeYoung(name: string) {
  const teen = await c.k.person(name);
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
  return teen.id;
}

describe("with the four new switches Off, My page is what stage 1 made it", () => {
  it("adds no part to the page and takes nothing", async () => {
    await open([]);
    const p = await page(eze);
    expect(p).toMatchObject({ enabled: true, canAsk: false, office: null, details: [], story: [], panels: [] });
    expect(p.facts.map((f: { key: string }) => f.key)).toEqual(["age_range"]);
    for (const key of ["preferred_name", "area", "birthday", "about_me", "gifts", "ask_me", "pray_for_me"]) expect(await save(eze, key, "mainland"), key).toEqual({ ok: false, reason: "off" });
    expect(await c.as(eze, "still_right_state")).toEqual({ due: false });
    expect(await c.as(eze, "my_office_ask", "I am 16")).toEqual({ ok: false, reason: "off" });
    expect((await one("select count(*)::int n from public.profile_office_asks")).n).toBe(0);
    expect((await one("select count(*)::int n from public.profile_story")).n).toBe(0);
    expect((await one("select count(*)::int n from public.profile_fact_history where key not in ('life_stage', 'age_range')")).n).toBe(0);
  });

  it("is closed to everyone when My page itself is Off, and tells the menu so", async () => {
    await c.reset();
    for (const who of [eze, c.appointed.id, c.pastor]) {
      expect(await page(who)).toEqual({ enabled: false });
      expect(await c.as(who, "my_page_open")).toBe(false);
      expect(await save(who, "about_me", "Hello")).toEqual({ ok: false, reason: "off" });
      expect(await c.as(who, "my_office_ask", null)).toEqual({ ok: false, reason: "off" });
    }
    await open([]);
    expect(await c.as(eze, "my_page_open")).toBe(true);
  });

  it("is closed to a visitor, and keeps the inner function out of every client's reach", async () => {
    await expectCode(c.db.asAnon((q) => q("select public.my_page_open()")), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.my_page_save('about_me', 'x')")), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.still_right_state()")), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.my_profile_export()")), "42501");
    await expectCode(c.as(eze, "profile_fact_save", eze, "area", "mainland", "my_page"), "42501");
    await expectCode(c.as(eze, "my_panels_of", eze), "42501");
    await expectCode(c.db.asUser(eze, (q) => q("select * from public.profile_story")), "42501");
    await expectCode(c.db.asUser(eze, (q) => q("select * from public.profile_office_asks")), "42501");
    await expectCode(c.db.asUser(eze, (q) => q("select * from public.profile_prompts")), "42501");
  });
});

describe("the facts a person types", () => {
  it("lists the ones that apply to them, in the registry's order, with how each is asked", async () => {
    await open();
    const member = await page(eze);
    expect(member.details.map((d: { key: string }) => d.key)).toEqual(["preferred_name", "area", "birthday"]);
    expect(detail(member, "preferred_name")).toMatchObject({ kind: "text", class: "A", max: 40, value: "Eze" });
    expect(detail(member, "area")).toMatchObject({ kind: "choice", class: "B", value: "mainland", valueLabel: "Lagos Mainland" });
    expect(detail(member, "area").options.map((o: { value: string }) => o.value)).toEqual(["iganmu-surulere", "mainland", "island-lekki", "other-nigeria", "abroad"]);
    expect(detail(member, "birthday")).toMatchObject({ kind: "monthday", class: "A", value: null });
    // a leader with no joining form has a name and a story, and nothing about an area or a birthday
    const leader = await page(c.appointed.id);
    expect(leader.details.map((d: { key: string }) => d.key)).toEqual(["preferred_name"]);
    expect(leader.story.map((d: { key: string }) => d.key)).toEqual(["about_me", "gifts", "ask_me", "pray_for_me"]);
    expect(leader.canAsk).toBe(false);
    expect(member.canAsk).toBe(true);
  });

  it("saves a name at once, tidied, where the platform already reads it, and keeps the step", async () => {
    expect(await save(eze, "preferred_name", "  Ezinne   Ada ")).toEqual({ ok: true, outcome: "saved" });
    expect((await one("select preferred_name from public.people where id = $1", [eze])).preferred_name).toBe("Ezinne Ada");
    expect(await historyOf(eze, "preferred_name")).toEqual([{ event: "changed", old_value: "Eze", new_value: "Ezinne Ada", by_kind: "person", via: "my_page", note: "Saved at once" }]);
    expect(detail(await page(eze), "preferred_name")).toMatchObject({ value: "Ezinne Ada" });
    // the same again records nothing new
    expect(await save(eze, "preferred_name", "Ezinne Ada")).toEqual({ ok: true, outcome: "saved" });
    expect(await historyOf(eze, "preferred_name")).toHaveLength(1);
  });

  it("refuses a name that is too long, has no letter, or could carry an address or markup", async () => {
    for (const bad of ["x".repeat(41), "12345", "a@b.com", "<b>Eze</b>"]) {
      expect(await save(eze, "preferred_name", bad), bad).toMatchObject({ ok: false, reason: "bad_value" });
    }
    expect((await one("select preferred_name from public.people where id = $1", [eze])).preferred_name).toBe("Ezinne Ada");
    expect(await historyOf(eze, "preferred_name")).toHaveLength(1);
  });

  it("clears a name when it is emptied", async () => {
    expect(await save(eze, "preferred_name", "   ")).toEqual({ ok: true, outcome: "cleared" });
    expect((await one("select preferred_name from public.people where id = $1", [eze])).preferred_name).toBeNull();
    expect((await historyOf(eze, "preferred_name")).at(-1)).toMatchObject({ old_value: "Ezinne Ada", new_value: null });
    expect(await save(eze, "preferred_name", "Eze")).toEqual({ ok: true, outcome: "saved" });
  });

  it("saves an area at once, says so, and moves nobody", async () => {
    const [bola] = c.seasoned.members;
    const seat = () => c.sql("select tribe_id, status from public.tribe_members where person_id = $1", [bola]);
    const before = await seat();
    expect(await save(bola, "area", "mars")).toMatchObject({ ok: false, reason: "bad_value", message: "Choose one from the list" });
    expect(await save(bola, "area", null)).toMatchObject({ ok: false, reason: "bad_value" });
    expect(await save(bola, "area", "island-lekki")).toEqual({ ok: true, outcome: "saved" });
    expect((await one("select zone from public.member_profiles where person_id = $1", [bola])).zone).toBe("island-lekki");
    expect(await seat()).toEqual(before);
    const h = await historyOf(bola, "area");
    expect(h).toEqual([{ event: "changed", old_value: "mainland", new_value: "island-lekki", by_kind: "person", via: "my_page", note: expect.stringMatching(/Suggested tribes .* nobody is moved/) }]);
    expect((await one("select count(*)::int n from public.profile_changes where person_id = $1", [bola])).n).toBe(0);
  });

  it("saves a birthday as a day and a month only, and refuses a day that does not exist", async () => {
    expect(await save(eze, "birthday", "13-01")).toMatchObject({ ok: false, reason: "bad_value", message: "Choose a day and a month" });
    expect(await save(eze, "birthday", "March 14")).toMatchObject({ ok: false, reason: "bad_value" });
    expect(await save(eze, "birthday", "02-30")).toMatchObject({ ok: false, reason: "bad_value", message: "That day does not exist in that month" });
    expect(await save(eze, "birthday", "03-14")).toEqual({ ok: true, outcome: "saved" });
    expect(detail(await page(eze), "birthday")).toMatchObject({ value: "03-14", valueLabel: "14 March" });
    expect(await save(eze, "birthday", "02-29")).toEqual({ ok: true, outcome: "saved" });
    expect((await one("select birthday_month m, birthday_day d from public.member_profiles where person_id = $1", [eze]))).toEqual({ m: 2, d: 29 });
    expect(await save(eze, "birthday", null)).toEqual({ ok: true, outcome: "cleared" });
    expect((await one("select birthday_month m, birthday_day d from public.member_profiles where person_id = $1", [eze]))).toEqual({ m: null, d: null });
    expect((await historyOf(eze, "birthday")).map((h) => h.new_value)).toEqual(["03-14", "02-29", null]);
  });

  it("does not ask a person about a fact that is not theirs, nor a fact the person's own page does not hold", async () => {
    expect(await save(c.appointed.id, "area", "mainland")).toEqual({ ok: false, reason: "not_applicable" });
    expect(await save(c.appointed.id, "birthday", "03-14")).toEqual({ ok: false, reason: "not_applicable" });
    // the two facts the office asks as a question are answered as a question, never typed in
    expect(await save(eze, "life_stage", "builders")).toEqual({ ok: false, reason: "not_applicable" });
    expect(await save(eze, "age_range", "18-25")).toEqual({ ok: false, reason: "not_applicable" });
    expect(await save(eze, "shoe_size", "9")).toEqual({ ok: false, reason: "off" });
  });

  it("opens each group on its own switch", async () => {
    await open(["my_story"]);
    expect((await page(eze)).details).toEqual([]);
    expect(await save(eze, "area", "mainland")).toEqual({ ok: false, reason: "off" });
    expect(await save(eze, "about_me", "Still here")).toEqual({ ok: true, outcome: "saved" });
    await open(["my_details"]);
    expect((await page(eze)).story).toEqual([]);
    expect(await save(eze, "about_me", "Not now")).toEqual({ ok: false, reason: "off" });
    expect(await save(eze, "area", "mainland")).toEqual({ ok: true, outcome: "saved" });
    await open();
  });
});

describe("the person's own story", () => {
  it("keeps what is written, within each field's limit", async () => {
    expect(await save(eze, "about_me", "a".repeat(140))).toEqual({ ok: true, outcome: "saved" });
    expect(await save(eze, "about_me", "a".repeat(141))).toMatchObject({ ok: false, reason: "bad_value", message: "Keep it to 140 characters" });
    expect(await save(eze, "ask_me", "b".repeat(80))).toEqual({ ok: true, outcome: "saved" });
    expect(await save(eze, "ask_me", "b".repeat(81))).toMatchObject({ ok: false, message: "Keep it to 80 characters" });
    expect(await save(eze, "pray_for_me", "c".repeat(200))).toEqual({ ok: true, outcome: "saved" });
    expect(await save(eze, "pray_for_me", "c".repeat(201))).toMatchObject({ ok: false, message: "Keep it to 200 characters" });
    expect(await save(eze, "pray_for_me", "Pray for <b>me</b>")).toMatchObject({ ok: false, reason: "bad_value" });
    expect((await storyOf(eze)).map((r) => r.key)).toEqual(["about_me", "ask_me", "pray_for_me"]);
    expect(await save(eze, "about_me", "  Hello,    I am Eze.  ")).toEqual({ ok: true, outcome: "saved" });
    expect(detail(await page(eze), "about_me")).toMatchObject({ value: "Hello, I am Eze.", max: 140 });
  });

  it("takes up to three gifts, only from the list, once each, in the order chosen", async () => {
    expect(await save(eze, "gifts", "prayer,teaching,prayer")).toEqual({ ok: true, outcome: "saved" });
    expect((await storyOf(eze)).find((r) => r.key === "gifts")?.value).toBe("prayer,teaching");
    expect(detail(await page(eze), "gifts")).toMatchObject({ kind: "gifts", limit: 3, value: "prayer,teaching", valueLabel: "Prayer, Teaching" });
    expect(await save(eze, "gifts", "prayer,teaching,giving,faith")).toMatchObject({ ok: false, message: "Choose up to three" });
    expect(await save(eze, "gifts", "prayer,dancing")).toMatchObject({ ok: false, message: "Choose from the list" });
    expect((await storyOf(eze)).find((r) => r.key === "gifts")?.value).toBe("prayer,teaching");
    expect(detail(await page(eze), "gifts").options).toHaveLength(12);
  });

  it("clears a line when it is emptied, and writes no history for a story", async () => {
    expect(await save(eze, "ask_me", "")).toEqual({ ok: true, outcome: "cleared" });
    expect((await storyOf(eze)).map((r) => r.key)).toEqual(["about_me", "gifts", "pray_for_me"]);
    expect((await one("select count(*)::int n from public.profile_fact_history where person_id = $1 and key in ('about_me', 'gifts', 'ask_me', 'pray_for_me')", [eze])).n).toBe(0);
  });

  it("belongs to a leader as much as a member", async () => {
    expect(await save(c.appointed.id, "about_me", "I lead because someone led me.")).toEqual({ ok: true, outcome: "saved" });
    expect(detail(await page(c.appointed.id), "about_me")).toMatchObject({ value: "I lead because someone led me." });
  });

  it("is read by nobody else: not the pastor, the director, the admin, a tribe-mate, nor the leader of the tribe", async () => {
    for (const who of [c.pastor, c.director, c.admin, care, c.seasoned.id, c.seasoned.members[0], c.appointed.id]) {
      expect(JSON.stringify(await page(who)), who).not.toContain("Hello, I am Eze");
      await expectCode(c.db.asUser(who, (q) => q("select * from public.profile_story")), "42501");
    }
    // and no function the platform already had reads it: the activity audit and the person's own data download are the places to check
    expect(JSON.stringify(await c.as(c.seasoned.members[0], "export_my_data"))).not.toContain("Hello, I am Eze");
  });
});

describe("a person under 18", () => {
  it("is never shown My page, never takes a save, an ask or a prompt, and is never told it is open", async () => {
    const teen = await makeYoung("Teen");
    expect(await page(teen)).toEqual({ enabled: false });
    expect(await c.as(teen, "my_page_open")).toBe(false);
    expect(await save(teen, "about_me", "Hi")).toEqual({ ok: false, reason: "off" });
    expect(await save(teen, "preferred_name", "Tee")).toEqual({ ok: false, reason: "off" });
    expect(await c.as(teen, "my_office_ask", "I am 16")).toEqual({ ok: false, reason: "off" });
    expect(await c.as(teen, "still_right_state")).toEqual({ due: false });
    expect(await c.as(teen, "still_right_later", "age_range")).toEqual({ ok: false, reason: "off" });
    expect((await one("select count(*)::int n from public.profile_story where person_id = $1", [teen])).n).toBe(0);
    expect((await one("select count(*)::int n from public.profile_office_asks where person_id = $1", [teen])).n).toBe(0);
  });
});

describe("role panels", () => {
  const byKey = (panels: { key: string }[]) => panels.map((p) => p.key);
  const lineOf = (panel: any, label: string) => panel.lines.find((l: any) => l.label === label); // eslint-disable-line @typescript-eslint/no-explicit-any

  it("shows nothing while the function is Off, and nothing to a person under 18", async () => {
    await open(["my_details"]);
    expect((await page(eze)).panels).toEqual([]);
    expect((await page(c.pastor)).panels).toEqual([]);
    await open();
  });

  it("gives a member their tribe, their goal and (once placed) this week's step, and nothing about anyone else", async () => {
    const mine = (await page(eze)).panels;
    expect(byKey(mine)).toEqual(["member"]);
    expect(lineOf(mine[0], "Your tribe")).toEqual({ label: "Your tribe", value: "Not placed yet" });
    expect(mine[0].link).toEqual({ label: "Open My tribe", path: "/tribe" });
    expect(mine[0].lines.map((l: { label: string }) => l.label)).not.toContain("This week's step");
    const bola = (await page(c.seasoned.members[0])).panels;
    expect(lineOf(bola[0], "Your tribe").value).toBe("Seasoned Tribe");
    expect(lineOf(bola[0], "This week's step")).toBeDefined();
    expect(JSON.stringify(bola)).not.toMatch(/Chidi|Seasoned Test/);
  });

  it("gives a leader their card's standing, a count of the people in it, and their training, never the people", async () => {
    const draft = (await page(c.appointed.id)).panels;
    expect(byKey(draft)).toEqual(["leader"]);
    expect(draft[0].lines.map((l: { label: string }) => l.label)).toEqual(["Tribe Card", "People in it", "Training"]);
    expect(lineOf(draft[0], "People in it").value).toBe("0");
    const seasoned = (await page(c.seasoned.id)).panels;
    expect(lineOf(seasoned[0], "Tribe Card").value).toBe("Approved");
    expect(lineOf(seasoned[0], "People in it").value).toBe("2");
    expect(lineOf(seasoned[0], "Training").value).toBe("Certified");
    expect(seasoned[0].link).toEqual({ label: "Open Lead a tribe", path: "/lead" });
    expect(JSON.stringify(seasoned)).not.toMatch(/Bola|Chidi/);
  });

  it("gives the pastor, the director and the admin what waits for them, with the right place to open", async () => {
    for (const [who, path] of [[c.pastor, "/review"], [c.director, "/review"], [c.admin, "/admin"]] as const) {
      const panels = (await page(who)).panels;
      expect(byKey(panels)[0], who).toBe("office");
      expect(panels[0].title).toBe("Waiting for you");
      expect(panels[0].lines).toHaveLength(3);
      expect(panels[0].lines.every((l: { value: string }) => /^\d+$/.test(l.value))).toBe(true);
      expect(panels[0].link.path).toBe(path);
    }
  });

  it("puts the most senior role first, each once, for a person who holds several", async () => {
    const both = (await c.k.staff("Both", "leader", "coach")).id;
    expect(byKey((await page(both)).panels)).toEqual(["coach", "leader"]);
    const three = (await c.k.staff("Three", "pastor", "coach", "data_lead")).id;
    expect(byKey((await page(three)).panels)).toEqual(["office", "data", "coach"]);
  });

  it("says where an application stands in a code the website puts words to, and stops once it is decided in the person's favour", async () => {
    const applicant = (await c.k.person("Applicant")).id;
    await c.db.admin.query("insert into public.leader_applications (person_id, status, answers, consent_version) values ($1, 'submitted', '{}'::jsonb, 'test')", [applicant]);
    const panel = (await page(applicant)).panels.find((p: { key: string }) => p.key === "applicant");
    expect(panel).toMatchObject({ title: "Your application to lead", lines: [{ label: "Where it stands", code: "submitted" }], link: { path: "/lead" } });
    await c.db.admin.query("update public.leader_applications set status = 'approved_leader' where person_id = $1", [applicant]);
    expect(byKey((await page(applicant)).panels)).not.toContain("applicant");
  });
});

describe("Ask the church office (class D: across 17 and 18 is never self-service)", () => {
  let ask: string;
  let held: string;

  it("tells the Care Team, changes nothing, and lets the person see that it is with them", async () => {
    held = (await one("select label from public.age_ranges where slug = '26-32'")).label as string;
    const r = await c.as(eze, "my_office_ask", "  I am really 16  ");
    expect(r).toMatchObject({ ok: true });
    ask = r.ask;
    expect(await one("select status, held_value, note, centre_id is not null as centre from public.profile_office_asks where id = $1", [ask])).toEqual({ status: "open", held_value: "26-32", note: "I am really 16", centre: true });
    expect(await rangeOf(eze)).toBe("26-32");
    expect((await one("select count(*)::int n from public.profile_changes where person_id = $1 and key = 'age_range'", [eze])).n).toBe(0);
    expect((await page(eze)).office).toMatchObject({ status: "open", closedAt: null, note: null });
    expect((await one("select count(*)::int n from public.event_log where action = 'profile.office_asked' and actor_id = $1", [eze])).n).toBe(1);
  });

  it("tells the care lead alone, without a name or a reason, by the care route", async () => {
    const items = await c.sql("select person_id, label, path, delivery from public.notice_items where kind = 'care_age_ask' and event = $1", [`ageask:${ask}`]);
    expect(items).toEqual([{ person_id: care, label: "Someone says their age range is not right", path: "/care/teens", delivery: "instant" }]);
    const mail = await c.sql("select person_id, params from public.messages where template = 'care_age_ask' order by created_at");
    expect(mail.map((m) => m.person_id)).toEqual([care]);
    expect(JSON.stringify(mail)).not.toMatch(/Eze|really 16/);
  });

  it("keeps one message open at a time, and refuses a note over 300 characters", async () => {
    expect(await c.as(eze, "my_office_ask", "Again")).toMatchObject({ ok: false, reason: "waiting" });
    await expectCode(c.as(eze, "my_office_ask", "x".repeat(301)), "22023");
    expect((await one("select count(*)::int n from public.profile_office_asks where person_id = $1", [eze])).n).toBe(1);
  });

  it("is for someone with an age range on record, and only while My page is open", async () => {
    expect(await c.as(c.appointed.id, "my_office_ask", null)).toEqual({ ok: false, reason: "not_applicable" });
    expect(await c.as(c.pastor, "my_office_ask", null)).toEqual({ ok: false, reason: "not_applicable" });
    await c.reset();
    expect(await c.as(c.seasoned.members[0], "my_office_ask", null)).toEqual({ ok: false, reason: "off" });
    await open();
  });

  it("shows the Care Team the list, and only the Care Team", async () => {
    for (const who of [care, c.director, c.pastor, c.admin]) {
      const list = await c.as(who, "profile_office_asks_list");
      expect(list.asks).toHaveLength(1);
      expect(list.asks[0]).toMatchObject({ id: ask, status: "open", note: "I am really 16", held, closedAt: null, closingNote: null });
      expect(list.asks[0].person).toBeTruthy();
    }
    for (const who of [eze, c.seasoned.id, c.appointed.id]) await expectCode(c.as(who, "profile_office_asks_list"), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.profile_office_asks_list()")), "42501");
  });

  it("is closed by the Care Team with a note the person reads, and never changes the age range", async () => {
    await expectCode(c.as(eze, "profile_office_ask_close", ask, "I close it"), "42501");
    await expectCode(c.as(care, "profile_office_ask_close", ask, "x".repeat(301)), "22023");
    await expectCode(c.as(care, "profile_office_ask_close", "00000000-0000-0000-0000-000000000000", null), "P0002");
    expect(await c.as(care, "profile_office_ask_close", ask, "We will call you on Monday")).toEqual({ ok: true });
    await expectCode(c.as(care, "profile_office_ask_close", ask, null), "22023");
    expect((await page(eze)).office).toMatchObject({ status: "done", note: "We will call you on Monday" });
    expect(await rangeOf(eze)).toBe("26-32");
    const list = await c.as(care, "profile_office_asks_list");
    expect(list.asks[0]).toMatchObject({ status: "done", closingNote: "We will call you on Monday" });
    expect((await one("select count(*)::int n from public.event_log where action = 'profile.office_ask_closed'")).n).toBe(1);
  });

  it("goes from the person's page and the Care Team's list after thirty days, and lets the person ask again", async () => {
    await c.db.admin.query("update public.profile_office_asks set closed_at = now() - interval '31 days' where id = $1", [ask]);
    expect((await page(eze)).office).toBeNull();
    expect((await c.as(care, "profile_office_asks_list")).asks).toEqual([]);
    const again = await c.as(eze, "my_office_ask", null);
    expect(again).toMatchObject({ ok: true });
    expect((await page(eze)).office).toMatchObject({ status: "open" });
    await c.as(care, "profile_office_ask_close", again.ask, null);
  });

  it("goes to the directors when there is no care lead, and to the admins when there is neither", async () => {
    await c.db.admin.query("delete from public.person_roles where person_id = $1 and role = 'care_lead'", [care]);
    const second = await c.as(eze, "my_office_ask", null);
    expect(second).toMatchObject({ ok: true });
    expect((await c.sql("select person_id from public.notice_items where kind = 'care_age_ask' and event = $1", [`ageask:${second.ask}`])).map((r) => r.person_id)).toEqual([c.director]);
    await c.as(c.director, "profile_office_ask_close", second.ask, null);
    await c.db.admin.query("delete from public.person_roles where person_id = $1 and role = 'director'", [c.director]);
    const third = await c.as(eze, "my_office_ask", null);
    expect((await c.sql("select person_id from public.notice_items where kind = 'care_age_ask' and event = $1", [`ageask:${third.ask}`])).map((r) => r.person_id)).toEqual([c.admin]);
    await c.as(c.admin, "profile_office_ask_close", third.ask, null);
    await c.db.grant(care, "care_lead");
    await c.db.grant(c.director, "director");
  });

  it("is counted on the care lead's panel while it waits", async () => {
    const waiting = await c.as(eze, "my_office_ask", null);
    const panel = (await page(care)).panels.find((p: { key: string }) => p.key === "care");
    expect(panel.lines.find((l: { label: string }) => l.label === "Members who say their age range is not right").value).toBe("1");
    await c.as(care, "profile_office_ask_close", waiting.ask, null);
  });
});

describe("Still right? once a season", () => {
  const due = (who: string) => c.as(who, "still_right_state");
  const notDue = async (who: string) => expect((await due(who)).due).toBe(false);
  let lead: string;

  it("asks nobody while it is Off, and nobody whose fact was confirmed since the season began", async () => {
    await open(["my_details"]);
    await notDue(eze);
    await open();
    await notDue(eze);
    lead = (await c.appoint("Still")).id;
    await c.as(lead, "my_page_answer", "life_stage", "yes", null);
    await notDue(lead);
  });

  it("asks about a fact last confirmed before the season began, with the choices to change it to", async () => {
    await c.db.admin.query("update public.profile_facts set confirmed_at = now() - interval '60 days' where person_id = $1", [lead]);
    const r = await due(lead);
    expect(r).toMatchObject({ due: true, season: "Test season" });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ key: "life_stage", label: "Stage of life", valueLabel: "26 to 40, the Builders stage" });
    expect(r.items[0].options.map((o: { value: string }) => o.value)).toEqual(["rising", "builders", "stewards", "sages"]);
    await c.db.admin.query("update public.member_profiles set submitted_at = now() - interval '60 days' where person_id = $1", [eze]);
    expect((await due(eze)).items.map((i: { key: string }) => i.key)).toEqual(["age_range"]);
  });

  it("stops asking once the person says yes, with nothing sent to anyone", async () => {
    const messages = (await one("select count(*)::int n from public.messages")).n;
    expect(await c.as(lead, "my_page_answer", "life_stage", "yes", null)).toEqual({ ok: true, outcome: "confirmed" });
    await notDue(lead);
    expect((await one("select count(*)::int n from public.messages")).n).toBe(messages);
  });

  it("hides one question for the season on 'Not now', and asks again the next season", async () => {
    expect(await c.as(eze, "still_right_later", "area")).toEqual({ ok: false, reason: "off" });
    expect(await c.as(eze, "still_right_later", "life_stage")).toEqual({ ok: false, reason: "off" });
    expect(await c.as(eze, "still_right_later", "age_range")).toEqual({ ok: true });
    expect(await c.as(eze, "still_right_later", "age_range")).toEqual({ ok: true });
    expect((await one("select count(*)::int n from public.profile_prompts where person_id = $1", [eze])).n).toBe(1);
    await notDue(eze);
    expect(await rangeOf(eze)).toBe("26-32");
    const next = await c.k.season("Next season", 5);
    await c.db.admin.query("update public.seasons set status = 'running' where id = $1", [next]);
    expect(await due(eze)).toMatchObject({ due: true, season: "Next season" });
    await c.db.admin.query("update public.seasons set status = 'planning' where id = $1", [next]);
  });

  it("does not ask while a change is already waiting for a pastor", async () => {
    const r = await c.as(c.seasoned.id, "my_page_answer", "life_stage", "change", "sages");
    expect(r.outcome).toBe("pending_review");
    await c.db.admin.query("update public.profile_facts set confirmed_at = now() - interval '60 days' where person_id = $1", [c.seasoned.id]);
    await notDue(c.seasoned.id);
    await c.as(c.pastor, "stage_review_decide", r.change, false, null);
  });

  it("says nothing when there is no season under way, and nothing to a person under 18", async () => {
    await c.db.admin.query("update public.seasons set status = 'planning' where id = $1", [c.season]);
    await c.db.admin.query("update public.profile_prompts set season_id = season_id where false");
    await notDue(lead);
    expect(await c.as(lead, "still_right_later", "life_stage")).toEqual({ ok: false, reason: "off" });
    await c.db.admin.query("update public.seasons set status = 'running' where id = $1", [c.season]);
  });
});

describe("what the person holds, in their own data file", () => {
  it("lists their facts, how each changed, their story, what they told the Care Team and what they put off, and only theirs", async () => {
    const mine = await c.as(eze, "my_profile_export");
    expect(Object.keys(mine).sort()).toEqual(["how_a_fact_changed", "still_right_not_now", "what_you_told_the_care_team", "your_story"]);
    expect(mine.your_story).toMatchObject({ "About me": "Hello, I am Eze.", Gifts: "Prayer, Teaching", "How to pray for me": "c".repeat(200) });
    expect(mine.what_you_told_the_care_team.length).toBeGreaterThanOrEqual(3);
    expect(mine.what_you_told_the_care_team[0]).toMatchObject({ fact: "Age range", we_held: expect.stringMatching(/^26.32$/), status: expect.stringMatching(/open|done/) });
    expect(mine.still_right_not_now).toEqual([expect.objectContaining({ fact: "Age range", season: "Test season" })]);
    expect(mine.how_a_fact_changed.map((h: { fact: string }) => h.fact)).toEqual(expect.arrayContaining(["Name we use for you", "Birthday"]));
    const lead = await c.as(c.appointed.id, "my_profile_export");
    expect(JSON.stringify(lead)).not.toMatch(/Eze|Hello, I am Eze|really 16/);
    expect(lead.your_story).toEqual({ "About me": "I lead because someone led me." });
  });

  it("is empty for a person who holds nothing, and never names a table", async () => {
    expect(await c.as(c.member, "my_profile_export")).toEqual({});
    expect(JSON.stringify(await c.as(eze, "my_profile_export"))).not.toMatch(/person_id|profile_story|_id"/);
  });
});
