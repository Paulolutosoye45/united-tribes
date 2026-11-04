import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// Leader cards (fix 5, fix 4): one board for the office that says, for every leader with a Tribe Card, whether the email arrived, whether they have
// started, and where the card is; a kind way to send it again; reminders on Thursday, Friday and Saturday that start Off; the sheets for the heads of
// department and for the call; and the count for Admin -> Sending and email. What these prove:
//   * the board is for the office: admin, a director and a pastor act, the data lead looks, and a leader, coach, care lead and member are refused
//   * a card is "not started" until the leader has put something on it, then "in progress"; sent in, sent back and approved are told apart
//   * an invitation is "not sent", "sending", "sent" or "failed", the best result of every message that carries the link, and a failure carries
//     the sender's reason; an address is shown only to those who act and only when the email did not arrive
//   * the filters, the department tag and the counts agree with each other
//   * Send again: one leader or everyone whose email did not arrive, never to a leader who has sent their card in, never more than three times
//     to one leader, never twice in a day, and the usual blocks hold
//   * the reminders: Off does nothing; Rehearsal writes down who it would have written to and sends nothing; On sends one email a day to each
//     leader whose card is open, on the chosen days only, inside the send window, and stops when the card goes in or the Master pause is on
//   * the sheets: the one for the heads of department has no number and no address; the call sheet has both, is for those who act, and is logged
//   * the announcement audience counts exactly the leaders whose card is open

let c: Cast;
let dataLead: string;
let coach: string;
let careLead: string;
let n = 0;
let Ben: { id: string; tribe: string };
let Chi: { id: string; tribe: string };
let Dayo: { id: string; tribe: string };

const board = (who: string, ...a: unknown[]) => c.as(who, "leader_cards_board", ...a);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoardRow = Record<string, any>;
const rowOf = (b: { rows: BoardRow[] }, id: string) => b.rows.find((r) => r.person_id === id);
const queue = async (person: string, template: string, status: string, error: string | null = null) => {
  const id = (await c.one("select public.enqueue_message($1, $2, '{}'::jsonb, null, $3, now(), 'normal', 'email') as id", [person, template, `t-${++n}`])).id as string;
  if (status === "sent" || status === "delivered" || status === "read") await c.sql("update public.messages set status = $2, sent_at = now() where id = $1", [id, status]);
  else if (status !== "queued") await c.sql("update public.messages set status = $2, error = $3 where id = $1", [id, status, error]);
  return id;
};
const setCard = (tribe: string, status: string) =>
  c.sql(
    `update public.tribes set status = $2, submitted_at = case when $3::boolean then now() else null end,
            name = coalesce(name, 'Test tribe'), story = case when $3::boolean then coalesce(story, 'We meet to build one another up in the week.') else story end,
            meeting_day = case when $3::boolean then 3 else meeting_day end, meeting_time = case when $3::boolean then time '19:00' else meeting_time end,
            slot = case when $3::boolean then 'weeknight-evening' else slot end, meeting_mode = case when $3::boolean then 'online' else meeting_mode end,
            zone = case when $3::boolean then 'mainland' else zone end,
            loving_god = coalesce(loving_god, 'Loving God line'), loving_others = coalesce(loving_others, 'Loving others line'), loving_life = coalesce(loving_life, 'Loving life line')
      where id = $1`,
    [tribe, status, status === "submitted" || status === "approved"],
  );
const touch = (tribe: string) => c.sql("update public.tribes set story = 'We meet to build one another up in the week.' where id = $1", [tribe]);
const clock = (dow: number, hour: number) =>
  c.db.admin.query(
    `create or replace function public.lagos_hour() returns integer language sql as $$ select ${hour} $$;
     create or replace function public.lagos_dow() returns integer language sql as $$ select ${dow} $$;`,
  );
const unclock = () =>
  c.db.admin.query(
    `create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$;
     create or replace function public.lagos_dow() returns integer language sql stable set search_path = '' as $$ select extract(dow from (now() at time zone 'Africa/Lagos'))::integer $$;`,
  );
const REASON = "Trying the Thursday reminders";
const remindersOn = (mode = "on", days: number[] = [4, 5, 6], hour = 9) => c.as(c.director, "leader_card_reminders_set", mode, days, hour, REASON);
const run = async () => (await c.one("select public.leader_card_reminders_run() as r")).r as { mode: string; queued: number; would_send: number; paused?: boolean };
const cardMail = (person: string) =>
  c.sql("select template, params, force_channel, dedupe_key from public.messages where person_id = $1 and template = 'leader_card_reminder' order by created_at", [person]);

beforeAll(async () => {
  c = await makeCast();
  dataLead = (await c.k.staff("Data lead", "data_lead")).id;
  coach = (await c.k.staff("Coach", "coach")).id;
  careLead = (await c.k.staff("Care lead", "care_lead")).id;
  Ben = await c.appoint("Ben");
  Chi = await c.appoint("Chi");
  Dayo = await c.appoint("Dayo");
}, 180_000);

afterAll(async () => {
  await unclock().catch(() => {});
  await c?.db.close();
});

beforeEach(async () => {
  await unclock();
  await c.reset();
  await c.sql("delete from public.leader_card_log");
  await c.sql("delete from public.leader_departments");
  await c.sql("delete from public.messages");
  await c.sql("delete from public.erasure_requests");
  await c.sql("delete from public.email_signals");
  await c.sql("delete from public.consents where purpose in ('reminders', 'whatsapp')");
  await c.sql("delete from public.contact_preferences");
  await c.sql("update public.leader_card_settings set reminder_mode = 'off', days = array[4, 5, 6]::smallint[], start_hour = 9, max_total = 12");
  for (const t of [c.appointed.tribe, Ben.tribe, Chi.tribe, Dayo.tribe]) {
    await c.sql("update public.tribes set status = 'draft', submitted_at = null, story = null, slot = null, meeting_mode = null, zone = null where id = $1", [t]);
  }
  await c.sql("update public.tribes set status = 'approved' where id = $1", [c.seasoned.tribe]);
});

describe("who may open the board", () => {
  it("lets the admin, a director and a pastor act, lets the data lead look, and turns everyone else away", async () => {
    for (const who of [c.admin, c.director, c.pastor]) expect((await board(who)).role).toBe("act");
    expect((await board(dataLead)).role).toBe("look");
    for (const who of [c.seasoned.id, coach, careLead, c.member]) {
      await expectCode(board(who), "42501");
      await expectCode(c.as(who, "leader_cards_failures"), "42501");
      await expectCode(c.as(who, "leader_cards_sheet", "hod"), "42501");
      await expectCode(c.as(who, "leader_card_reminders_get"), "42501");
    }
    await expectCode(c.anon("leader_cards_board", "unfinished", null, 100, 0), "42501");
  });

  it("lets only those who act send again, tag a department and move the reminders", async () => {
    await expectCode(c.as(dataLead, "leader_cards_resend", Ben.id), "42501");
    await expectCode(c.as(dataLead, "leader_card_department_set", Ben.id, "Ushers"), "42501");
    await expectCode(c.as(dataLead, "leader_card_reminders_set", "rehearsal", [4], 9, REASON), "42501");
    await expectCode(c.as(dataLead, "leader_cards_sheet", "call"), "42501");
    await expectCode(c.as(c.seasoned.id, "leader_cards_resend", Ben.id), "42501");
  });

  it("refuses a filter that is not on the list", async () => {
    await expectCode(board(c.admin, "everything"), "22023");
  });

  it("is not reachable by the public or by a person who is not signed in, and the tables cannot be read directly", async () => {
    for (const t of ["leader_departments", "leader_card_settings", "leader_card_log"]) {
      await expectCode(c.db.asUser(c.admin, (q) => q(`select * from public.${t}`)), "42501");
      await expectCode(c.db.asAnon((q) => q(`select * from public.${t}`)), "42501");
    }
    for (const f of ["leader_card_rows(uuid)", "leader_card_invite_of(uuid)", "leader_card_reminders_run()"]) {
      const r = await c.one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as e, has_function_privilege('anon', 'public.${f}', 'execute') as a`);
      expect(r).toEqual({ e: false, a: false });
    }
    const w = await c.one("select has_function_privilege('anon', 'public.worker_leader_card_reminders(text)', 'execute') as a, has_function_privilege('authenticated', 'public.worker_leader_card_reminders(text)', 'execute') as e");
    expect(w).toEqual({ a: true, e: false });
  });
});

describe("where a card is", () => {
  it("is not started until the leader has put something on it, then in progress", async () => {
    let b = await board(c.admin, "all");
    expect(rowOf(b, Ben.id)).toMatchObject({ state: "not_started", how: "appointed" });
    await touch(Ben.tribe);
    b = await board(c.admin, "all");
    expect(rowOf(b, Ben.id)?.state).toBe("in_progress");
  });

  it("tells sent in, sent back and approved apart, and counts them", async () => {
    await touch(Ben.tribe);
    await setCard(Chi.tribe, "submitted");
    await setCard(Dayo.tribe, "changes_requested");
    const b = await board(c.admin, "all");
    expect(rowOf(b, Chi.id)?.state).toBe("submitted");
    expect(rowOf(b, Dayo.id)?.state).toBe("changes_asked");
    expect(rowOf(b, c.seasoned.id)?.state).toBe("approved");
    expect(b.counts).toMatchObject({ in_progress: 1, submitted: 1, changes_asked: 1, approved: 1, not_started: 1, unfinished: 3, all: 5 });
  });

  it("says how each came: appointed by the office, or approved from an application", async () => {
    const b = await board(c.admin, "all");
    expect(rowOf(b, c.appointed.id)?.how).toBe("appointed");
    expect(rowOf(b, c.seasoned.id)?.how).toBe("applied");
  });

  it("does not list a card that has been closed, or a leader in a season that has closed", async () => {
    await c.sql("update public.tribes set status = 'closed' where id = $1", [Dayo.tribe]);
    expect(rowOf(await board(c.admin, "all"), Dayo.id)).toBeUndefined();
    await c.sql("update public.tribes set status = 'draft' where id = $1", [Dayo.tribe]);
  });

  it("sorts the ones who have not started first", async () => {
    await setCard(Chi.tribe, "submitted");
    await touch(Ben.tribe);
    const b = await board(c.admin, "all");
    expect(b.rows[0].state).toBe("not_started");
    expect(b.rows[b.rows.length - 1].state).toBe("approved");
  });
});

describe("whether the invitation arrived", () => {
  it("is not sent when no message was ever queued", async () => {
    const r = rowOf(await board(c.admin), Ben.id);
    expect(r?.invite).toMatchObject({ state: "not_sent", tries: 0 });
  });

  it("is sending while it waits, sent once any went out, and failed with the reason when none did", async () => {
    await queue(Ben.id, "placement_leader_appointed", "queued");
    expect(rowOf(await board(c.admin), Ben.id)?.invite.state).toBe("sending");
    await queue(Chi.id, "placement_leader_appointed", "failed", "Mailbox is full");
    const chi = rowOf(await board(c.admin), Chi.id);
    expect(chi?.invite).toMatchObject({ state: "failed", reason: "Mailbox is full", tries: 1 });
    await queue(Chi.id, "placement_leader_appointed", "sent");
    expect(rowOf(await board(c.admin), Chi.id)?.invite.state).toBe("sent");
    await queue(Dayo.id, "role_invitation", "skipped", "bounced");
    expect(rowOf(await board(c.admin), Dayo.id)?.invite).toMatchObject({ state: "failed", reason: "bounced" });
  });

  it("counts the approval email and the welcome as carrying the link, and ignores messages that do not", async () => {
    await queue(Ben.id, "application_approved_optional", "delivered");
    expect(rowOf(await board(c.admin), Ben.id)?.invite.state).toBe("sent");
    await queue(Chi.id, "office_message", "sent");
    expect(rowOf(await board(c.admin), Chi.id)?.invite.state).toBe("not_sent");
  });

  it("shows an address only to those who act, and only when the email did not arrive", async () => {
    await queue(Ben.id, "placement_leader_appointed", "sent");
    await queue(Chi.id, "placement_leader_appointed", "failed", "Rejected");
    const act = await board(c.admin, "all");
    expect(rowOf(act, Ben.id)?.email).toBeNull();
    expect(rowOf(act, Chi.id)?.email).toMatch(/@/);
    expect(rowOf(act, Dayo.id)?.email).toMatch(/@/);
    const look = await board(dataLead, "all");
    for (const r of look.rows) {
      expect(r.email).toBeNull();
      expect(r.can_chat).toBeNull();
    }
    expect(JSON.stringify(look)).not.toMatch(/@example|\+234/);
  });

  it("filters to the ones whose email did not arrive, and counts them", async () => {
    await queue(Ben.id, "placement_leader_appointed", "sent");
    await queue(Chi.id, "placement_leader_appointed", "failed", "x");
    const b = await board(c.admin, "email_failed");
    const ids = b.rows.map((r: { person_id: string }) => r.person_id);
    expect(ids).toContain(Chi.id);
    expect(ids).toContain(Dayo.id);
    expect(ids).not.toContain(Ben.id);
    expect(b.counts.email_failed).toBe(b.total);
  });

  it("lists the failures, with the reason, for Admin -> Sending and email, only for leaders whose card is still open", async () => {
    await queue(Chi.id, "placement_leader_appointed", "failed", "Mailbox is full");
    await setCard(Dayo.tribe, "submitted");
    const f = await c.as(c.admin, "leader_cards_failures");
    const names = f.rows.map((r: { person_id: string }) => r.person_id);
    expect(names).toContain(Chi.id);
    expect(names).toContain(Ben.id);
    expect(names).not.toContain(Dayo.id);
    expect(f.rows.find((r: { person_id: string }) => r.person_id === Chi.id)).toMatchObject({ state: "failed", reason: "Mailbox is full" });
    expect(f.count).toBe(f.rows.length);
    expect((await c.as(dataLead, "leader_cards_failures")).count).toBe(f.count);
  });

  it("knows who has signed in", async () => {
    await c.sql("update auth.users set last_sign_in_at = null where id = $1", [Ben.id]);
    await c.sql("update auth.users set last_sign_in_at = now() where id = $1", [Chi.id]);
    const b = await board(c.admin, "all");
    expect(rowOf(b, Ben.id)?.signed_in).toBe(false);
    expect(rowOf(b, Chi.id)?.signed_in).toBe(true);
    const never = (await board(c.admin, "never_signed_in")).rows.map((r: { person_id: string }) => r.person_id);
    expect(never).toContain(Ben.id);
    expect(never).not.toContain(Chi.id);
  });

  it("shows their last action", async () => {
    await c.sql("delete from public.event_log where actor_id = $1", [Ben.id]);
    expect(rowOf(await board(c.admin), Ben.id)?.last_activity).toBeNull();
    await c.sql("insert into public.event_log (actor_id, action, entity) values ($1, 'tribe.viewed', 'tribe')", [Ben.id]);
    expect(rowOf(await board(c.admin), Ben.id)?.last_activity).not.toBeNull();
  });
});

describe("departments", () => {
  it("tags a leader, lists the departments in use, filters by one, and filters by none", async () => {
    await c.as(c.admin, "leader_card_department_set", Ben.id, "  Ushers  ");
    await c.as(c.pastor, "leader_card_department_set", Chi.id, "Media");
    let b = await board(c.admin, "all");
    expect(rowOf(b, Ben.id)?.department).toBe("Ushers");
    expect(b.departments).toEqual(["Media", "Ushers"]);
    b = await board(c.admin, "all", "Ushers");
    expect(b.rows.map((r: { person_id: string }) => r.person_id)).toEqual([Ben.id]);
    b = await board(c.admin, "all", "none");
    expect(b.rows.map((r: { person_id: string }) => r.person_id)).not.toContain(Ben.id);
    expect(b.counts.all).toBe(5);
  });

  it("changes and clears it, and writes it to the log", async () => {
    await c.as(c.admin, "leader_card_department_set", Ben.id, "Ushers");
    await c.as(c.admin, "leader_card_department_set", Ben.id, "Choir");
    expect(rowOf(await board(c.admin, "all"), Ben.id)?.department).toBe("Choir");
    await c.as(c.admin, "leader_card_department_set", Ben.id, "");
    expect(rowOf(await board(c.admin, "all"), Ben.id)?.department).toBeNull();
    expect((await c.one("select count(*)::int n from public.event_log where action = 'leader_cards.department_set'")).n).toBeGreaterThanOrEqual(3);
  });

  it("refuses one character, a very long one, and a person who has no card", async () => {
    await expectCode(c.as(c.admin, "leader_card_department_set", Ben.id, "A"), "22023");
    await expectCode(c.as(c.admin, "leader_card_department_set", Ben.id, "x".repeat(61)), "22023");
    await expectCode(c.as(c.admin, "leader_card_department_set", c.member, "Ushers"), "P0002");
  });
});

describe("send the email again", () => {
  it("queues one email to one leader, email only, with the link wording for how they came, and writes it down", async () => {
    const r = await c.as(c.admin, "leader_cards_resend", Ben.id);
    expect(r).toMatchObject({ ok: true, queued: 1, skipped: [] });
    const m = await cardMail(Ben.id);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ force_channel: "email", params: { kind: "again", how: "appointed", state: "not_started" } });
    expect(m[0].dedupe_key).toMatch(/^leader-card:/);
    expect((await board(c.admin, "all")).rows.find((x: { person_id: string }) => x.person_id === Ben.id).resends).toBe(1);
  });

  it("does not send twice in a day", async () => {
    await c.as(c.admin, "leader_cards_resend", Ben.id);
    const again = await c.as(c.admin, "leader_cards_resend", Ben.id);
    expect(again).toMatchObject({ queued: 0 });
    expect(again.skipped[0]).toMatchObject({ person_id: Ben.id, reason: "already_today" });
    expect(await cardMail(Ben.id)).toHaveLength(1);
  });

  it("stops at three, and counts them across days", async () => {
    for (let i = 0; i < 3; i++) {
      await c.sql("update public.leader_card_log set day = day - 1 where person_id = $1", [Ben.id]);
      await c.sql("delete from public.messages where person_id = $1 and template = 'leader_card_reminder'", [Ben.id]);
      expect(await c.as(c.admin, "leader_cards_resend", Ben.id)).toMatchObject({ queued: 1 });
    }
    await c.sql("update public.leader_card_log set day = day - 1 where person_id = $1", [Ben.id]);
    await c.sql("delete from public.messages where person_id = $1 and template = 'leader_card_reminder'", [Ben.id]);
    const r = await c.as(c.admin, "leader_cards_resend", Ben.id);
    expect(r.queued).toBe(0);
    expect(r.skipped[0].reason).toBe("sent_three_times");
  });

  it("never sends to a leader who has sent their card in or has it approved", async () => {
    await setCard(Chi.tribe, "submitted");
    expect((await c.as(c.admin, "leader_cards_resend", Chi.id)).skipped[0].reason).toBe("card_sent");
    expect((await c.as(c.admin, "leader_cards_resend", c.seasoned.id)).skipped[0].reason).toBe("card_sent");
    expect(await cardMail(Chi.id)).toHaveLength(0);
  });

  it("holds back a leader who cannot be written to, as every other message does", async () => {
    await c.sql("insert into public.email_signals (person_id, kind) values ($1, 'hard_bounce'), ($1, 'hard_bounce')", [Ben.id]);
    const r = await c.as(c.admin, "leader_cards_resend", Ben.id);
    expect(r.queued).toBe(0);
    expect(r.skipped[0]).toMatchObject({ person_id: Ben.id, reason: "bounced" });
    await c.sql("insert into public.erasure_requests (person_id, centre_id, status) select id, centre_id, 'open' from public.people where id = $1", [Chi.id]);
    expect((await c.as(c.admin, "leader_cards_resend", Chi.id)).skipped[0].reason).toBe("deletion");
  });

  it("sends to everyone whose email did not arrive and who has not started, and to nobody else", async () => {
    await queue(Ben.id, "placement_leader_appointed", "sent");
    await queue(Chi.id, "placement_leader_appointed", "failed", "Rejected");
    await touch(Dayo.tribe);
    const r = await c.as(c.admin, "leader_cards_resend", null);
    expect(r.ok).toBe(true);
    expect(await cardMail(Chi.id)).toHaveLength(1);
    expect(await cardMail(c.appointed.id)).toHaveLength(1);
    expect(await cardMail(Ben.id)).toHaveLength(0);
    expect(await cardMail(Dayo.id)).toHaveLength(0);
    expect(await cardMail(c.seasoned.id)).toHaveLength(0);
    expect(r.skipped).toEqual([]);
  });

  it("refuses a person who has no card", async () => {
    await expectCode(c.as(c.admin, "leader_cards_resend", c.member), "P0002");
  });

  it("writes who did it", async () => {
    await c.as(c.admin, "leader_cards_resend", Ben.id);
    const e = await c.one("select actor_id, meta from public.event_log where action = 'leader_cards.resent' order by id desc limit 1");
    expect(e.actor_id).toBe(c.admin);
    expect(e.meta).toMatchObject({ queued: 1, scope: "one" });
  });
});

describe("the reminders", () => {
  it("start Off, and Off sends and records nothing", async () => {
    expect((await c.as(c.admin, "leader_card_reminders_get")).mode).toBe("off");
    await clock(4, 10);
    expect(await run()).toMatchObject({ mode: "off", queued: 0 });
    expect(await c.sql("select 1 from public.messages")).toHaveLength(0);
    expect(await c.sql("select 1 from public.leader_card_log")).toHaveLength(0);
  });

  it("need a reason, one to four days, and a sensible hour, and are logged", async () => {
    await expectCode(c.as(c.admin, "leader_card_reminders_set", "on", [4], 9, ""), "22023");
    await expectCode(c.as(c.admin, "leader_card_reminders_set", "on", [4], 9, "no"), "22023");
    await expectCode(c.as(c.admin, "leader_card_reminders_set", "sometimes", [4], 9, REASON), "22023");
    await expectCode(c.as(c.admin, "leader_card_reminders_set", "on", [], 9, REASON), "22023");
    await expectCode(c.as(c.admin, "leader_card_reminders_set", "on", [1, 2, 3, 4, 5], 9, REASON), "22023");
    await expectCode(c.as(c.admin, "leader_card_reminders_set", "on", [4], 3, REASON), "22023");
    await expectCode(c.as(c.admin, "leader_card_reminders_set", "on", [4], 20, REASON), "22023");
    const g = await remindersOn("rehearsal", [6, 4, 4], 10);
    expect(g).toMatchObject({ mode: "rehearsal", days: [4, 6], start_hour: 10, reason: REASON });
    const e = await c.one("select actor_id, meta from public.event_log where action = 'leader_cards.reminders_set' order by id desc limit 1");
    expect(e.meta).toMatchObject({ mode: "rehearsal", reason: REASON });
  });

  it("in Rehearsal write down who they would have written to, once a day, and send nothing", async () => {
    await remindersOn("rehearsal");
    await touch(Ben.tribe);
    await setCard(Dayo.tribe, "submitted");
    await clock(4, 10);
    const first = await run();
    expect(first).toMatchObject({ mode: "rehearsal", queued: 0, would_send: 3 });
    expect(await run()).toMatchObject({ would_send: 0 });
    expect(await c.sql("select 1 from public.messages")).toHaveLength(0);
    const g = await c.as(c.admin, "leader_card_reminders_get");
    expect(g.week).toMatchObject({ would_send: 3, sent: 0 });
  });

  it("when On send one email each to the leaders whose card is open, and none to those who have sent it in", async () => {
    await remindersOn("on");
    await touch(Ben.tribe);
    await setCard(Chi.tribe, "changes_requested");
    await setCard(Dayo.tribe, "submitted");
    await clock(4, 10);
    expect(await run()).toMatchObject({ mode: "on", queued: 3 });
    for (const id of [Ben.id, Chi.id, c.appointed.id]) expect(await cardMail(id)).toHaveLength(1);
    expect(await cardMail(Dayo.id)).toHaveLength(0);
    expect(await cardMail(c.seasoned.id)).toHaveLength(0);
    const m = await cardMail(Chi.id);
    expect(m[0]).toMatchObject({ force_channel: "email", params: { kind: "thursday", state: "changes_asked" } });
    expect(m[0].dedupe_key).toMatch(/^leader-card:.+:\d{8}$/);
  });

  it("never write twice in a day, even if the heartbeat runs again or the office sent the email again", async () => {
    await remindersOn("on");
    await clock(4, 10);
    await run();
    expect(await run()).toMatchObject({ queued: 0 });
    expect(await cardMail(Ben.id)).toHaveLength(1);
    await c.sql("delete from public.leader_card_log");
    await c.sql("delete from public.messages");
    await c.as(c.admin, "leader_cards_resend", Ben.id);
    await run();
    expect(await cardMail(Ben.id)).toHaveLength(1);
  });

  it("use the day's own wording on Friday and Saturday", async () => {
    await remindersOn("on", [4, 5, 6]);
    await clock(5, 10);
    await run();
    expect((await cardMail(Ben.id))[0].params.kind).toBe("friday");
    await c.sql("delete from public.leader_card_log");
    await c.sql("delete from public.messages");
    await clock(6, 10);
    await run();
    expect((await cardMail(Ben.id))[0].params.kind).toBe("saturday");
  });

  it("send only on the chosen days, from the chosen hour, and inside the send window", async () => {
    await remindersOn("on", [4], 9);
    await clock(3, 10);
    expect(await run()).toMatchObject({ queued: 0 });
    await clock(4, 8);
    expect(await run()).toMatchObject({ queued: 0 });
    await clock(4, 22);
    expect(await run()).toMatchObject({ queued: 0 });
    expect(await c.sql("select 1 from public.messages")).toHaveLength(0);
    await clock(4, 9);
    expect((await run()).queued).toBeGreaterThan(0);
  });

  it("do nothing while the Master pause is on", async () => {
    await remindersOn("on");
    await c.sql("update public.feature_master set paused = true");
    await clock(4, 10);
    expect(await run()).toMatchObject({ paused: true, queued: 0 });
    expect(await c.sql("select 1 from public.messages")).toHaveLength(0);
    expect((await c.as(c.admin, "leader_card_reminders_get")).paused).toBe(true);
    await c.sql("update public.feature_master set paused = false");
  });

  it("hold back a leader who cannot be written to or has turned reminders off", async () => {
    await remindersOn("on");
    await c.sql("insert into public.email_signals (person_id, kind) values ($1, 'hard_bounce'), ($1, 'hard_bounce')", [Ben.id]);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'reminders', false, 'v1')", [Chi.id]);
    await clock(4, 10);
    await run();
    expect(await cardMail(Ben.id)).toHaveLength(0);
    expect(await cardMail(Chi.id)).toHaveLength(0);
    expect(await cardMail(Dayo.id)).toHaveLength(1);
  });

  it("stop at the total, counting what the office sent again", async () => {
    await remindersOn("on");
    await c.sql("update public.leader_card_settings set max_total = 3");
    for (let i = 0; i < 2; i++) await c.sql("insert into public.leader_card_log (kind, person_id, tribe_id, day) values ('reminder', $1, $2, public.today_lagos() - $3::int)", [Ben.id, Ben.tribe, i + 1]);
    await c.sql("insert into public.leader_card_log (kind, person_id, tribe_id, day) values ('resend', $1, $2, public.today_lagos() - 5)", [Ben.id, Ben.tribe]);
    await clock(4, 10);
    await run();
    expect(await cardMail(Ben.id)).toHaveLength(0);
    expect(await cardMail(Chi.id)).toHaveLength(1);
  });

  it("stop for a leader once their card goes in", async () => {
    await remindersOn("on");
    await clock(4, 10);
    await run();
    await c.sql("delete from public.leader_card_log");
    await c.sql("delete from public.messages");
    await setCard(Ben.tribe, "submitted");
    await run();
    expect(await cardMail(Ben.id)).toHaveLength(0);
    expect(await cardMail(Chi.id)).toHaveLength(1);
  });

  it("are reached by the sending service with its token, and by nobody else", async () => {
    const token = (await c.one("select public.bootstrap_worker_token('leader-cards') as t")).t as string;
    await remindersOn("rehearsal");
    await clock(4, 10);
    const r = await c.anon("worker_leader_card_reminders", token);
    expect(r).toMatchObject({ mode: "rehearsal" });
    await expectCode(c.anon("worker_leader_card_reminders", "not-a-token-not-a-token-not-a-token-0000"), "42501");
    await expectCode(c.as(c.admin, "worker_leader_card_reminders", token), "42501");
  });
});

describe("the sheets", () => {
  it("gives the heads of department names, tribes, departments and where each card is, and no number and no address", async () => {
    await c.as(c.admin, "leader_card_department_set", Ben.id, "Ushers");
    await touch(Chi.tribe);
    const rows = await c.as(dataLead, "leader_cards_sheet", "hod");
    expect(rows).toHaveLength(5);
    expect(rows[0].department).toBe("Ushers");
    expect(JSON.stringify(rows)).not.toMatch(/@|\+234|phone|whatsapp/i);
    expect(rows.map((r: { department?: string }) => r.department ?? null)).toEqual([...rows.map((r: { department?: string }) => r.department ?? null)].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b))));
  });

  it("gives the call sheet to those who act, with the number and the address, and logs every download", async () => {
    await c.sql("delete from public.event_log where action like 'leader_cards.%'");
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031234567', 'email')", [Ben.id]);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'v1')", [Ben.id]);
    const rows = await c.as(c.pastor, "leader_cards_sheet", "call");
    const ben = rows.find((r: { name: string }) => /Ben/.test(r.name));
    expect(ben).toMatchObject({ phone: "+2348031234567", whatsapp_ok: true });
    expect(ben.email).toMatch(/@/);
    const e = await c.sql("select actor_id, meta from public.event_log where action = 'leader_cards.call_sheet'");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ actor_id: c.pastor, meta: { rows: rows.length } });
    await c.as(dataLead, "leader_cards_sheet", "hod");
    expect((await c.sql("select 1 from public.event_log where action = 'leader_cards.hod_sheet'")).length).toBe(1);
  });

  it("refuses a sheet that is not on the list", async () => {
    await expectCode(c.as(c.admin, "leader_cards_sheet", "all"), "22023");
  });
});

describe("the announcement audience", () => {
  it("counts exactly the leaders whose card is open, and is for the office to use like any other audience", async () => {
    await setCard(Chi.tribe, "submitted");
    const clean = async (v: unknown) => (await c.one("select public.audience_clean($1::jsonb) as r", [JSON.stringify(v)])).r;
    const spec = await clean({ kind: "leader_cards" });
    expect(spec).toEqual({ kind: "leader_cards" });
    const rows = await c.sql("select public.audience_base($1::jsonb, (select centre_id from public.people where id = $2)) as p", [JSON.stringify(spec), c.admin]);
    const ids = rows.map((r) => r.p as string).sort();
    expect(ids).toEqual([c.appointed.id, Ben.id, Dayo.id].sort());
  });

  it("refuses a community on it, and keeps the older audiences as they were", async () => {
    const community = (await c.one("select id from public.communities limit 1")).id as string;
    const clean = (v: unknown) => c.one("select public.audience_clean($1::jsonb) as r", [JSON.stringify(v)]);
    await expectCode(clean({ kind: "leader_cards", community }), "22023");
    expect((await clean({ kind: "leaders" })).r).toEqual({ kind: "leaders" });
    await expectCode(clean({ kind: "nobody" }), "22023");
  });
});
