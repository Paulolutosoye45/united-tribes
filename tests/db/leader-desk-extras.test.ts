import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode, type Row } from "./helpers";
import { readyMember } from "./placement-kit";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// The Leader Desk, the three things Phase 2 left out: "Yes, as assistant" on an offer, "Recommend as leader" on a waiting member's row, and WhatsApp for the Desk.
// What these prove:
//   * all three are the owner's alone and closed until the Switchboard opens the Desk; the two new helpers are closed to every signed-in person;
//   * the WhatsApp switch is Off to begin with and needs a reason; while Off every Desk message is forced to email, exactly as before; when On the Desk stops forcing
//     email and the ordinary rules choose (a member who gave a number and agreed is reached on WhatsApp, anyone else by email); turning it Off sends anything still
//     waiting back to email; a Rehearsal sends nothing either way;
//   * "Yes, as assistant" is a no to leading that the group remembers: the next backup is asked, only one member can offer, it needs the age confirmed, and when
//     someone else leads, the member is put forward to the church office as a recommendation that the office still decides, the new leader is told, and nobody is paired;
//   * the list on a waiting member's row is the draft groups they could be offered right now, by the same rules as the group's own card, and says why when there are none.

let c: Cast;
let n = 0;
let token: string;
const REASON = "Trying the Desk's extras with real people";

const owner = (fn: string, ...args: unknown[]) => c.o.call(fn, ...args);
const admin = (text: string, params: unknown[] = []) => c.sql(text, params);
const lagosHour = async (h: number | null) => {
  await admin(
    h === null
      ? "create or replace function public.lagos_hour() returns integer language sql stable set search_path to '' as $f$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer; $f$"
      : `create or replace function public.lagos_hour() returns integer language sql stable set search_path to '' as $f$ select ${h}; $f$`,
  );
};
const setMode = (mode: "off" | "rehearsal" | "on") => c.set("leader_desk", mode, { reason: REASON });

async function candidate(name: string, set: Record<string, unknown> = {}, o: Parameters<typeof readyMember>[4] = {}) {
  const m = await readyMember(c.db, c.k, c.season, `${name}${++n}`, { daysAgo: 6, faith: "established", ...o });
  const merged = { open_to_serving: "yes", ...set };
  for (const [col, v] of Object.entries(merged)) await admin(`update public.member_profiles set ${col} = $2 where person_id = $1`, [m.id, v]);
  return m;
}
async function plain(name: string, o: Parameters<typeof readyMember>[4] = {}) {
  return readyMember(c.db, c.k, c.season, `${name}${++n}`, { daysAgo: 6, ...o });
}
const GROUP = { slot: "weeknight-evening", mode: "in_person", zone: "mainland", type: "mixed", capacity: 8 };
async function makeGroup(over: Partial<typeof GROUP> & { goal?: string; community?: string } = {}) {
  const g = { ...GROUP, ...over };
  const community = over.community ?? "professionals";
  const track = await c.k.lookup("tracks", "builders");
  const comm = await c.k.lookup("communities", community);
  const goal = over.goal ? ((await admin("select id from public.season_goals where slug = $1", [over.goal]))[0].id as string) : await c.k.goalOf(community);
  return (await owner("desk_group_save", null, `Extras group ${++n}`, track, comm, goal, g.slot, g.mode, g.zone, g.type, g.capacity, null)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const offerOf = async (group: string, person: string) => (await admin("select * from public.desk_offers where group_id = $1 and person_id = $2 order by round desc limit 1", [group, person]))[0];
const linkOf = async (offer: string) => (await admin("select reply_token from public.messages where dedupe_key = $1", [`desk-offer:${offer}`]))[0]?.reply_token as string;
const info = (link: string) => c.anon("worker_desk_offer_info", token, link);
const answer = (link: string, a: string, o: { age?: boolean; lead?: string | null; relation?: string | null; reasons?: string[] } = {}) =>
  c.anon("worker_desk_offer_answer", token, link, a, o.age ?? false, o.lead ?? null, o.relation ?? null, o.reasons ?? []);
const yes = (link: string) => answer(link, "lead", { age: true, lead: "connection", relation: "achieved" });
const groupRow = async (id: string) => (await admin("select * from public.desk_groups where id = $1", [id]))[0];

/** A group with a leader candidate and two backups ready. */
async function setup() {
  await admin("update public.tribes set status = 'closed' where status = 'approved'");
  const g = await makeGroup();
  const lead = await candidate("Lead");
  const b1 = await candidate("BackA");
  const b2 = await candidate("BackB");
  const draftMember = await plain("Draft");
  await owner("desk_group_member_add", g.id, draftMember.id);
  return { g, lead, b1, b2, draftMember };
}
async function sendOffer(g: string, ...people: string[]) {
  await owner("desk_offer_send", g, people);
  return linkOf((await offerOf(g, people[0])).id);
}
/** Gives a member a number on file and their agreement to WhatsApp, so the ordinary rules can reach them there. */
async function onWhatsApp(id: string) {
  await admin("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031234567', 'whatsapp') on conflict (person_id) do update set phone = excluded.phone, preferred = excluded.preferred", [id]);
  await admin("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 't')", [id]);
}
const channelsOf = async (messageId: string) => (await c.one("select public.message_channels($1) as ch", [messageId])).ch as string[];

beforeAll(async () => {
  c = await makeCast();
  await c.k.moveSeason(c.season, 3);
  await setMode("on");
  await admin("update public.desk_settings set daily_cap = 300");
  token = (await c.one("select public.bootstrap_worker_token('desk-extras-test') as t")).t as string;
  await lagosHour(11);
}, 240_000);

afterAll(async () => {
  await c?.db.close();
});

describe("who may use it", () => {
  const CALLS: [string, unknown[]][] = [
    ["desk_person_lead_options", [NOBODY]],
    ["desk_whatsapp_state", []],
    ["desk_whatsapp_set", [true, "A reason"]],
  ];

  it("is the owner's alone: an admin, a director, the pastor and a member are turned away, and so is a visitor", async () => {
    const m = await plain("Plain");
    for (const who of [c.admin, c.director, c.pastor, m.id, c.member]) {
      for (const [fn, args] of CALLS) await expectCode(c.as(who, fn, ...args), "42501");
    }
    for (const [fn, args] of CALLS) await expectCode(c.anon(fn, ...args), "42501");
  });

  it("keeps the two new helpers closed to every signed-in person, the owner included", async () => {
    const helpers: [string, unknown[]][] = [
      ["desk_whatsapp_on", []],
      ["desk_assistant_put_forward", [NOBODY, NOBODY, NOBODY]],
    ];
    for (const [fn, args] of helpers) {
      await expectCode(c.o.run((q) => q(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args)), "42501");
    }
  });

  it("is closed while the Switchboard has the Desk Off", async () => {
    await setMode("off");
    for (const [fn, args] of CALLS) await expectCode(owner(fn, ...args), "42501");
    await setMode("on");
  });
});

describe("WhatsApp for the Desk", () => {
  it("is Off to begin with, says how many waiting members it would reach, and changes nothing about email", async () => {
    const s = (await owner("desk_whatsapp_state")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(s.on).toBe(false);
    expect(s.mode).toBeTruthy();
    expect(typeof s.waiting).toBe("number");
    expect(s.reach).toBeLessThanOrEqual(s.waiting);
  });

  it("needs a reason, and records who and when", async () => {
    await expectCode(owner("desk_whatsapp_set", true, ""), "22023");
    await expectCode(owner("desk_whatsapp_set", true, "  "), "22023");
    await expectCode(owner("desk_whatsapp_set", true, "x".repeat(301)), "22023");
    await expectCode(owner("desk_whatsapp_set", null, "A reason"), "22023");
    expect((await c.one("select whatsapp_on from public.desk_settings")).whatsapp_on).toBe(false);
  });

  it("forces every Desk message to email while it is Off", async () => {
    const { g, lead } = await setup();
    await onWhatsApp(lead.id);
    await sendOffer(g.id, lead.id);
    const m = await c.one("select * from public.messages where dedupe_key = $1", [`desk-offer:${(await offerOf(g.id, lead.id)).id}`]);
    expect(m.force_channel).toBe("email");
    expect(await channelsOf(m.id)).toEqual(["email"]);
  });

  it("stops forcing email when it is On: a member who gave a number and agreed is reached on WhatsApp, anyone else by email", async () => {
    const s = (await owner("desk_whatsapp_set", true, REASON)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(s.on).toBe(true);
    expect(s.reason).toBe(REASON);
    const { g, lead, b1 } = await setup();
    await onWhatsApp(lead.id);
    await sendOffer(g.id, lead.id, b1.id);
    const first = await c.one("select * from public.messages where dedupe_key = $1", [`desk-offer:${(await offerOf(g.id, lead.id)).id}`]);
    expect(first.force_channel).toBeNull();
    expect((await channelsOf(first.id))[0]).toBe("whatsapp");
    expect(first.reply_token).toMatch(/^[a-f0-9]{64}$/);
    // the backup has no number: the ordinary rules give them email, and nothing is lost
    await answer(first.reply_token, "not_season");
    const second = await c.one("select * from public.messages where dedupe_key = $1", [`desk-offer:${(await offerOf(g.id, b1.id)).id}`]);
    expect(second.force_channel).toBeNull();
    expect(await channelsOf(second.id)).toEqual(["email"]);
  });

  it("keeps the Desk's own limits and blocks: a member who stopped the Desk is still not written to", async () => {
    const stopped = await candidate("Stopped");
    await onWhatsApp(stopped.id);
    await admin("insert into public.desk_stops (person_id) values ($1)", [stopped.id]);
    const g = await makeGroup();
    await expect(owner("desk_offer_send", g.id, [stopped.id])).rejects.toThrow();
    expect((await admin("select count(*)::int n from public.messages where person_id = $1 and template like 'desk_%'", [stopped.id]))[0].n).toBe(0);
  });

  it("sends nothing in Rehearsal, with the switch On", async () => {
    await setMode("rehearsal");
    const g = await makeGroup();
    const lead = await candidate("RehLead");
    await onWhatsApp(lead.id);
    const before = (await admin("select count(*)::int n from public.messages where person_id = $1", [lead.id]))[0].n;
    await owner("desk_offer_send", g.id, [lead.id]);
    expect((await admin("select count(*)::int n from public.messages where person_id = $1", [lead.id]))[0].n).toBe(before);
    expect((await offerOf(g.id, lead.id)).status).toBe("would_send");
    await setMode("on");
  });

  it("sends anything still waiting back to email when it is turned Off", async () => {
    const { g, lead } = await setup();
    await onWhatsApp(lead.id);
    await sendOffer(g.id, lead.id);
    const id = (await c.one("select id from public.messages where dedupe_key = $1", [`desk-offer:${(await offerOf(g.id, lead.id)).id}`])).id as string;
    await admin("update public.messages set status = 'queued', force_channel = null where id = $1", [id]);
    const s = (await owner("desk_whatsapp_set", false, "Back to email for now")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(s.on).toBe(false);
    const m = await c.one("select * from public.messages where id = $1", [id]);
    expect(m.force_channel).toBe("email");
    expect(await channelsOf(id)).toEqual(["email"]);
  });

  it("classes the Desk's messages for WhatsApp mode: the question to someone asked to lead stays on WhatsApp in Saver, the rest goes by email", async () => {
    const rows = await admin("select template, class from public.whatsapp_message_class where template like 'desk_%' order by template");
    expect(Object.fromEntries(rows.map((r) => [r.template, r.class]))).toEqual({ desk_found: "C", desk_interest: "C", desk_offer: "A", desk_proposal: "C" });
  });

  it("writes only the on/off to the log: no reason, no number", async () => {
    const rows = await admin("select meta::text as meta from public.event_log where action = 'desk.whatsapp' order by at desc limit 5");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.meta).toMatch(/"on"/);
      expect(r.meta).not.toMatch(/\+234|2348|trying|email for now/i);
    }
  });
});

describe("Yes, as assistant", () => {
  it("is a no to leading that the group remembers, and the next backup is asked", async () => {
    await owner("desk_whatsapp_set", false, "Email only for these tests");
    const { g, lead, b1, b2 } = await setup();
    const link = await sendOffer(g.id, lead.id, b1.id, b2.id);
    expect(((await info(link)) as Row).assist_open).toBe(true);
    const r = (await answer(link, "assist", { age: true })) as Row;
    expect(r).toMatchObject({ ok: true, answer: "assist" });
    const o = await offerOf(g.id, lead.id);
    expect(o).toMatchObject({ status: "declined", answer: "assist" });
    expect(o.age_confirmed_at).not.toBeNull();
    const row = await groupRow(g.id);
    expect(row.assistant_id).toBe(lead.id);
    expect(row.assistant_yes_at).not.toBeNull();
    expect(row.assistant_offer_id).toBe(o.id);
    expect(row.leader_id).toBeNull();
    expect((await offerOf(g.id, b1.id)).status).toBe("open");
    // pressing it again changes nothing and says so
    expect(await answer(link, "assist", { age: true })).toMatchObject({ ok: true, answer: "assist", again: true });
    // the owner sees who offered
    const view = (await owner("desk_group_leader", g.id)) as Row;
    expect(view.assistant).toMatchObject({ person_id: lead.id, status: null });
    expect(view.leader).toBeNull();
  });

  it("appoints nobody and promises nothing: no tribe, no seat, no role, no recommendation until someone else leads", async () => {
    const { g, lead, b1 } = await setup();
    const link = await sendOffer(g.id, lead.id, b1.id);
    const before = (await admin("select (select count(*)::int from public.assistant_recommendations) as recs, (select count(*)::int from public.tribes) as tribes, (select count(*)::int from public.person_roles) as roles"))[0];
    await answer(link, "assist", { age: true });
    const after = (await admin("select (select count(*)::int from public.assistant_recommendations) as recs, (select count(*)::int from public.tribes) as tribes, (select count(*)::int from public.person_roles) as roles"))[0];
    expect(after).toEqual(before);
    expect((await admin("select 1 from public.person_roles where person_id = $1 and role = 'assistant_leader'", [lead.id])).length).toBe(0);
  });

  it("needs the age confirmed, and takes no leader answers with it", async () => {
    const { g, lead } = await setup();
    const link = await sendOffer(g.id, lead.id);
    await expectCode(answer(link, "assist", { age: false }), "22023");
    await expectCode(answer(link, "assist", { age: true, lead: "connection" }), "22023");
    await expectCode(answer(link, "assist", { age: true, relation: "achieved" }), "22023");
    await expectCode(answer(link, "assist", { age: true, reasons: ["busy"] }), "22023");
    expect((await offerOf(g.id, lead.id)).status).toBe("open");
    await expectCode(answer(link, "not_season", { age: true }), "22023");
    await expectCode(answer(link, "call", { age: true }), "22023");
  });

  it("lets only one member offer to assist a group, and says so to the second", async () => {
    const { g, lead, b1 } = await setup();
    const link1 = await sendOffer(g.id, lead.id, b1.id);
    await answer(link1, "assist", { age: true });
    const link2 = await linkOf((await offerOf(g.id, b1.id)).id);
    expect(((await info(link2)) as Row).assist_open).toBe(false);
    expect(await answer(link2, "assist", { age: true })).toMatchObject({ ok: false, reason: "taken" });
    expect((await offerOf(g.id, b1.id)).status).toBe("open");
    expect((await groupRow(g.id)).assistant_id).toBe(lead.id);
  });

  it("does not shut the member out of future offers the way \"Not this season\" and \"Never\" do", async () => {
    const { g, lead, b1 } = await setup();
    const link = await sendOffer(g.id, lead.id, b1.id);
    await answer(link, "assist", { age: true });
    const g2 = await makeGroup();
    const opts = (await owner("desk_person_lead_options", lead.id)) as Row;
    expect((opts.rows as Row[]).map((r) => r.group_id)).toContain(g2.id);
    expect((await admin("select 1 from public.desk_lead_stops where person_id = $1", [lead.id])).length).toBe(0);
  });

  it("refuses when the gates no longer hold at the moment of the answer", async () => {
    const { g, lead } = await setup();
    const link = await sendOffer(g.id, lead.id);
    await admin("update public.member_profiles set open_to_serving = 'not_now' where person_id = $1", [lead.id]);
    expect(await answer(link, "assist", { age: true })).toMatchObject({ ok: false, reason: "not_available" });
    expect((await groupRow(g.id)).assistant_id).toBeNull();
  });

  it("puts the member forward to the church office when someone else leads: a recommendation the office decides, the new leader told, nobody paired", async () => {
    const { g, lead, b1, draftMember } = await setup();
    await owner("desk_group_member_add", g.id, lead.id).catch(() => undefined);
    const link1 = await sendOffer(g.id, lead.id, b1.id);
    await answer(link1, "assist", { age: true });
    const link2 = await linkOf((await offerOf(g.id, b1.id)).id);
    const r = (await yes(link2)) as Row;
    expect(r).toMatchObject({ ok: true, answer: "lead" });
    const tribe = (await groupRow(g.id)).tribe_id as string;
    expect(tribe).toBeTruthy();
    const recs = await admin("select * from public.assistant_recommendations where tribe_id = $1", [tribe]);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ nominee_id: lead.id, recommended_by: b1.id, status: "requested" });
    expect(recs[0].reason).toMatch(/Leader Desk/);
    // the new leader is told, by email only, and can see and withdraw it
    const told = await admin("select * from public.messages where person_id = $1 and template = 'desk_assistant_offer'", [b1.id]);
    expect(told).toHaveLength(1);
    expect(told[0].force_channel).toBe("email");
    expect(JSON.stringify(told[0].params)).not.toMatch(/\+?234\d{8,}|@/);
    expect(((await c.as(b1.id, "assistant_my_state", tribe)) as Row).open).toMatchObject({ status: "requested" });
    // nobody is paired, and the member is no longer on the draft's list of people waiting
    expect((await admin("select assistant_id from public.tribes where id = $1", [tribe]))[0].assistant_id).toBeNull();
    expect((await admin("select 1 from public.desk_group_members where group_id = $1 and person_id = $2", [g.id, lead.id])).length).toBe(0);
    expect((await admin("select 1 from public.desk_group_members where group_id = $1 and person_id = $2", [g.id, draftMember.id])).length).toBe(1);
    // the owner sees where it stands
    const view = (await owner("desk_group_leader", g.id)) as Row;
    expect(view.assistant).toMatchObject({ person_id: lead.id, status: "requested" });
  });

  it("leaves the decision to the office, by the way it already decides: an admin can approve, and the member is invited to apply", async () => {
    const { g, lead, b1 } = await setup();
    await answer(await sendOffer(g.id, lead.id, b1.id), "assist", { age: true });
    await yes(await linkOf((await offerOf(g.id, b1.id)).id));
    const tribe = (await groupRow(g.id)).tribe_id as string;
    const rec = (await admin("select id from public.assistant_recommendations where tribe_id = $1", [tribe]))[0].id as string;
    const done = (await c.as(c.admin, "assistant_decide", rec, true, null, false)) as Row;
    expect(done).toMatchObject({ ok: true, status: "invited" });
    // they are not made an assistant leader by the Desk: that still takes their application, a pastor's decision and the training
    expect((await admin("select 1 from public.person_roles where person_id = $1 and role = 'assistant_leader'", [lead.id])).length).toBe(0);
    expect((await admin("select assistant_id from public.tribes where id = $1", [tribe]))[0].assistant_id).toBeNull();
  });

  it("puts nobody forward when the member who offered to assist is the one who now leads", async () => {
    const { g, lead } = await setup();
    await answer(await sendOffer(g.id, lead.id), "assist", { age: true });
    // the owner asks the same person again, this time to lead
    expect((await owner("desk_offer_send", g.id, [lead.id])) as Row).toMatchObject({ ok: true });
    const link = await linkOf((await offerOf(g.id, lead.id)).id);
    expect(await yes(link)).toMatchObject({ ok: true, answer: "lead" });
    const row = await groupRow(g.id);
    expect(row.leader_id).toBe(lead.id);
    expect(row.assistant_id).toBeNull();
    expect((await admin("select count(*)::int n from public.assistant_recommendations where tribe_id = $1", [row.tribe_id]))[0].n).toBe(0);
  });

  it("leaves the group as it was when the owner appoints no one: the offer stays on the record and the owner is asked to decide", async () => {
    const { g, lead } = await setup();
    await answer(await sendOffer(g.id, lead.id), "assist", { age: true });
    const view = (await owner("desk_group_leader", g.id)) as Row;
    expect(view.needs_decision).toBe(true);
    expect(view.assistant).toMatchObject({ person_id: lead.id });
    expect(((view.offers as Row[])[0] as Row).answer).toBe("assist");
  });

  it("is counted as a no to leading for the list of offers, and as nothing else", async () => {
    const list = (await owner("desk_offers_list", 50, 0)) as Row;
    const mine = (list.rows as Row[]).filter((r) => r.answer === "assist");
    expect(mine.length).toBeGreaterThan(0);
    for (const r of mine) expect(r.status).toBe("declined");
  });
});

describe("Recommend as leader, on a waiting member's row", () => {
  it("lists the draft groups they could be offered right now, by the group's own rules", async () => {
    await admin("update public.tribes set status = 'closed' where status = 'approved'");
    await admin("update public.desk_groups set status = 'archived' where status = 'draft'");
    const g1 = await makeGroup();
    const g2 = await makeGroup({ slot: "saturday-morning" });
    const m = await candidate("Row", { meeting_times: [] });
    const r = (await owner("desk_person_lead_options", m.id)) as Row;
    expect((r.rows as Row[]).map((x) => x.group_id).sort()).toEqual([g1.id, g2.id].sort());
    expect(r.why).toBeNull();
    expect((r.rows as Row[])[0]).toMatchObject({ name: expect.any(String) });
    expect(JSON.stringify(r)).not.toMatch(/\+?234\d{8,}|@/);
  });

  it("leaves out a group the member cannot make, and one that already has an offer out", async () => {
    await admin("update public.desk_groups set status = 'archived' where status = 'draft'");
    const evening = await makeGroup();
    const saturday = await makeGroup({ slot: "saturday-morning" });
    const m = await candidate("Evenings", { meeting_times: ["weeknight-evening"] });
    let r = (await owner("desk_person_lead_options", m.id)) as Row;
    expect((r.rows as Row[]).map((x) => x.group_id)).toEqual([evening.id]);
    const other = await candidate("Other");
    await owner("desk_offer_send", evening.id, [other.id]);
    r = (await owner("desk_person_lead_options", m.id)) as Row;
    expect(r.rows).toEqual([]);
    expect(String(r.why)).toMatch(/offer is already out|cannot make|meets at a time/i);
    void saturday;
  });

  it("says why when nothing can be offered: no draft at all, or the member is not available to lead", async () => {
    await admin("update public.desk_groups set status = 'archived' where status = 'draft'");
    const m = await candidate("Nobody");
    const none = (await owner("desk_person_lead_options", m.id)) as Row;
    expect(none.rows).toEqual([]);
    expect(String(none.why)).toMatch(/no draft group/i);
    await makeGroup();
    const unwilling = await candidate("Unwilling", { open_to_serving: "not_now" });
    const r = (await owner("desk_person_lead_options", unwilling.id)) as Row;
    expect(r.rows).toEqual([]);
    expect(String(r.why)).toMatch(/open to serving/i);
    await expectCode(owner("desk_person_lead_options", NOBODY), "P0002");
  });

  it("sends through the one function the group's card uses, so the limits, Rehearsal and one-offer-at-a-time all hold", async () => {
    await admin("update public.desk_groups set status = 'archived' where status = 'draft'");
    const g = await makeGroup();
    const m = await candidate("Sent");
    const r = (await owner("desk_person_lead_options", m.id)) as Row;
    expect((r.rows as Row[]).map((x) => x.group_id)).toEqual([g.id]);
    expect(await owner("desk_offer_send", g.id, [m.id])).toMatchObject({ ok: true, status: "open", people: 1 });
    expect((await offerOf(g.id, m.id)).status).toBe("open");
    // a second offer on the same group is turned away, exactly as it is from the card
    const other = await candidate("Second");
    await expectCode(owner("desk_offer_send", g.id, [other.id]), "22023");
    const again = (await owner("desk_person_lead_options", other.id)) as Row;
    expect(again.rows).toEqual([]);
  });
});
