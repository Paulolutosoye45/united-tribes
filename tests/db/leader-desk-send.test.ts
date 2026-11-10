import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { readyMember } from "./placement-kit";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// The Leader Desk, Phase 2a: emailing a proposed group, checking interest, and the member's one-tap answer. What these prove:
//   * it is the owner's alone, and closed until the Switchboard opens it; its helpers are closed to every signed-in person, and the private page needs the
//     sending token as well as the link;
//   * Rehearsal writes down who would be emailed and sends nothing; On queues one plain email, email only, at a sensible hour, with no number in it;
//   * it never writes to someone it must not (under 18, a deletion request, a care follow-up, a bounced or opted-out address, a person who pressed Stop), and
//     it keeps to its limits (one in 7 days, three in a season, so many a day), each limit counted apart for Rehearsal and for real sends;
//   * every answer is one press on the private page: yes is counted, no and a different time take the member off the draft and leave them waiting, stop ends
//     all Desk email, silence places nobody, and opening a link changes nothing;
//   * the Desk places nobody and changes no member, seat or tribe.

let c: Cast;
let n = 0;
let token: string;
const REASON = "Trying the Desk emails with real people";

const owner = (fn: string, ...args: unknown[]) => c.o.call(fn, ...args);
const admin = (text: string, params: unknown[] = []) => c.sql(text, params);
const lagosHour = async (h: number | null) => {
  await admin(
    h === null
      ? "create or replace function public.lagos_hour() returns integer language sql stable set search_path to '' as $f$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer; $f$"
      : `create or replace function public.lagos_hour() returns integer language sql stable set search_path to '' as $f$ select ${h}; $f$`,
  );
};

async function only(...tribes: Parameters<Cast["k"]["tribe"]>[1][]) {
  await admin("update public.tribes set status = 'closed' where status = 'approved'");
  const made = [];
  for (const t of tribes) made.push(await c.k.tribe(c.season, { name: `Send tribe ${++n}`, ...t }));
  return made;
}
async function waiting(name: string, o: Parameters<typeof readyMember>[4] = {}) {
  return readyMember(c.db, c.k, c.season, `${name}${++n}`, { daysAgo: 5, ...o });
}
const GROUP = { name: "Wednesday night builders", slot: "weeknight-evening", mode: "in_person", zone: "mainland", type: "mixed", capacity: 8 };
async function makeGroup() {
  const track = await c.k.lookup("tracks", "builders");
  const community = await c.k.lookup("communities", "professionals");
  const goal = await c.k.goalOf("professionals");
  return (await owner("desk_group_save", null, `${GROUP.name} ${++n}`, track, community, goal, GROUP.slot, GROUP.mode, GROUP.zone, GROUP.type, GROUP.capacity, null)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const rowsFor = (id: string) => admin("select * from public.desk_proposals where person_id = $1 order by created_at", [id]);
const mailsFor = (id: string) => admin("select * from public.messages where person_id = $1 and template in ('desk_proposal', 'desk_interest') order by created_at", [id]);
const linkOf = async (proposal: string) => (await admin("select reply_token from public.messages where dedupe_key = $1", [`desk:${proposal}`]))[0]?.reply_token as string;
const counts = async () => (await admin(`select (select count(*)::int from public.tribe_members) as seats, (select count(*)::int from public.tribes) as tribes,
                                                (select count(*)::int from public.member_profiles) as profiles, (select count(*)::int from public.notice_items) as notices`))[0];
const setMode = (mode: "off" | "rehearsal" | "on") => c.set("leader_desk", mode, { reason: REASON });
/** What is left of some JSON once the ids in it are taken out, so a long run of digits in it could only be a number someone could ring. */
const bare = (v: unknown) => JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "");
const info = (link: string) => c.anon("worker_desk_info", token, link);
const answer = (link: string, a: string, slots: string[] = []) => c.anon("worker_desk_answer", token, link, a, slots);

beforeAll(async () => {
  c = await makeCast();
  await c.k.moveSeason(c.season, 3);
  await setMode("rehearsal");
  token = (await c.one("select public.bootstrap_worker_token('desk-send-test') as t")).t as string;
  await lagosHour(11);
}, 240_000);

afterAll(async () => {
  await c?.db.close();
});

describe("who may use it", () => {
  const CALLS: [string, unknown[]][] = [
    ["desk_send_state", []],
    ["desk_settings_set", [40, 7, 3, 48, "A reason"]],
    ["desk_propose_preview", [NOBODY]],
    ["desk_propose_tribe", [NOBODY, null]],
    ["desk_interest_check", [NOBODY]],
    ["desk_group_interest", [NOBODY]],
    ["desk_proposals_list", [null, 10, 0]],
    ["desk_proposal_cancel", [NOBODY]],
  ];

  it("is the owner's alone: an admin, a director, the pastor and a member are turned away, and so is a visitor", async () => {
    const m = await waiting("Plain");
    for (const who of [c.admin, c.director, c.pastor, m.id, c.member]) {
      for (const [fn, args] of CALLS) await expectCode(c.as(who, fn, ...args), "42501");
    }
    for (const [fn, args] of CALLS) await expectCode(c.anon(fn, ...args), "42501");
  });

  it("keeps its helpers closed to every signed-in person, the owner included", async () => {
    const helpers: [string, unknown[]][] = [
      ["desk_mail_state", [NOBODY]],
      ["desk_mail_block", [NOBODY]],
      ["desk_mail_cap", [NOBODY, false]],
      ["desk_send_at", []],
      ["desk_tribe_pick", [NOBODY]],
      ["desk_tribe_params", [NOBODY, NOBODY]],
      ["desk_interest_params", [NOBODY, NOBODY]],
      ["desk_link_mint", [NOBODY, NOBODY, 3]],
      ["desk_link_proposal", ["x"]],
      ["desk_mail_send", ["tribe", NOBODY, NOBODY, null, 80, "{}", null]],
      ["desk_tick", []],
    ];
    for (const [fn, args] of helpers) {
      await expectCode(c.o.run((q) => q(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args)), "42501");
    }
  });

  it("is closed when the Switchboard has it Off, and nothing is written", async () => {
    await setMode("off");
    const m = await waiting("Closed");
    await only({});
    for (const [fn, args] of CALLS) await expectCode(owner(fn, ...args), "42501");
    expect(await rowsFor(m.id)).toEqual([]);
    await setMode("rehearsal");
  });

  it("gives the private page nothing without the sending token, and nothing to a signed-in person", async () => {
    const bad = "not-a-token-not-a-token-not-a-token-0000";
    const link = "a".repeat(64);
    await expectCode(c.anon("worker_desk_info", bad, link), "42501");
    await expectCode(c.anon("worker_desk_answer", bad, link, "stop", []), "42501");
    await expectCode(c.anon("worker_desk_tick", bad), "42501");
    for (const who of [c.admin, c.member, c.o.owner.id]) {
      await expectCode(c.as(who, "worker_desk_info", token, link), "42501");
      await expectCode(c.as(who, "worker_desk_tick", token), "42501");
    }
    expect(await info(link)).toEqual({ found: false });
    expect(await info("short")).toEqual({ found: false });
    expect(await answer(link, "stop")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("Rehearsal: it writes down what it would send and sends nothing", () => {
  it("a proposed group is only written down: no message, no link, no change to the member", async () => {
    await setMode("rehearsal");
    const [T] = await only({ name: "Rehearsal tribe" });
    const m = await waiting("Rehearse");
    const before = await counts();
    const preview = await owner("desk_propose_preview", m.id);
    expect(preview.ok).toBe(true);
    expect(preview.tribe_id).toBe(T.tribe);
    expect(preview.mode).toBe("rehearsal");
    const made = await owner("desk_propose_tribe", m.id, null);
    expect(made.status).toBe("would_send");
    expect(made.tribe).toBe("Rehearsal tribe");
    const rows = await rowsFor(m.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "tribe", rehearsal: true, status: "would_send", message_id: null });
    expect(await mailsFor(m.id)).toEqual([]);
    expect((await admin("select count(*)::int n from public.desk_links where proposal_id = $1", [rows[0].id]))[0].n).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it("an interest check on a draft is only written down, for every member who can be asked", async () => {
    await only({});
    const g = await makeGroup();
    const a = await waiting("RehA");
    const b = await waiting("RehB");
    await owner("desk_group_member_add", g.id, a.id);
    await owner("desk_group_member_add", g.id, b.id);
    const r = await owner("desk_interest_check", g.id);
    expect(r).toMatchObject({ sent: 0, would_send: 2, skipped: {} });
    for (const p of [a, b]) {
      expect(await mailsFor(p.id)).toEqual([]);
      expect((await rowsFor(p.id))[0]).toMatchObject({ kind: "interest", rehearsal: true, status: "would_send" });
    }
    // Asking again does not ask twice
    expect(await owner("desk_interest_check", g.id)).toMatchObject({ sent: 0, would_send: 0, skipped: { already: 2 } });
    const view = await owner("desk_group_interest", g.id);
    expect(view.members.map((x: { state: string }) => x.state)).toEqual(["would_ask", "would_ask"]);
  });

  it("counts a Rehearsal apart from a real send, so trying it out never uses up a member's real allowance", async () => {
    await only({});
    const m = await waiting("Apart");
    await owner("desk_propose_tribe", m.id, null);
    await expect(owner("desk_propose_tribe", m.id, null)).rejects.toThrow(/already had a Desk email/);
    await setMode("on");
    const real = await owner("desk_propose_tribe", m.id, null);
    expect(real.status).toBe("sent");
    expect(await mailsFor(m.id)).toHaveLength(1);
    await setMode("rehearsal");
  });
});

describe("On: one plain email, email only", () => {
  it("queues one 'Tribe proposed' email with the tribe's details, the fit and reasons about the goal, place and time only, and no number", async () => {
    await setMode("on");
    const [T] = await only({ name: "Sent tribe" });
    const m = await waiting("Sent", { whatsapp: "+2348031924657" });
    const made = await owner("desk_propose_tribe", m.id, null);
    expect(made.status).toBe("sent");
    const mails = await mailsFor(m.id);
    expect(mails).toHaveLength(1);
    const mail = mails[0];
    expect(mail).toMatchObject({ template: "desk_proposal", force_channel: "email", tribe_id: T.tribe, status: "queued" });
    expect(mail.dedupe_key).toBe(`desk:${made.id}`);
    expect(mail.reply_token).toMatch(/^[a-f0-9]{64}$/);
    const p = mail.params as Record<string, unknown>;
    expect(p).toMatchObject({ kind: "tribe", tribe: "Sent tribe", stop: true });
    expect(typeof p.leader_first).toBe("string");
    expect(p.seats_left as number).toBeGreaterThan(0);
    expect(p.degree as number).toBeGreaterThanOrEqual(60);
    for (const k of (p.reasons as string[])) expect(["goal_same", "goal_family", "community_same", "place_online", "place_same", "place_near", "rhythm_fit"]).toContain(k);
    expect(JSON.stringify(mail.params)).not.toMatch(/[0-9]{8,}/);
    // The raw link is in the message only; the table keeps its hash
    const stored = await admin("select token_hash from public.desk_links where proposal_id = $1", [made.id]);
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).not.toBe(mail.reply_token);
    expect(stored[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("queues one 'Interest check' email for each member of a draft, with no leader and no name but the member's own", async () => {
    await only({});
    const g = await makeGroup();
    const a = await waiting("IntA");
    const b = await waiting("IntB");
    await owner("desk_group_member_add", g.id, a.id);
    await owner("desk_group_member_add", g.id, b.id);
    const r = await owner("desk_interest_check", g.id);
    expect(r).toMatchObject({ sent: 2, would_send: 0 });
    for (const p of [a, b]) {
      const [mail] = await mailsFor(p.id);
      expect(mail).toMatchObject({ template: "desk_interest", force_channel: "email", status: "queued" });
      const params = mail.params as Record<string, unknown>;
      expect(params).toMatchObject({ kind: "interest", slot: GROUP.slot, mode: GROUP.mode, zone: GROUP.zone, capacity: GROUP.capacity });
      expect(params).not.toHaveProperty("leader_first");
      expect(JSON.stringify(params)).not.toMatch(/[0-9]{8,}/);
    }
    const names = [(await mailsFor(a.id))[0].params.first, (await mailsFor(b.id))[0].params.first];
    expect(JSON.stringify((await mailsFor(a.id))[0].params)).not.toContain(String(names[1]));
  });

  it("holds an email asked for outside 9 am to 7 pm until 9 am in Lagos", async () => {
    await only({});
    const [night, early, day] = [await waiting("Night"), await waiting("Early"), await waiting("Day")];
    await lagosHour(22);
    await owner("desk_propose_tribe", night.id, null);
    await lagosHour(5);
    await owner("desk_propose_tribe", early.id, null);
    await lagosHour(11);
    await owner("desk_propose_tribe", day.id, null);
    await lagosHour(11);
    const at = async (id: string) => (await admin("select scheduled_for at, (scheduled_for at time zone 'Africa/Lagos')::time as lagos from public.messages where person_id = $1 and template = 'desk_proposal'", [id]))[0];
    const [a, b, d] = [await at(night.id), await at(early.id), await at(day.id)];
    expect(String(a.lagos)).toBe("09:00:00");
    expect(String(b.lagos)).toBe("09:00:00");
    expect(new Date(a.at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(b.at).getTime()).toBeGreaterThan(Date.now() - 24 * 3600 * 1000);
    expect(new Date(d.at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("is stopped by the Master pause: nothing is queued", async () => {
    await only({});
    const m = await waiting("Paused");
    await admin("update public.feature_master set paused = true");
    await expect(owner("desk_propose_tribe", m.id, null)).rejects.toThrow(/\S/);
    await admin("update public.feature_master set paused = false");
    expect(await rowsFor(m.id)).toEqual([]);
  });
});

describe("whom it will not write to, and how often", () => {
  it("refuses a member who is not waiting, a tribe that does not fit, and a member with no tribe that fits", async () => {
    await setMode("on");
    await only({});
    const seated = await c.k.seat((await only({}))[0].tribe, c.season, "Seated2");
    await expect(owner("desk_propose_tribe", seated.id, null)).rejects.toThrow(/no longer waiting/);
    const m = await waiting("Fits2");
    const [T] = await only({});
    await admin("update public.tribes set status = 'closed' where id = $1", [T.tribe]);
    await expect(owner("desk_propose_tribe", m.id, null)).rejects.toThrow(/No open tribe fits/);
    expect((await owner("desk_propose_preview", m.id)).code).toBe("no_tribe");
    await expect(owner("desk_propose_tribe", m.id, NOBODY)).rejects.toThrow(/\S/);
    expect(await rowsFor(m.id)).toEqual([]);
  });

  it("never writes to a deletion request, an open care follow-up, a bounced or opted-out address, or a person who stopped announcements", async () => {
    await only({});
    const cases: [string, (id: string) => Promise<unknown>, RegExp][] = [
      ["Deleting", (id) => admin("insert into public.erasure_requests (person_id, centre_id, status, by_office) values ($1, $2, 'open', false)", [id, c.k.centreId]), /deleted|no longer waiting/],
      ["Caring", async (id) => admin("insert into public.care_flags (tribe_id, person_id, kind) values ($1, $2, 'leader_concern')", [(await c.k.tribe(c.season, { name: `Care tribe ${++n}` })).tribe, id]), /care follow-up/],
      ["Bounced", (id) => admin("insert into public.email_signals (person_id, kind) values ($1, 'hard_bounce'), ($1, 'hard_bounce')", [id]), /not arriving/],
    ];
    for (const [name, make, words] of cases) {
      const m = await waiting(name);
      await make(m.id);
      await expect(owner("desk_propose_tribe", m.id, null)).rejects.toThrow(words);
      expect(await rowsFor(m.id)).toEqual([]);
      expect(await mailsFor(m.id)).toEqual([]);
    }
  });

  it("leaves out of an interest check the member it must not write to, and counts why", async () => {
    await only({});
    const g = await makeGroup();
    const ok = await waiting("Ask");
    const bounced = await waiting("Bounce");
    await owner("desk_group_member_add", g.id, ok.id);
    await owner("desk_group_member_add", g.id, bounced.id);
    await admin("insert into public.email_signals (person_id, kind) values ($1, 'hard_bounce'), ($1, 'hard_bounce')", [bounced.id]);
    const r = await owner("desk_interest_check", g.id);
    expect(r).toMatchObject({ sent: 1, would_send: 0, skipped: { bounced: 1 } });
    expect(await mailsFor(bounced.id)).toEqual([]);
    expect(await mailsFor(ok.id)).toHaveLength(1);
  });

  it("keeps to one email in a gap and a few in a season, and to so many a day", async () => {
    await only({});
    const m = await waiting("Capped");
    await owner("desk_propose_tribe", m.id, null);
    await expect(owner("desk_propose_tribe", m.id, null)).rejects.toThrow(/already had a Desk email/);
    // Three in the season, a week apart, and the fourth is refused
    for (let i = 0; i < 2; i++) {
      await admin("update public.desk_proposals set created_at = created_at - interval '8 days' where person_id = $1", [m.id]);
      await owner("desk_propose_tribe", m.id, null);
    }
    await admin("update public.desk_proposals set created_at = created_at - interval '8 days' where person_id = $1", [m.id]);
    await expect(owner("desk_propose_tribe", m.id, null)).rejects.toThrow(/most Desk emails allowed this season/);
    expect(await mailsFor(m.id)).toHaveLength(3);

    const state = await owner("desk_send_state");
    const other = await waiting("Daily");
    await owner("desk_settings_set", state.sent_today, 7, 3, 48, "Testing the daily limit");
    await expect(owner("desk_propose_tribe", other.id, null)).rejects.toThrow(/limit of emails for today/);
    await owner("desk_settings_set", 40, 7, 3, 48, "Back to the usual limits");
    await owner("desk_propose_tribe", other.id, null);
  });
});

describe("the settings card", () => {
  it("shows the numbers and today's count, and changes them only with a reason, within range", async () => {
    const s = await owner("desk_send_state");
    expect(s).toMatchObject({ daily_cap: 40, gap_days: 7, season_cap: 3, interest_hours: 48, mode: expect.stringMatching(/on|rehearsal/), paused: false });
    await expect(owner("desk_settings_set", 0, 7, 3, 48, "Reason")).rejects.toThrow(/between 1 and 300/);
    await expect(owner("desk_settings_set", 40, 0, 3, 48, "Reason")).rejects.toThrow(/between 1 and 60/);
    await expect(owner("desk_settings_set", 40, 7, 11, 48, "Reason")).rejects.toThrow(/between 1 and 10/);
    await expect(owner("desk_settings_set", 40, 7, 3, 5, "Reason")).rejects.toThrow(/between 12 and 240/);
    await expect(owner("desk_settings_set", 40, 7, 3, 48, "  ")).rejects.toThrow(/Say why/);
    await expect(owner("desk_settings_set", 40, 7, 3, 48, "x".repeat(301))).rejects.toThrow(/Say why/);
    const secret = "Because the pastors asked for a slower start";
    const after = await owner("desk_settings_set", 25, 10, 2, 72, secret);
    expect(after).toMatchObject({ daily_cap: 25, gap_days: 10, season_cap: 2, interest_hours: 72 });
    const log = await admin("select meta from public.event_log where action = 'desk.settings' order by id desc limit 1");
    expect(JSON.stringify(log[0].meta)).not.toContain("pastors");
    expect((await admin("select reason from public.desk_settings"))[0].reason).toBe(secret);
    await owner("desk_settings_set", 40, 7, 3, 48, "Back to the usual limits");
  });
});

describe("the member's answer on the private page", () => {
  async function asked(kind: "tribe" | "interest", name = "Answers") {
    await setMode("on");
    await only({});
    const m = await waiting(name);
    if (kind === "tribe") {
      const made = await owner("desk_propose_tribe", m.id, null);
      return { m, id: made.id as string, link: await linkOf(made.id), group: null as null | string };
    }
    const g = await makeGroup();
    await owner("desk_group_member_add", g.id, m.id);
    await owner("desk_interest_check", g.id);
    const id = (await rowsFor(m.id))[0].id as string;
    return { m, id, link: await linkOf(id), group: g.id as string };
  }

  it("shows the page what it needs, and opening it saves nothing but that it was opened", async () => {
    const a = await asked("tribe");
    const before = (await rowsFor(a.m.id))[0];
    const shown = await info(a.link);
    expect(shown).toMatchObject({ found: true, kind: "tribe", open: true, answered: false, stopped: false });
    expect(shown.details).toMatchObject({ kind: "tribe" });
    expect(JSON.stringify(shown)).not.toMatch(/[0-9]{8,}/);
    await info(a.link);
    expect((await rowsFor(a.m.id))[0]).toMatchObject({ status: before.status, answer: null });
    expect((await admin("select clicks from public.desk_links where proposal_id = $1", [a.id]))[0].clicks).toBe(2);
    const i = await asked("interest", "ShowInt");
    const shownInt = await info(i.link);
    expect(shownInt).toMatchObject({ found: true, kind: "interest", open: true });
    expect(shownInt.details).not.toHaveProperty("leader_first");
  });

  it("'Yes, count me in' is counted on the draft", async () => {
    const a = await asked("interest", "Yes");
    expect(await answer(a.link, "yes")).toMatchObject({ ok: true, answer: "yes" });
    const view = await owner("desk_group_interest", a.group);
    expect(view.members).toEqual([{ person_id: a.m.id, state: "yes" }]);
    expect(await answer(a.link, "yes")).toMatchObject({ ok: true, again: true });
    expect(await answer(a.link, "no")).toMatchObject({ ok: true, answer: "yes", again: true });
    expect((await admin("select count(*)::int n from public.desk_group_members where group_id = $1", [a.group]))[0].n).toBe(1);
  });

  it("'Not for me' takes the member off the draft and leaves them waiting", async () => {
    const a = await asked("interest", "No");
    expect(await answer(a.link, "no")).toMatchObject({ ok: true, answer: "no" });
    expect((await admin("select count(*)::int n from public.desk_group_members where group_id = $1 and person_id = $2", [a.group, a.m.id]))[0].n).toBe(0);
    const view = await owner("desk_group_interest", a.group);
    expect(view.members).toEqual([]);
    expect(view.left).toMatchObject([{ person_id: a.m.id, answer: "no" }]);
    const ids = (await owner("desk_waiting", null, 100, 0)).rows.map((r: { person_id: string }) => r.person_id);
    expect(ids).toContain(a.m.id);
    expect((await admin("select count(*)::int n from public.tribe_members where person_id = $1", [a.m.id]))[0].n).toBe(0);
  });

  it("'A different time' keeps the times asked for, takes the member off the draft, and needs at least one real time", async () => {
    const a = await asked("interest", "Other");
    await expectCode(answer(a.link, "other_time", []), "22023");
    await expectCode(answer(a.link, "other_time", ["midnight"]), "22023");
    await expectCode(answer(a.link, "yes", ["sunday-evening"]), "22023");
    expect(await answer(a.link, "other_time", ["sunday-evening", "saturday-morning"])).toMatchObject({ ok: true, answer: "other_time" });
    expect((await rowsFor(a.m.id))[0].slots).toEqual(["sunday-evening", "saturday-morning"]);
    const view = await owner("desk_group_interest", a.group);
    expect(view.left).toMatchObject([{ person_id: a.m.id, answer: "other_time", slots: ["sunday-evening", "saturday-morning"] }]);
    expect(view.members).toEqual([]);
  });

  it("on a proposed tribe the only answers are 'Not for me' and stop: a 'yes' here is the normal Tribes page", async () => {
    const a = await asked("tribe", "TribeAns");
    await expectCode(answer(a.link, "yes"), "22023");
    await expectCode(answer(a.link, "other_time", ["sunday-evening"]), "22023");
    await expectCode(answer(a.link, "maybe"), "22023");
    expect(await answer(a.link, "no")).toMatchObject({ ok: true, answer: "no" });
    expect((await rowsFor(a.m.id))[0]).toMatchObject({ status: "answered", answer: "no" });
    expect((await admin("select count(*)::int n from public.tribe_members where person_id = $1", [a.m.id]))[0].n).toBe(0);
  });

  it("'Stop these' ends all Desk email to the member, and withdraws what is still queued", async () => {
    const a = await asked("tribe", "Stopper");
    const other = await waiting("Stopper2");
    const g = await makeGroup();
    await owner("desk_group_member_add", g.id, a.m.id);
    expect(await answer(a.link, "stop")).toMatchObject({ ok: true, answer: "stop" });
    expect((await admin("select count(*)::int n from public.desk_stops where person_id = $1", [a.m.id]))[0].n).toBe(1);
    expect(await info(a.link)).toMatchObject({ found: true, stopped: true, open: false });
    await expect(owner("desk_propose_tribe", a.m.id, null)).rejects.toThrow(/asked the Desk to stop/);
    expect(await owner("desk_interest_check", g.id)).toMatchObject({ sent: 0, skipped: { stopped: 1 } });
    expect(await answer(a.link, "stop")).toMatchObject({ ok: true });
    expect(other.id).toBeTruthy();
  });

  it("a link that has run out still lets 'Stop these' through, and refuses every other answer", async () => {
    const a = await asked("interest", "Late");
    await admin("update public.desk_proposals set expires_at = now() - interval '1 hour' where id = $1", [a.id]);
    expect(await info(a.link)).toMatchObject({ found: true, open: false });
    expect(await answer(a.link, "yes")).toEqual({ ok: false, reason: "closed" });
    expect(await answer(a.link, "stop")).toMatchObject({ ok: true, answer: "stop" });
    await admin("update public.desk_links set expires_at = now() - interval '1 hour' where proposal_id = $1", [a.id]);
    expect(await info(a.link)).toEqual({ found: false });
    expect(await answer(a.link, "stop")).toEqual({ ok: false, reason: "invalid" });
  });

  it("is closed to a member the Desk must not write to: under 18 or a deletion request gets no page", async () => {
    const a = await asked("tribe", "Erasing");
    await admin("insert into public.erasure_requests (person_id, centre_id, status, by_office) values ($1, $2, 'open', false)", [a.m.id, c.k.centreId]);
    expect(await info(a.link)).toEqual({ found: false });
    expect(await answer(a.link, "no")).toEqual({ ok: false, reason: "not_available" });
  });

  it("is closed when the switch is no longer On for the member, and a Rehearsal never makes a link", async () => {
    const a = await asked("tribe", "SwitchOff");
    await setMode("rehearsal");
    expect(await info(a.link)).toMatchObject({ found: true, open: false });
    expect(await answer(a.link, "no")).toEqual({ ok: false, reason: "off" });
    await setMode("on");
    expect(await answer(a.link, "no")).toMatchObject({ ok: true });
  });

  it("is withdrawn by the owner: the page closes and the queued email is not sent", async () => {
    const a = await asked("tribe", "Withdrawn");
    await owner("desk_proposal_cancel", a.id);
    expect((await rowsFor(a.m.id))[0].status).toBe("cancelled");
    expect((await mailsFor(a.m.id))[0]).toMatchObject({ status: "skipped", reply_token: null });
    expect(await info(a.link)).toEqual({ found: false });
    await expect(owner("desk_proposal_cancel", a.id)).rejects.toThrow(/already been answered or has run out/);
  });
});

describe("silence places nobody", () => {
  it("an email with no answer in time runs out, the member stays waiting, nobody is placed, and the finished link is wiped", async () => {
    await setMode("on");
    await only({});
    const g = await makeGroup();
    const m = await waiting("Silent");
    await owner("desk_group_member_add", g.id, m.id);
    await owner("desk_interest_check", g.id);
    const id = (await rowsFor(m.id))[0].id as string;
    await admin("update public.messages set status = 'sent', sent_at = now() - interval '2 hours' where dedupe_key = $1", [`desk:${id}`]);
    await admin("update public.desk_proposals set expires_at = now() - interval '1 minute' where id = $1", [id]);
    const ran = await c.anon("worker_desk_tick", token);
    expect(ran.expired).toBeGreaterThanOrEqual(1);
    expect(ran.cleared).toBeGreaterThanOrEqual(1);
    expect((await rowsFor(m.id))[0]).toMatchObject({ status: "expired", answer: null });
    expect((await admin("select reply_token from public.messages where dedupe_key = $1", [`desk:${id}`]))[0].reply_token).toBeNull();
    expect((await owner("desk_group_interest", g.id)).members).toEqual([{ person_id: m.id, state: "expired" }]);
    expect((await admin("select count(*)::int n from public.tribe_members where person_id = $1", [m.id]))[0].n).toBe(0);
    const ids = (await owner("desk_waiting", null, 100, 0)).rows.map((r: { person_id: string }) => r.person_id);
    expect(ids).toContain(m.id);
  });
});

describe("the list of what was sent", () => {
  it("shows each email with the member's name, what it was about, how it ended and when, and never a number", async () => {
    const list = await owner("desk_proposals_list", null, 100, 0);
    expect(list.total).toBeGreaterThan(5);
    expect(list.counts).toMatchObject({ yes: expect.any(Number), no: expect.any(Number), other_time: expect.any(Number), stop: expect.any(Number) });
    expect(list.counts.yes).toBeGreaterThanOrEqual(1);
    expect(list.counts.other_time).toBeGreaterThanOrEqual(1);
    const row = list.rows[0];
    expect(row).toEqual(expect.objectContaining({ id: expect.any(String), kind: expect.any(String), name: expect.any(String), status: expect.any(String), rehearsal: expect.any(Boolean) }));
    expect(bare(list)).not.toMatch(/\+?[0-9]{9,}/);
    const tribes = await owner("desk_proposals_list", "tribe", 100, 0);
    expect(tribes.rows.every((r: { kind: string }) => r.kind === "tribe")).toBe(true);
    await expect(owner("desk_proposals_list", "nonsense", 10, 0)).rejects.toThrow(/not a kind/);
    expect((await owner("desk_proposals_list", null, 3, 0)).rows).toHaveLength(3);
  });

  it("writes an event for what it did, and no event holds a number or a free-text reason", async () => {
    const events = await admin("select action, meta from public.event_log where action like 'desk.%' or action like 'leader_desk.%'");
    const actions = new Set(events.map((e) => e.action as string));
    for (const a of ["desk.proposal", "desk.answer", "desk.stop", "desk.settings", "desk.cancelled"]) expect(actions.has(a), a).toBe(true);
    expect(bare(events)).not.toMatch(/\+?[0-9]{9,}/);
    expect(JSON.stringify(events)).not.toMatch(/Testing the daily limit|Back to the usual limits|pastors asked/);
  });
});

describe("what it never does", () => {
  it("places nobody and changes no member, seat, tribe or notice, and sends nothing on WhatsApp", async () => {
    await setMode("on");
    await only({});
    const g = await makeGroup();
    const ms = [await waiting("Never1"), await waiting("Never2")];
    for (const m of ms) await owner("desk_group_member_add", g.id, m.id);
    const third = await waiting("Never3");
    const before = await counts();
    await owner("desk_interest_check", g.id);
    await owner("desk_propose_tribe", third.id, null);
    expect(await counts()).toEqual(before);
    const odd = await admin("select count(*)::int n from public.messages where template in ('desk_proposal', 'desk_interest') and (force_channel is distinct from 'email' or to_phone is not null)");
    expect(odd[0].n).toBe(0);
    expect((await admin("select count(*)::int n from public.messages where template in ('desk_proposal', 'desk_interest') and params::text ~ '[0-9]{9,}'"))[0].n).toBe(0);
  });
});
