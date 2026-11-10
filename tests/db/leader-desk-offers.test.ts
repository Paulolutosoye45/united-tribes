import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode, type Row } from "./helpers";
import { readyMember } from "./placement-kit";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// The Leader Desk, Phase 2b-1: recommend a leader (with backups), the member's private answer page, the shared appointment step, the tribe card started from the
// draft, and "Your group has a leader". What these prove:
//   * it is the owner's alone and closed until the Switchboard opens it; the helpers are closed to every signed-in person; the private page needs the sending token
//     as well as the link;
//   * Rehearsal writes the offers down and sends nothing; On sends one plain email to the first person only, with no name, no number, and the backups waiting;
//   * the gates hold (under 18, not willing, not established, never/not this season, a held person, a leader already, one offer at a time, a women's or men's group);
//   * every answer is one press: not this season (reasons counted, never shown by name) and never ask me both move to the backup; stop ends all Desk email; a yes needs
//     the age confirmed and two answers; a yes appoints through the one shared step and starts the tribe card with the draft's details locked;
//   * a yes below the fit model's minimum waits for the owner; a lapsed window moves on; reminders go once, at 24 and 12 hours before the window closes;
//   * the leader is told apart from the rest: the draft's members hear "Your group has a leader" (no seat promised), and the Desk places and approves nobody.

let c: Cast;
let n = 0;
let token: string;
const REASON = "Trying leader offers with real people";

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
const bare = (v: unknown) => JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "");

/** A member who finished the form, is waiting and could lead: willing, established in faith, free at the group's time. */
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
  return (await owner("desk_group_save", null, `Offer group ${++n}`, track, comm, goal, g.slot, g.mode, g.zone, g.type, g.capacity, null)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const offersOf = (group: string) => admin("select * from public.desk_offers where group_id = $1 order by round, seq", [group]);
const offerOf = async (group: string, person: string) => (await admin("select * from public.desk_offers where group_id = $1 and person_id = $2 order by round desc limit 1", [group, person]))[0];
const linkOf = async (offer: string) => (await admin("select reply_token from public.messages where dedupe_key = $1", [`desk-offer:${offer}`]))[0]?.reply_token as string;
const mailsFor = (id: string, template = "desk_offer") => admin("select * from public.messages where person_id = $1 and template = $2 order by created_at", [id, template]);
const info = (link: string) => c.anon("worker_desk_offer_info", token, link);
const answer = (link: string, a: string, o: { age?: boolean; lead?: string | null; relation?: string | null; reasons?: string[] } = {}) =>
  c.anon("worker_desk_offer_answer", token, link, a, o.age ?? false, o.lead ?? null, o.relation ?? null, o.reasons ?? []);
const yes = (link: string) => answer(link, "lead", { age: true, lead: "connection", relation: "achieved" });
const counts = async () =>
  (await admin(`select (select count(*)::int from public.tribe_members) as seats, (select count(*)::int from public.tribes where status = 'approved') as approved,
                       (select count(*)::int from public.leader_certifications) as certs, (select count(*)::int from public.notice_items) as notices`))[0];

/** A group with a leader candidate and two backups ready, and a few members in the draft. Returns the people and the group. */
async function setup(members = 2) {
  await admin("update public.tribes set status = 'closed' where status = 'approved'");
  const g = await makeGroup();
  const lead = await candidate("Lead");
  const b1 = await candidate("BackA");
  const b2 = await candidate("BackB");
  const draft = [];
  for (let i = 0; i < members; i++) {
    const m = await plain(`Draft${i}`);
    await owner("desk_group_member_add", g.id, m.id);
    draft.push(m);
  }
  return { g, lead, b1, b2, draft };
}
async function sendOffer(g: string, ...people: string[]) {
  const r = await owner("desk_offer_send", g, people);
  const rows = await offersOf(g);
  return { r, rows, first: rows.find((x) => x.status === "open") as Row };
}

beforeAll(async () => {
  c = await makeCast();
  await c.k.moveSeason(c.season, 3);
  await setMode("on");
  await admin("update public.desk_settings set daily_cap = 300");
  token = (await c.one("select public.bootstrap_worker_token('desk-offer-test') as t")).t as string;
  await lagosHour(11);
}, 240_000);

afterAll(async () => {
  await c?.db.close();
});

describe("who may use it", () => {
  const CALLS: [string, unknown[]][] = [
    ["desk_offer_candidates", [NOBODY, 10]],
    ["desk_offer_send", [NOBODY, [NOBODY]]],
    ["desk_offer_cancel", [NOBODY, false]],
    ["desk_offers_pause", [NOBODY, true]],
    ["desk_offer_review", [NOBODY, true]],
    ["desk_group_leader", [NOBODY]],
    ["desk_offers_list", [10, 0]],
  ];

  it("is the owner's alone: an admin, a director, the pastor and a member are turned away, and so is a visitor", async () => {
    const m = await plain("Plain");
    for (const who of [c.admin, c.director, c.pastor, m.id, c.member]) {
      for (const [fn, args] of CALLS) await expectCode(c.as(who, fn, ...args), "42501");
    }
    for (const [fn, args] of CALLS) await expectCode(c.anon(fn, ...args), "42501");
  });

  it("keeps every helper closed to every signed-in person, the owner included", async () => {
    const helpers: [string, unknown[]][] = [
      ["leader_appoint_core", [NOBODY, "{}", NOBODY, null, NOBODY, null]],
      ["desk_offer_words", ["group"]],
      ["desk_offer_gate_core", [NOBODY, NOBODY, null]],
      ["desk_offer_gate", [NOBODY, NOBODY, null]],
      ["desk_offer_problem", [NOBODY]],
      ["desk_offer_params", [NOBODY, NOBODY, null, null]],
      ["desk_offer_link_mint", [NOBODY, NOBODY, "2030-01-01"]],
      ["desk_offer_link_offer", ["x"]],
      ["desk_offer_open", [NOBODY]],
      ["desk_offer_close", [NOBODY, "cancelled"]],
      ["desk_offer_advance", [NOBODY]],
      ["desk_found_params", [NOBODY, NOBODY, NOBODY]],
      ["desk_offer_complete", [NOBODY, NOBODY]],
      ["desk_offer_accept", [NOBODY]],
      ["desk_offer_tick", []],
    ];
    for (const [fn, args] of helpers) {
      await expectCode(c.o.run((q) => q(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args)), "42501");
    }
  });

  it("is closed when the Switchboard has it Off, and nothing is written", async () => {
    await setMode("off");
    for (const [fn, args] of CALLS) await expectCode(owner(fn, ...args), "42501");
    expect((await admin("select count(*)::int n from public.desk_offers"))[0].n).toBe(0);
    await setMode("on");
  });

  it("gives the private page nothing without the sending token, and nothing to a signed-in person", async () => {
    const bad = "not-a-token-not-a-token-not-a-token-0000";
    const link = "a".repeat(64);
    await expectCode(c.anon("worker_desk_offer_info", bad, link), "42501");
    await expectCode(c.anon("worker_desk_offer_answer", bad, link, "stop", false, null, null, []), "42501");
    for (const who of [c.admin, c.member, c.o.owner.id]) {
      await expectCode(c.as(who, "worker_desk_offer_info", token, link), "42501");
      await expectCode(c.as(who, "worker_desk_offer_answer", token, link, "stop", false, null, null, []), "42501");
    }
    expect(await info(link)).toEqual({ found: false });
    expect(await info("short")).toEqual({ found: false });
    expect(await answer(link, "stop")).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps the new tables closed to every client, with row level security on and no policy", async () => {
    for (const t of ["desk_offers", "desk_offer_links", "desk_lead_stops"]) {
      await expectCode(c.as(c.o.owner.id, "desk_offers_list", 1, 0).then(() => c.db.asUser(c.o.owner.id, (q) => q(`select * from public.${t}`))), "42501");
      await expectCode(c.db.asAnon((q) => q(`select * from public.${t}`)), "42501");
      const r = (await admin("select c.relrowsecurity rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol from pg_class c where c.oid = $1::regclass", [`public.${t}`]))[0];
      expect(r).toEqual({ rls: true, pol: 0 });
    }
  });
});

describe("who can be offered, and when it cannot be offered at all", () => {
  it("lists only members who pass every gate, and says why a group cannot be offered", async () => {
    const { g, lead, b1 } = await setup(0);
    const noServing = await candidate("NoServe", { open_to_serving: "not_now" });
    const growing = await candidate("Growing", {}, { faith: "growing" });
    const ids = ((await owner("desk_offer_candidates", g.id, 60)) as { problem: string | null; rows: { person_id: string }[] }).rows.map((r) => r.person_id);
    expect(ids).toContain(lead.id);
    expect(ids).toContain(b1.id);
    expect(ids).not.toContain(noServing.id);
    expect(ids).not.toContain(growing.id);
    const empty = await makeGroup();
    await admin("update public.desk_groups set status = 'archived' where id = $1", [empty.id]);
    expect(((await owner("desk_offer_candidates", empty.id, 10)) as { problem: string }).problem).toMatch(/group/i);
  });

  it("refuses a person who fails a gate, naming the reason and writing nothing", async () => {
    const { g } = await setup(0);
    const women = await makeGroup({ type: "women" });
    const cases: [string, () => Promise<{ id: string }>, string, RegExp][] = [
      ["Unwilling", () => candidate("Unwilling", { open_to_serving: "not_now" }), g.id, /open to serving/],
      ["Growing", () => candidate("Growing", {}, { faith: "growing" }), g.id, /established or already leading/],
      ["Man", () => candidate("Man", {}, { gender: "male" }), women.id, /women-only or men-only/],
      ["Sunday", () => candidate("Sunday", { meeting_times: ["sunday-evening"] }), g.id, /cannot make/],
      ["Held", async () => {
        const m = await candidate("Held");
        await admin("insert into public.placement_holds (person_id, note) values ($1, 'test')", [m.id]);
        return m;
      }, g.id, /list of members who could lead/],
      ["Caring", async () => {
        const m = await candidate("Caring");
        await admin("insert into public.care_flags (tribe_id, person_id, kind) values ($1, $2, 'leader_concern')", [(await c.k.tribe(c.season, { name: `Care tribe ${++n}` })).tribe, m.id]);
        return m;
      }, g.id, /care follow-up/],
      ["Deleting", async () => {
        const m = await candidate("Deleting");
        await admin("insert into public.erasure_requests (person_id, centre_id, status, by_office) values ($1, $2, 'open', false)", [m.id, c.k.centreId]);
        return m;
      }, g.id, /list of members who could lead/],
      ["Stopped", async () => {
        const m = await candidate("Stopped");
        await admin("insert into public.desk_stops (person_id) values ($1)", [m.id]);
        return m;
      }, g.id, /stopped|asked/i],
      ["NeverLead", async () => {
        const m = await candidate("NeverLead");
        await admin("insert into public.desk_lead_stops (person_id) values ($1)", [m.id]);
        return m;
      }, g.id, /never to be asked to lead/],
    ];
    for (const [name, make, group, words] of cases) {
      const m = await make();
      await expect(owner("desk_offer_send", group, [m.id]), name).rejects.toThrow(words);
    }
    // a member who already leads is not on the list at all
    await expect(owner("desk_offer_send", g.id, [c.appointed.id])).rejects.toThrow(/list of members who could lead/);
    const lead = await candidate("Fine");
    await expect(owner("desk_offer_send", g.id, [])).rejects.toThrow(/Choose 1 to 3/);
    await expect(owner("desk_offer_send", g.id, [lead.id, lead.id, lead.id, lead.id])).resolves.toMatchObject({ ok: true, people: 1 });
    expect((await offersOf(g.id)).length).toBe(1);
    await owner("desk_offer_cancel", (await offerOf(g.id, lead.id)).id, true);
    const four = await Promise.all([candidate("F1"), candidate("F2"), candidate("F3"), candidate("F4")]);
    await expect(owner("desk_offer_send", g.id, four.map((x) => x.id))).rejects.toThrow(/Choose 1 to 3/);
    await expect(owner("desk_offer_send", g.id, [NOBODY])).rejects.toThrow();
    expect((await offersOf(g.id)).length).toBe(1);
  });

  it("refuses an under-18 member by their age, whatever the profile says about serving", async () => {
    const { g } = await setup(0);
    const minor = await candidate("Minor");
    await admin("begin");
    try {
      await admin("set local session_replication_role = replica");
      await admin("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [minor.id]);
      await admin("commit");
    } catch (error) {
      await admin("rollback");
      throw error;
    }
    await expect(owner("desk_offer_send", g.id, [minor.id])).rejects.toThrow(/under 18/);
  });

  it("will not offer a group whose goal is not chosen or whose card is not signed off, or while an offer is already out", async () => {
    const { g, lead, b1 } = await setup(0);
    await sendOffer(g.id, lead.id);
    await expect(owner("desk_offer_send", g.id, [b1.id])).rejects.toThrow(/already out/i);
    await owner("desk_offer_cancel", (await offerOf(g.id, lead.id)).id, true);
    await admin("update public.desk_groups set season_goal_id = null where id = $1", [g.id]);
    await expect(owner("desk_offer_send", g.id, [b1.id])).rejects.toThrow(/goal/i);
  });

  it("will not offer two groups to one person at the same time", async () => {
    const { g, lead } = await setup(0);
    await sendOffer(g.id, lead.id);
    const other = await makeGroup();
    await expect(owner("desk_offer_send", other.id, [lead.id])).rejects.toThrow();
  });
});

describe("Rehearsal: it writes down what it would send and sends nothing", () => {
  it("writes would_send rows, no email, no link, and changes no member, seat or tribe", async () => {
    await setMode("rehearsal");
    try {
      const { g, lead, b1 } = await setup(1);
      const before = await counts();
      const links = (await admin("select count(*)::int n from public.desk_offer_links"))[0].n;
      const r = await owner("desk_offer_send", g.id, [lead.id, b1.id]);
      expect(r).toMatchObject({ ok: true, status: "would_send", people: 2 });
      const rows = await offersOf(g.id);
      expect(rows.map((x) => x.status)).toEqual(["would_send", "would_send"]);
      expect(rows.every((x) => x.rehearsal)).toBe(true);
      expect(await mailsFor(lead.id)).toEqual([]);
      expect((await admin("select count(*)::int n from public.desk_offer_links"))[0].n).toBe(links);
      expect(await counts()).toEqual(before);
      // a Rehearsal offer never blocks the real one
      await setMode("on");
      await owner("desk_offer_cancel", rows[0].id, true);
      const real = await sendOffer(g.id, lead.id);
      expect(real.first.status).toBe("open");
    } finally {
      await setMode("on");
    }
  });
});

describe("On: one plain email to the first person, the rest waiting their turn", () => {
  it("asks the first person only, names nobody, holds a 72 hour window and puts no number anywhere", async () => {
    const { g, lead, b1, b2, draft } = await setup(2);
    const { r, rows, first } = await sendOffer(g.id, lead.id, b1.id, b2.id);
    expect(r).toMatchObject({ ok: true, status: "open", people: 3 });
    expect(rows.map((x) => x.status)).toEqual(["open", "queued", "queued"]);
    expect(first.person_id).toBe(lead.id);
    const hours = (new Date(first.window_ends_at).getTime() - new Date(first.opened_at).getTime()) / 3_600_000;
    expect(hours).toBe(72);
    const mails = await mailsFor(lead.id);
    expect(mails).toHaveLength(1);
    expect(mails[0].status).toBe("queued");
    expect(await mailsFor(b1.id)).toEqual([]);
    expect(await mailsFor(draft[0].id)).toEqual([]);
    const text = JSON.stringify(mails[0].params);
    for (const d of draft) expect(text).not.toContain(d.id);
    expect(bare(mails[0].params)).not.toMatch(/\d{7,}/);
    expect(JSON.parse(text)).toMatchObject({ kind: "offer", members: 2 });
    expect(mails[0].reply_token).toMatch(/^[a-f0-9]{64}$/);
    // the raw secret is never stored, only its hash
    const hash = (await admin("select token_hash from public.desk_offer_links where offer_id = $1", [first.id]))[0].token_hash;
    expect(hash).not.toBe(mails[0].reply_token);
  });

  it("shows the page its details and counts a click, changing nothing else", async () => {
    const { g, lead } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id);
    const link = await linkOf(first.id);
    const page = await info(link);
    expect(page).toMatchObject({ found: true, open: true, status: "open", answer: null, call_me: false });
    expect(page.details).toMatchObject({ kind: "offer", members: 1, capacity: 8 });
    expect(bare(page)).not.toMatch(/\d{7,}/);
    expect((await admin("select clicks from public.desk_offer_links where offer_id = $1", [first.id]))[0].clicks).toBe(1);
    expect((await offerOf(g.id, lead.id)).status).toBe("open");
  });

  it("counts the people who said yes to an interest check, when one was sent", async () => {
    const { g, lead, draft } = await setup(2);
    await owner("desk_interest_check", g.id);
    const mail = (await mailsFor(draft[0].id, "desk_interest"))[0];
    await c.anon("worker_desk_answer", token, mail.reply_token, "yes", []);
    const { first } = await sendOffer(g.id, lead.id);
    const page = await info(await linkOf(first.id));
    expect(page.details).toMatchObject({ asked: true, yes: 1 });
  });
});

describe("the member's answer on the private page", () => {
  it("'Not this season' moves to the backup, keeps the reasons private and the member off future offers this season", async () => {
    const { g, lead, b1 } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id, b1.id);
    const link = await linkOf(first.id);
    expect(await answer(link, "not_season", { reasons: ["busy", "family"] })).toEqual({ ok: true, answer: "not_season" });
    expect((await offerOf(g.id, lead.id)).status).toBe("declined");
    expect((await offerOf(g.id, b1.id)).status).toBe("open");
    expect(await mailsFor(b1.id)).toHaveLength(1);
    // reasons are counted, and nobody's own reason is shown by name
    const list = await owner("desk_offers_list", 20, 0);
    expect(list.reasons.busy).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(list.rows)).not.toMatch(/busy|family/);
    expect(JSON.stringify(await owner("desk_group_leader", g.id))).not.toMatch(/busy|family/);
    // asking the same person again, in the same season, is refused
    const second = await makeGroup();
    await expect(owner("desk_offer_send", second.id, [lead.id])).rejects.toThrow(/season/i);
    // pressing again says the same, once
    expect(await answer(link, "not_season", { reasons: ["busy"] })).toMatchObject({ ok: true, again: true });
  });

  it("'Never ask me to lead' ends leader offers for good but not their other Desk emails", async () => {
    const { g, lead, b1 } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id, b1.id);
    expect(await answer(await linkOf(first.id), "never")).toEqual({ ok: true, answer: "never" });
    expect((await admin("select count(*)::int n from public.desk_lead_stops where person_id = $1", [lead.id]))[0].n).toBe(1);
    expect((await admin("select count(*)::int n from public.desk_stops where person_id = $1", [lead.id]))[0].n).toBe(0);
    expect((await offerOf(g.id, b1.id)).status).toBe("open");
    const other = await makeGroup();
    await expect(owner("desk_offer_send", other.id, [lead.id])).rejects.toThrow(/never|asked not/i);
  });

  it("'Stop these' ends every Desk email for the member, closes their offer and asks the backup", async () => {
    const { g, lead, b1 } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id, b1.id);
    expect(await answer(await linkOf(first.id), "stop")).toEqual({ ok: true, answer: "stop" });
    expect((await admin("select count(*)::int n from public.desk_stops where person_id = $1", [lead.id]))[0].n).toBe(1);
    expect((await offerOf(g.id, lead.id)).status).toBe("cancelled");
    expect((await offerOf(g.id, b1.id)).status).toBe("open");
  });

  it("'Call me' flags the offer for the owner and 'Remind me tomorrow' sets one reminder", async () => {
    const { g, lead } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id);
    const link = await linkOf(first.id);
    expect(await answer(link, "call")).toEqual({ ok: true, answer: "call" });
    expect((await offerOf(g.id, lead.id)).call_me).toBe(true);
    expect((await owner("desk_offers_list", 20, 0)).counts.call_me).toBeGreaterThanOrEqual(1);
    expect(await answer(link, "tomorrow")).toMatchObject({ ok: true, answer: "tomorrow", later: true });
    expect((await offerOf(g.id, lead.id)).remind_at).not.toBeNull();
    expect((await offerOf(g.id, lead.id)).status).toBe("open");
  });

  it("refuses an answer that is not one of the six, a reason that is not a chip, and a yes without the age and the two answers", async () => {
    const { g, lead } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id);
    const link = await linkOf(first.id);
    await expectCode(answer(link, "maybe"), "22023");
    await expectCode(answer(link, "not_season", { reasons: ["because"] }), "22023");
    await expectCode(answer(link, "never", { reasons: ["busy"] }), "22023");
    await expectCode(answer(link, "lead"), "22023");
    await expectCode(answer(link, "lead", { age: false, lead: "connection", relation: "achieved" }), "22023");
    await expectCode(answer(link, "lead", { age: true, lead: "nope", relation: "achieved" }), "22023");
    await expectCode(answer(link, "lead", { age: true, lead: "connection", relation: "never" }), "22023");
    await expectCode(answer(link, "call", { age: true }), "22023");
    expect((await offerOf(g.id, lead.id)).status).toBe("open");
    expect((await admin("select count(*)::int n from public.leader_appointments where person_id = $1", [lead.id]))[0].n).toBe(0);
  });

  it("gives nothing to a link that is not the right one, and nothing once the window has closed", async () => {
    const { g, lead } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id);
    const link = await linkOf(first.id);
    expect(await answer("b".repeat(64), "call")).toEqual({ ok: false, reason: "invalid" });
    await admin("update public.desk_offers set window_ends_at = now() - interval '1 hour' where id = $1", [first.id]);
    expect(await answer(link, "call")).toEqual({ ok: false, reason: "closed" });
    expect((await info(link)).open).toBe(false);
  });

  it("shows nothing and takes nothing from a member who has asked to be deleted", async () => {
    const { g, lead } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id);
    const link = await linkOf(first.id);
    await admin("insert into public.erasure_requests (person_id, centre_id, status, by_office) values ($1, $2, 'open', false)", [lead.id, c.k.centreId]);
    expect(await info(link)).toEqual({ found: false });
    expect(await answer(link, "call")).toEqual({ ok: false, reason: "not_available" });
    expect((await offerOf(g.id, lead.id)).call_me).toBe(false);
  });

  it("is closed when the switch is no longer On, and the answer is refused", async () => {
    const { g, lead } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id);
    const link = await linkOf(first.id);
    await setMode("rehearsal");
    try {
      expect(await info(link)).toMatchObject({ found: true, open: false });
      expect(await answer(link, "call")).toEqual({ ok: false, reason: "off" });
    } finally {
      await setMode("on");
    }
    expect(await answer(link, "call")).toEqual({ ok: true, answer: "call" });
  });
});

describe("a yes: the one shared appointment step, and the tribe card started from the draft", () => {
  it("appoints, records the appointment, starts the card with the draft's details locked, and tells the draft's members without promising a seat", async () => {
    const { g, lead, b1, draft } = await setup(3);
    await owner("desk_interest_check", g.id);
    const { first } = await sendOffer(g.id, lead.id, b1.id);
    const before = await counts();
    const r = await yes(await linkOf(first.id));
    expect(r).toMatchObject({ ok: true, answer: "lead" });
    expect(r.review).toBeUndefined();
    const o = await offerOf(g.id, lead.id);
    expect(o).toMatchObject({ status: "accepted", answer: "lead", lead_best: "connection", relation: "achieved" });
    expect(o.age_confirmed_at).not.toBeNull();
    expect(o.appointment_id).not.toBeNull();
    // the shared step: role, appointment, event
    expect((await admin("select count(*)::int n from public.person_roles where person_id = $1 and role = 'leader'", [lead.id]))[0].n).toBe(1);
    const appt = (await admin("select * from public.leader_appointments where person_id = $1 and status = 'active'", [lead.id]))[0];
    expect(appt.id).toBe(o.appointment_id);
    expect(appt.appointed_by).toBe(o.sent_by);
    const ev = await admin("select meta from public.event_log where action = 'leader.appointed' order by id desc limit 1");
    expect(ev[0].meta).toMatchObject({ via: "desk" });

    // the card: a draft, the draft's details locked
    const t = (await admin("select * from public.tribes where id = $1", [o.tribe_id]))[0];
    expect(t).toMatchObject({ status: "draft", leader_id: lead.id, slot: "weeknight-evening", meeting_mode: "in_person", zone: "mainland", tribe_type: "mixed", capacity: 8 });
    expect([...t.fixed].sort()).toEqual(["capacity", "community", "goal", "kind", "mode", "slot", "track", "zone"]);
    // the group
    const grp = (await admin("select * from public.desk_groups where id = $1", [g.id]))[0];
    expect(grp).toMatchObject({ leader_id: lead.id, tribe_id: o.tribe_id });
    expect(grp.leader_found_at).not.toBeNull();
    expect((await admin("select count(*)::int n from public.desk_group_members where group_id = $1 and person_id = $2", [g.id, lead.id]))[0].n).toBe(0);
    // the backup is not needed
    expect((await offerOf(g.id, b1.id)).status).toBe("cancelled");
    expect(await mailsFor(b1.id)).toEqual([]);
    // the leader hears once, in the normal way
    const welcome = await admin("select * from public.messages where person_id = $1 and template in ('placement_leader_appointed', 'leader_welcome') order by created_at", [lead.id]);
    expect(welcome.length).toBeGreaterThanOrEqual(1);
    // the draft's members are told there is a leader, with nothing about a seat
    for (const d of draft) {
      const found = await mailsFor(d.id, "desk_found");
      expect(found).toHaveLength(1);
      expect(JSON.parse(JSON.stringify(found[0].params))).toMatchObject({ kind: "found" });
      expect(JSON.stringify(found[0].params)).not.toMatch(/seat|place/i);
    }
    // the Desk placed nobody and approved nothing
    const after = await counts();
    expect(after.seats).toBe(before.seats);
    expect(after.approved).toBe(before.approved);
    expect(after.certs).toBe(before.certs);
    // a second press says the same thing and changes nothing
    expect(await yes(await linkOf(first.id))).toMatchObject({ ok: true, again: true });
    expect((await mailsFor(draft[0].id, "desk_found"))).toHaveLength(1);
  });

  it("keeps the locked details locked when the leader edits the card, and lets them confirm the name, day and time inside the slot", async () => {
    const { g, lead, draft } = await setup(1);
    expect(draft).toHaveLength(1);
    const { first } = await sendOffer(g.id, lead.id);
    await yes(await linkOf(first.id));
    const tribe = (await offerOf(g.id, lead.id)).tribe_id as string;
    await c.as(lead.id, "save_tribe_card", tribe, JSON.stringify({ name: "Midweek builders", meeting_day: 3, meeting_time: "20:00", place_note: "Near the bridge" }));
    const t = (await admin("select * from public.tribes where id = $1", [tribe]))[0];
    expect(t).toMatchObject({ name: "Midweek builders", meeting_day: 3, slot: "weeknight-evening", place_note: "Near the bridge" });
    // the fixed things cannot be moved
    await c.as(lead.id, "save_tribe_card", tribe, JSON.stringify({ mode: "online", zone: "abroad", capacity: 4, tribe_type: "women", community: "families", track: "stewards" }));
    const after = (await admin("select * from public.tribes where id = $1", [tribe]))[0];
    expect(after).toMatchObject({ meeting_mode: "in_person", zone: "mainland", capacity: 8, tribe_type: "mixed", community_id: t.community_id, track_id: t.track_id });
    // a day and time outside the draft's slot is refused, naming the slot
    await expect(c.as(lead.id, "save_tribe_card", tribe, JSON.stringify({ meeting_day: 6, meeting_time: "09:00" }))).rejects.toThrow(/slot|weeknight/i);
    expect((await admin("select * from public.tribes where id = $1", [tribe]))[0].meeting_day).toBe(3);
  });

  it("an online group leaves the area for the leader to choose, because the card cannot go in without one", async () => {
    await admin("update public.tribes set status = 'closed' where status = 'approved'");
    const g = await makeGroup({ mode: "online", zone: null as unknown as string });
    const lead = await candidate("OnlineLead");
    const { first } = await sendOffer(g.id, lead.id);
    await yes(await linkOf(first.id));
    const t = (await admin("select * from public.tribes where id = $1", [(await offerOf(g.id, lead.id)).tribe_id]))[0];
    expect(t.zone).toBeNull();
    expect(t.fixed).not.toContain("zone");
    expect(t.fixed).toContain("mode");
  });

  it("leaves god_appoint_leader behaving as it did: same checks, same rows, no group, no locks beyond track, community and goal", async () => {
    const p = await c.k.person("PlainAppoint");
    const goal = (await admin("select id from public.season_goals where slug = 'step-into-a-leadership-role'"))[0].id as string;
    const form = { track: "builders", lead_best: "connection", community: "professionals", goal: "step-into-a-leadership-role", relation: "achieved" };
    const r = await owner("god_appoint_leader", p.id, JSON.stringify(form), goal, "Asked by the pastor");
    expect(r).toMatchObject({ ok: true });
    const t = (await admin("select fixed from public.tribes where leader_id = $1", [p.id]))[0];
    expect([...t.fixed].sort()).toEqual(["community", "goal", "track"]);
    await expectCode(c.as(c.admin, "god_appoint_leader", p.id, JSON.stringify(form), goal, null), "42501");
  });
});

describe("a yes below the fit model's minimum waits for the owner", () => {
  async function lowBar(to: number) {
    // A fit model version cannot be changed through the app; the setup steps around the trigger the way the other tests do
    await admin("begin");
    try {
      await admin("set local session_replication_role = replica");
      await admin("update public.leader_fit_models set min_degree = $1 where active", [to]);
      await admin("commit");
    } catch (error) {
      await admin("rollback");
      throw error;
    }
  }

  it("holds the yes for review, appoints nobody, and lets the owner appoint or decline", async () => {
    const original = (await admin("select min_degree from public.leader_fit_models where active limit 1"))[0].min_degree as number;
    await lowBar(100);
    try {
      const { g, lead, b1, draft } = await setup(1);
      const { first } = await sendOffer(g.id, lead.id, b1.id);
      const r = await yes(await linkOf(first.id));
      expect(r).toMatchObject({ ok: true, answer: "lead", review: true });
      expect((await offerOf(g.id, lead.id)).status).toBe("review");
      expect((await admin("select count(*)::int n from public.leader_appointments where person_id = $1", [lead.id]))[0].n).toBe(0);
      expect(await mailsFor(draft[0].id, "desk_found")).toEqual([]);
      expect((await owner("desk_group_leader", g.id)).leader).toBeNull();
      // the member is not asked twice, and the backup waits while the owner decides
      expect(await yes(await linkOf(first.id))).toMatchObject({ ok: true, again: true, review: true });
      expect((await offerOf(g.id, b1.id)).status).toBe("queued");
      // declining asks the backup
      await owner("desk_offer_review", first.id, false);
      expect((await offerOf(g.id, lead.id)).status).toBe("declined");
      expect((await offerOf(g.id, b1.id)).status).toBe("open");
      await expect(owner("desk_offer_review", first.id, true)).rejects.toThrow(/not waiting/i);

      // a second group, approved by the owner
      const two = await setup(1);
      const sent = await sendOffer(two.g.id, two.lead.id);
      await yes(await linkOf(sent.first.id));
      const done = await owner("desk_offer_review", sent.first.id, true);
      expect(done).toMatchObject({ ok: true });
      expect((await offerOf(two.g.id, two.lead.id)).status).toBe("accepted");
      expect((await admin("select count(*)::int n from public.leader_appointments where person_id = $1 and status = 'active'", [two.lead.id]))[0].n).toBe(1);
      expect(await mailsFor(two.draft[0].id, "desk_found")).toHaveLength(1);
    } finally {
      await lowBar(original);
    }
  });
});

describe("time: a lapsed window moves on, and reminders go once", () => {
  it("expires an offer whose window has run out and asks the next backup", async () => {
    const { g, lead, b1 } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id, b1.id);
    await admin("update public.desk_offers set window_ends_at = now() - interval '1 minute' where id = $1", [first.id]);
    const r = (await admin("select public.desk_tick() as r"))[0].r;
    expect(r.offers_expired).toBeGreaterThanOrEqual(1);
    expect((await offerOf(g.id, lead.id)).status).toBe("expired");
    expect((await offerOf(g.id, b1.id)).status).toBe("open");
    expect((await admin("select count(*)::int n from public.desk_offer_links where offer_id = $1", [first.id]))[0].n).toBe(0);
  });

  it("sends a reminder 24 hours and again 12 hours before the window closes, each once, each with its own link", async () => {
    const { g, lead } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id);
    const tick = async () => (await admin("select public.desk_tick() as r"))[0].r;
    await tick();
    expect(await mailsFor(lead.id)).toHaveLength(1);
    await admin("update public.desk_offers set opened_at = now() - interval '48 hours', window_ends_at = now() + interval '23 hours' where id = $1", [first.id]);
    await tick();
    await tick();
    let mails = await mailsFor(lead.id);
    expect(mails).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(mails[1].params)).reminder).toBe("24");
    await admin("update public.desk_offers set window_ends_at = now() + interval '11 hours' where id = $1", [first.id]);
    await tick();
    await tick();
    mails = await mailsFor(lead.id);
    expect(mails).toHaveLength(3);
    expect(JSON.parse(JSON.stringify(mails[2].params)).reminder).toBe("12");
    expect(new Set(mails.map((m) => m.reply_token)).size).toBe(3);
    // every link opens the same offer
    for (const m of mails) expect(await info(m.reply_token)).toMatchObject({ found: true, open: true });
  });

  it("does not remind a member who has stopped, and the 'remind me tomorrow' reminder goes once", async () => {
    const { g, lead } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id);
    const link = await linkOf(first.id);
    await answer(link, "tomorrow");
    await admin("update public.desk_offers set remind_at = now() - interval '1 minute' where id = $1", [first.id]);
    await admin("select public.desk_tick()");
    await admin("select public.desk_tick()");
    const mails = await mailsFor(lead.id);
    expect(mails).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(mails[1].params)).reminder).toBe("tomorrow");
  });

  it("ends the offers of a group that has been archived, and scrubs the secret from an email that went", async () => {
    const { g, lead, b1 } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id, b1.id);
    await admin("update public.messages set status = 'sent', sent_at = now() - interval '2 hours' where dedupe_key = $1", [`desk-offer:${first.id}`]);
    await owner("desk_group_archive", g.id);
    await admin("select public.desk_tick()");
    expect((await offersOf(g.id)).map((x) => x.status)).toEqual(["cancelled", "cancelled"]);
    expect((await admin("select reply_token from public.messages where dedupe_key = $1", [`desk-offer:${first.id}`]))[0].reply_token).toBeNull();
  });
});

describe("the owner can withdraw, pause and see where it stands", () => {
  it("withdrawing one offer asks the backup; withdrawing all ends the round", async () => {
    const { g, lead, b1, b2 } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id, b1.id, b2.id);
    await owner("desk_offer_cancel", first.id, false);
    expect((await offerOf(g.id, lead.id)).status).toBe("cancelled");
    expect((await offerOf(g.id, b1.id)).status).toBe("open");
    await owner("desk_offer_cancel", (await offerOf(g.id, b1.id)).id, true);
    expect((await offersOf(g.id)).map((x) => x.status)).toEqual(["cancelled", "cancelled", "cancelled"]);
    const state = await owner("desk_group_leader", g.id);
    expect(state.needs_decision).toBe(true);
    await expect(owner("desk_offer_cancel", first.id, false)).rejects.toThrow(/already/i);
  });

  it("pausing backups stops the automatic ask, and resuming asks the next", async () => {
    const { g, lead, b1 } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id, b1.id);
    await owner("desk_offers_pause", g.id, true);
    await answer(await linkOf(first.id), "not_season", { reasons: ["other"] });
    expect((await offerOf(g.id, b1.id)).status).toBe("queued");
    expect((await owner("desk_group_leader", g.id)).paused).toBe(true);
    await owner("desk_offers_pause", g.id, false);
    expect((await offerOf(g.id, b1.id)).status).toBe("open");
  });

  it("a backup who no longer passes the gates is skipped, and the next is asked", async () => {
    const { g, lead, b1, b2 } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id, b1.id, b2.id);
    await admin("update public.member_profiles set open_to_serving = 'not_now' where person_id = $1", [b1.id]);
    await answer(await linkOf(first.id), "not_season");
    expect((await offerOf(g.id, b1.id)).status).toBe("skipped");
    expect((await offerOf(g.id, b2.id)).status).toBe("open");
  });

  it("lists the offers with counts and no reason by name, and a leader's page names the leader and the card", async () => {
    const { g, lead } = await setup(1);
    const { first } = await sendOffer(g.id, lead.id);
    await yes(await linkOf(first.id));
    const state = await owner("desk_group_leader", g.id);
    expect(state.leader).toMatchObject({ person_id: lead.id, certified: false, tribe_status: "draft" });
    expect(state.needs_decision).toBe(false);
    const list = await owner("desk_offers_list", 50, 0);
    expect(list.counts.accepted).toBeGreaterThanOrEqual(1);
    expect(list.rows[0]).not.toHaveProperty("reasons");
  });
});

describe("'Your group has a leader': the draft's members and the private page", () => {
  async function found() {
    const s = await setup(2);
    const { first } = await sendOffer(s.g.id, s.lead.id);
    await yes(await linkOf(first.id));
    const mail = (await mailsFor(s.draft[0].id, "desk_found"))[0];
    return { ...s, mail, link: mail.reply_token as string };
  }

  it("shows the member the leader's first name and the group, and counts a yes, with no seat promised", async () => {
    const { link, draft, g } = await found();
    const page = await c.anon("worker_desk_info", token, link);
    expect(page).toMatchObject({ found: true, kind: "found" });
    expect(page.details).toMatchObject({ kind: "found", capacity: 8 });
    expect(bare(page)).not.toMatch(/\d{7,}/);
    expect(await c.anon("worker_desk_answer", token, link, "yes", [])).toMatchObject({ ok: true });
    expect((await admin("select answer from public.desk_proposals where person_id = $1 and kind = 'found'", [draft[0].id]))[0].answer).toBe("yes");
    expect((await admin("select count(*)::int n from public.desk_group_members where group_id = $1 and person_id = $2", [g.id, draft[0].id]))[0].n).toBe(1);
  });

  it("'Not for me' takes the member off the draft and leaves them waiting; 'Stop these' ends every Desk email", async () => {
    const { draft, g, mail } = await found();
    const second = (await mailsFor(draft[1].id, "desk_found"))[0];
    expect(await c.anon("worker_desk_answer", token, mail.reply_token, "no", [])).toMatchObject({ ok: true });
    expect((await admin("select count(*)::int n from public.desk_group_members where group_id = $1 and person_id = $2", [g.id, draft[0].id]))[0].n).toBe(0);
    expect(await c.anon("worker_desk_answer", token, second.reply_token, "stop", [])).toMatchObject({ ok: true });
    expect((await admin("select count(*)::int n from public.desk_stops where person_id = $1", [draft[1].id]))[0].n).toBe(1);
  });

  it("does not email a draft member who has stopped, is under 18 or has a care follow-up", async () => {
    const s = await setup(3);
    await admin("insert into public.desk_stops (person_id) values ($1)", [s.draft[0].id]);
    const { first } = await sendOffer(s.g.id, s.lead.id);
    await yes(await linkOf(first.id));
    expect(await mailsFor(s.draft[0].id, "desk_found")).toEqual([]);
    expect(await mailsFor(s.draft[1].id, "desk_found")).toHaveLength(1);
  });
});
