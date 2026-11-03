import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import { expectCode, type TestDb } from "./helpers";
import {
  anon,
  asUser,
  FORM_VERSION,
  linkFor,
  markSent,
  openSeason,
  placeRun,
  readyMember,
  rows,
  workerToken,
} from "./placement-kit";

// Automatic placement, the placing half: what a run writes, what each member can do with their private link, and when and what a
// tribe's leader is told.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let season: string;
let wt: string;
let A: Awaited<ReturnType<Kit["tribe"]>>;
let B: Awaited<ReturnType<Kit["tribe"]>>;
let run: string;
let n: number;
let selfSeated: string;
const mem: { id: string }[] = [];

const HEX64 = /^[a-f0-9]{64}$/;

beforeAll(async () => {
  ({ db, k } = await newKit());
  season = await openSeason(db);
  o = await makeOwner(db);
  wt = await workerToken(db);
  await db.admin.query(
    "update public.tribes set status = 'closed' where status = 'approved'",
  );
  A = await k.tribe(season, {
    capacity: 12,
    name: "Mid A",
    assistant: "certified",
  });
  B = await k.tribe(season, {
    capacity: 12,
    name: "Sunday B",
    slot: "sunday-afternoon",
  });
  // one member who chose this tribe for themselves, before any run
  selfSeated = (
    await k.seat(A.tribe, season, "Chose", {
      profile: { times: ["weeknight-evening"] },
    })
  ).id;
  for (let i = 0; i < 14; i++) {
    const sunday = i % 7 === 6;
    mem.push(
      await readyMember(db, k, season, `Mem${i}`, {
        times: sunday ? ["sunday-afternoon"] : ["weeknight-evening"],
        daysAgo: 30 - i,
        whatsapp:
          i < 10 ? `+23480123450${String(i).padStart(2, "0")}` : undefined,
        share: sunday ? true : i === 3 ? false : undefined, // the Sunday members agreed on the form; Mem3 said no; the rest never saw the line
      }),
    );
  }
  await o.call(
    "placement_settings_save",
    JSON.stringify({ mode: "on", min_tribe: 4 }),
  );
  ({ run, n } = await placeRun(db, o, {}));
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("a run that places people", () => {
  it("seats each member in the tribe it planned, marked as placed by the church and not yet confirmed", async () => {
    expect(n).toBe(11); // Mid A keeps room for two established members and already holds the member who chose it, so it takes nine; Sunday B takes two
    const seats = await rows(
      db,
      "select * from public.tribe_members where placed_by_run = $1",
      [run],
    );
    expect(seats.length).toBe(n);
    for (const s of seats) {
      expect(s).toMatchObject({
        status: "active",
        placement_source: "auto",
        agreement_version: "auto-pending",
        confirmed_at: null,
        chosen_rank: 1,
      });
      expect(s.degree).toBeGreaterThanOrEqual(60);
    }
    expect(
      seats.filter((s) => s.contact_withheld).map((s) => s.person_id),
    ).toEqual([mem[3].id]); // only the member who said no on the form
    expect(
      (
        await rows(
          db,
          "select status, told from public.placement_runs where id = $1",
          [run],
        )
      )[0],
    ).toEqual({ status: "placed", told: n });
    // a member who chose for themselves is left exactly as they were
    expect(
      (
        await rows(
          db,
          "select placement_source, placed_by_run, confirmed_at from public.tribe_members where person_id = $1",
          [selfSeated],
        )
      )[0],
    ).toEqual({
      placement_source: "self",
      placed_by_run: null,
      confirmed_at: null,
    });
  });

  it("leaves the record a member's own run leaves, so their tribe page reads the same, with the church's pick chosen", async () => {
    for (const s of await rows(
      db,
      "select person_id, tribe_id, run_id from public.tribe_members where placed_by_run = $1",
      [run],
    )) {
      const rec = await rows(
        db,
        "select tribe_id, chosen, rank from public.match_recommendations where run_id = $1 order by rank",
        [s.run_id],
      );
      expect(rec[0]).toMatchObject({
        tribe_id: s.tribe_id,
        chosen: true,
        rank: 1,
      });
      expect(rec.filter((r) => r.chosen).length).toBe(1);
    }
  });

  it("sends the church's own email in place of the standard welcome and 'someone joined' emails, never both", async () => {
    const std = await rows(
      db,
      `select count(*)::int n from public.messages m join public.tribe_members tm on m.dedupe_key = 'welcome:' || tm.id or m.dedupe_key like 'newmember:' || tm.id || ':%'
                                 where tm.placed_by_run = $1`,
      [run],
    );
    expect(std[0].n).toBe(0);
    const mine = await rows(
      db,
      "select template, count(*)::int n, count(distinct person_id)::int p from public.messages where template in ('placement_your_tribe', 'placement_reminder') group by 1 order by 1",
    );
    expect(mine).toEqual([
      { template: "placement_reminder", n, p: n },
      { template: "placement_your_tribe", n, p: n },
    ]);
    // …and the member who chose for themselves still got the standard ones
    expect(
      (
        await rows(
          db,
          "select count(*)::int n from public.messages where person_id = $1 and template = 'welcome'",
          [selfSeated],
        )
      )[0].n,
    ).toBeGreaterThanOrEqual(0);
  });

  it("sends by email only, and gives every email its own private link, stored only as a hash", async () => {
    const msgs = await rows(
      db,
      "select force_channel, reply_token from public.messages where template in ('placement_your_tribe', 'placement_reminder')",
    );
    expect(msgs.length).toBe(2 * n);
    for (const m of msgs) {
      expect(m.force_channel).toBe("email");
      expect(m.reply_token).toMatch(HEX64);
    }
    expect(new Set(msgs.map((m) => m.reply_token)).size).toBe(2 * n);
    const hashed = await rows(
      db,
      `select count(*)::int c from public.placement_tokens k
                                    join public.messages m on encode(sha256(convert_to(m.reply_token, 'UTF8')), 'hex') = k.token_hash`,
    );
    expect(hashed[0].c).toBe(2 * n);
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.placement_tokens where token_hash ~ '^[a-f0-9]{64}$'",
        )
      )[0].c,
    ).toBe(2 * n);
    const raw = msgs.map((m) => m.reply_token as string);
    const stored = (
      await rows(db, "select token_hash from public.placement_tokens")
    ).map((r) => r.token_hash as string);
    expect(stored.filter((h) => raw.includes(h))).toEqual([]);
  });

  it("spreads the emails at the church's pace, and only inside the sending hours in Lagos", async () => {
    const sch = await rows(
      db,
      `select scheduled_for, (scheduled_for at time zone 'Africa/Lagos')::time as local from public.messages
                                 where template = 'placement_your_tribe' order by scheduled_for, id`,
    );
    expect(sch.length).toBe(n);
    for (let i = 1; i < sch.length; i++) {
      const gap =
        new Date(sch[i].scheduled_for).getTime() -
        new Date(sch[i - 1].scheduled_for).getTime();
      expect(gap).toBeGreaterThanOrEqual(35_000); // 100 an hour is one every 36 seconds
      expect(gap).toBeLessThanOrEqual(38_000);
    }
    for (const s of sch)
      expect(s.local >= "09:00:00" && s.local <= "19:00:00").toBe(true);
    const rem = await rows(
      db,
      `select (r.scheduled_for - m.scheduled_for) as gap from public.messages m join public.messages r on r.person_id = m.person_id and r.template = 'placement_reminder'
                                 where m.template = 'placement_your_tribe'`,
    );
    expect(new Set(rem.map((r) => JSON.stringify(r.gap)))).toEqual(
      new Set([JSON.stringify({ days: 5 })]),
    );
  });

  it("tells the member their tribe, the day, the time and the leader's first name, and nothing about anyone else or how they scored", async () => {
    const allowed = new Set([
      "tribe",
      "leader_first",
      "assistant_first",
      "meeting_day",
      "meeting_time",
      "mode",
      "place_note",
      "group_url",
      "group_held",
      "first_meeting_by",
      "first_meeting_on",
      "season",
      "starts_on",
      "fit",
      "god",
      "others",
      "life",
      "has_whatsapp",
      "agreed_to_share",
      "hold_hours",
      "in_season",
      "week",
      "change_until",
    ]);
    for (const m of await rows(
      db,
      "select params from public.messages where template in ('placement_your_tribe', 'placement_reminder')",
    )) {
      expect(Object.keys(m.params).filter((x) => !allowed.has(x))).toEqual([]);
      expect(["excellent", "strong", "good"]).toContain(m.params.fit);
      expect(JSON.stringify(m.params)).not.toMatch(
        /@|\+234|member|degree|score/i,
      );
    }
  });

  it("shows each tribe's leader every placed member by name at once, marked 'pending', with no number until that member's own hold ends", async () => {
    const before = await asUser(
      db,
      A.leader.id,
      "tribe_roster_marked",
      A.tribe,
    );
    const placed = await rows(
      db,
      "select person_id from public.tribe_members where tribe_id = $1 and placed_by_run = $2 and status = 'active'",
      [A.tribe, run],
    );
    const ids = before.members.map((m: { person_id: string }) => m.person_id);
    expect(ids).toContain(selfSeated);
    expect(ids.length).toBe(placed.length + 1);
    for (const p of placed) expect(ids).toContain(p.person_id);
    const self = before.members.find((m: { person_id: string }) => m.person_id === selfSeated);
    expect(self).not.toHaveProperty("placement");
    for (const m of before.members) {
      if (m.person_id === selfSeated) continue;
      expect(m.placement).toBe("pending");
      expect(m.whatsapp).toBeNull(); // their emails have not gone out yet, so nobody's contact is open
    }
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.messages where template = 'placement_your_team'",
        )
      )[0].c,
    ).toBe(0);
  });

  it("does not email a leader while any of their members has not been told", async () => {
    expect(
      (await rows(db, "select public.placement_team_mail($1) as r", [run]))[0]
        .r,
    ).toBe(0);
  });
});

describe("a member's private link", () => {
  const link = (i: number) => linkFor(db, mem[i].id);

  it("opens on the member's own tribe and gives the leader's first name, the time and the choices, and nobody else's details", async () => {
    const info = await anon(db, "worker_placed_info", wt, await link(0));
    expect(info).toMatchObject({
      found: true,
      active: true,
      placed_by_church: true,
      confirmed: false,
      withheld: false,
      leader_told: false,
      can_change: true,
    });
    expect(info.tribe).toMatchObject({ name: "Mid A" });
    expect(JSON.stringify(info)).not.toMatch(/@|\+234|degree|score/);
    expect(Object.keys(info).sort()).toEqual([
      "active",
      "can_change",
      "change_until", // the day joining closes: a placed member may look at other tribes until then
      "confirmed",
      "contact", // where the leader's view of their contact stands: waiting, holding, unanswered, open, not_reached or withheld
      "contact_late", // true once God Mode has opened it: "don't share" is too late
      "contact_opens_at",
      "first_name",
      "fit",
      "found",
      "group_opens_at",
      "group_visible",
      "has_whatsapp",
      "in_season", // whether the season is already running, so the page and the email say so
      "leader_told",
      "placed_by_church",
      "tribe",
      "withheld",
    ]);
  });

  it("counts an opening and changes nothing else, because mail scanners open links too", async () => {
    const l = (await link(0))!;
    const hash = (
      await rows(db, "select encode(sha256(convert_to($1, 'UTF8')), 'hex') h", [
        l,
      ])
    )[0].h;
    const clicks = async () =>
      (
        await rows(
          db,
          "select clicks from public.placement_tokens where token_hash = $1",
          [hash],
        )
      )[0].clicks as number;
    const before = await clicks();
    const seat = JSON.stringify(
      (
        await rows(
          db,
          "select status, confirmed_at, contact_withheld from public.tribe_members where person_id = $1 and placed_by_run = $2",
          [mem[0].id, run],
        )
      )[0],
    );
    await anon(db, "worker_placed_info", wt, l);
    await anon(db, "worker_placed_info", wt, l);
    expect(await clicks()).toBe(before + 2);
    expect(
      JSON.stringify(
        (
          await rows(
            db,
            "select status, confirmed_at, contact_withheld from public.tribe_members where person_id = $1 and placed_by_run = $2",
            [mem[0].id, run],
          )
        )[0],
      ),
    ).toBe(seat);
  });

  it("is refused for a made-up link, an expired link, a link for a seat the member chose themselves, and a wrong sending token", async () => {
    for (const bad of [
      "",
      "x",
      "a".repeat(64),
      "A".repeat(64),
      "g".repeat(64),
      "a".repeat(63),
    ]) {
      expect(await anon(db, "worker_placed_info", wt, bad)).toEqual({
        found: false,
      });
      expect(
        await anon(db, "worker_placed_confirm", wt, bad, FORM_VERSION),
      ).toEqual({ ok: false, reason: "invalid" });
    }
    const l = (await link(1))!;
    await db.admin.query(
      "update public.placement_tokens set expires_at = now() - interval '1 minute' where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
      [l],
    );
    expect(await anon(db, "worker_placed_info", wt, l)).toEqual({
      found: false,
    });
    await db.admin.query(
      "update public.placement_tokens set expires_at = now() + interval '30 days' where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
      [l],
    );
    expect((await anon(db, "worker_placed_info", wt, l)).found).toBe(true);
    // a seat the member chose themselves has no private link to open, even if one were somehow made
    const selfSeat = (
      await rows(
        db,
        "select id from public.tribe_members where person_id = $1",
        [selfSeated],
      )
    )[0].id;
    const raw = (
      await rows(db, "select public.placement_token_mint($1, $2, 30) as t", [
        selfSeat,
        selfSeated,
      ])
    )[0].t;
    expect(await anon(db, "worker_placed_info", wt, raw)).toEqual({
      found: false,
    });
    expect(await anon(db, "worker_placed_change", wt, raw)).toEqual({
      ok: false,
      reason: "invalid",
    });
    await expectCode(
      anon(db, "worker_placed_info", "wrong-token-wrong-token-wrong-token", l),
      "42501",
    );
    await expectCode(
      anon(
        db,
        "worker_placed_confirm",
        "wrong-token-wrong-token-wrong-token",
        l,
        FORM_VERSION,
      ),
      "42501",
    );
  });

  it("records 'Yes, I'm in' as the agreement a member who chose for themselves gives, once, and stops the reminder", async () => {
    const l = (await link(0))!;
    await expectCode(
      anon(db, "worker_placed_confirm", wt, l, "bad version!"),
      "22023",
    );
    expect(
      await anon(db, "worker_placed_confirm", wt, l, FORM_VERSION),
    ).toEqual({ ok: true });
    const seat = (
      await rows(
        db,
        "select confirmed_at, agreed_at, agreement_version from public.tribe_members where person_id = $1 and placed_by_run = $2",
        [mem[0].id, run],
      )
    )[0];
    expect(seat.confirmed_at).not.toBeNull();
    expect(seat.agreement_version).toBe(FORM_VERSION);
    expect(
      await anon(db, "worker_placed_confirm", wt, l, FORM_VERSION),
    ).toEqual({ ok: true });
    expect(
      (
        await rows(
          db,
          "select confirmed_at from public.tribe_members where person_id = $1 and placed_by_run = $2",
          [mem[0].id, run],
        )
      )[0].confirmed_at,
    ).toEqual(seat.confirmed_at);
    expect(
      (
        await rows(
          db,
          "select status, error from public.messages where template = 'placement_reminder' and person_id = $1",
          [mem[0].id],
        )
      )[0],
    ).toEqual({ status: "skipped", error: "confirmed" });
    expect((await anon(db, "worker_placed_info", wt, l)).confirmed).toBe(true);
  });

  it("records 'Don't share my details', tells the member their tribe's details instead, and keeps the refusal for any later seat", async () => {
    const l = (await link(1))!;
    expect(await anon(db, "worker_placed_withhold", wt, l)).toEqual({
      ok: true,
      late: false,
    });
    expect(
      (
        await rows(
          db,
          "select contact_withheld from public.tribe_members where person_id = $1 and placed_by_run = $2",
          [mem[1].id, run],
        )
      )[0].contact_withheld,
    ).toBe(true);
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.messages where template = 'placement_withheld' and person_id = $1",
          [mem[1].id],
        )
      )[0].c,
    ).toBe(1);
    expect(
      (
        await rows(
          db,
          "select granted, version from public.consents where person_id = $1 and purpose = 'team_contact' order by id desc limit 1",
          [mem[1].id],
        )
      )[0],
    ).toEqual({ granted: false, version: "placement-link" });
    expect(
      await rows(db, "select public.placement_contact_refused($1) as r", [
        mem[1].id,
      ]),
    ).toEqual([{ r: true }]);
    expect(await anon(db, "worker_placed_withhold", wt, l)).toEqual({
      ok: true,
      late: false,
    });
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.messages where template = 'placement_withheld' and person_id = $1",
          [mem[1].id],
        )
      )[0].c,
    ).toBe(1);
  });

  it("gives up the seat on 'Show me other tribes': the seat is freed, every waiting email is withdrawn and the link stops opening", async () => {
    const l = (await link(2))!;
    expect(await anon(db, "worker_placed_change", wt, l)).toEqual({ ok: true });
    expect(
      (
        await rows(
          db,
          "select status, release_reason from public.tribe_members where person_id = $1 and placed_by_run = $2",
          [mem[2].id, run],
        )
      )[0],
    ).toEqual({
      status: "released",
      release_reason: "Chose to look at other tribes",
    });
    const waiting = await rows(
      db,
      "select status, error, reply_token from public.messages where person_id = $1 and template like 'placement%' order by template",
      [mem[2].id],
    );
    for (const m of waiting)
      expect(m).toMatchObject({ status: "skipped", reply_token: null });
    expect(await anon(db, "worker_placed_info", wt, l)).toEqual({
      found: false,
    });
    expect(await anon(db, "worker_placed_change", wt, l)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("will not give up a seat once joining has closed", async () => {
    const l = (await link(4))!;
    // Joining has closed (the cut-off is two weeks after the season starts); inside the window a placed member may still ask
    await db.admin.query(
      "update public.seasons set starts_on = public.today_lagos() - 20 where id = $1",
      [season],
    );
    try {
      expect(await anon(db, "worker_placed_change", wt, l)).toEqual({
        ok: false,
        reason: "started",
      });
      expect((await anon(db, "worker_placed_info", wt, l)).can_change).toBe(
        false,
      );
    } finally {
      await db.admin.query(
        "update public.seasons set starts_on = public.today_lagos() + 30 where id = $1",
        [season],
      );
    }
    expect(
      (
        await rows(
          db,
          "select status from public.tribe_members where person_id = $1 and placed_by_run = $2",
          [mem[4].id, run],
        )
      )[0].status,
    ).toBe("active");
  });

  it("does the same for a placed member who is signed in, and refuses anyone who is not placed or not signed in", async () => {
    const me = mem[5].id;
    expect(await asUser(db, me, "my_placement")).toMatchObject({
      found: true,
      placed_by_church: true,
      confirmed: false,
    });
    expect(await asUser(db, me, "placement_my_confirm", FORM_VERSION)).toEqual({
      ok: true,
    });
    expect((await asUser(db, me, "my_placement")).confirmed).toBe(true);
    expect(await asUser(db, mem[8].id, "placement_my_withhold")).toEqual({
      ok: true,
      late: false,
    });
    // a member who chose for themselves has nothing to confirm
    expect(await asUser(db, selfSeated, "my_placement")).toBeNull();
    expect(
      await asUser(db, selfSeated, "placement_my_confirm", FORM_VERSION),
    ).toEqual({ ok: false, reason: "not_active" });
    expect(await asUser(db, selfSeated, "placement_my_withhold")).toEqual({
      ok: false,
      reason: "not_active",
    });
    for (const fn of ["my_placement", "placement_my_withhold"])
      await expectCode(
        db.asAnon((q) => q(`select public.${fn}()`)),
        "42501",
      );
    await expectCode(
      db.asAnon((q) =>
        q("select public.placement_my_confirm($1)", [FORM_VERSION]),
      ),
      "42501",
    );
  });
});

describe("telling each tribe's leader", () => {
  const teamMails = () =>
    rows(
      db,
      "select person_id, params, status, force_channel from public.messages where template = 'placement_your_team' order by created_at, id",
    );

  it("waits 24 hours after the last member of the tribe was told, whatever the members ticked on the form", async () => {
    await markSent(db, 2); // every member email went out two hours ago
    await db.admin.query(
      "update public.messages set status = 'failed', error = 'bounced' where template = 'placement_your_tribe' and person_id = $1",
      [mem[7].id],
    );
    // Sunday B: both members ticked the contact line on the form, and that no longer hurries anything. Neither tribe is told yet.
    expect(
      (await rows(db, "select public.placement_team_mail($1) as r", [run]))[0]
        .r,
    ).toBe(0);
    expect((await teamMails()).length).toBe(0);
    for (const t of [A.tribe, B.tribe]) {
      expect(
        (
          await rows(
            db,
            "select mail_queued_at is not null as q from public.placement_teams where run_id = $1 and tribe_id = $2",
            [run, t],
          )
        )[0].q,
      ).toBe(false);
    }
    // after the 24 hours Mid A's leader and assistant, and Sunday B's leader, are told
    await db.admin.query(
      "update public.messages set sent_at = now() - interval '26 hours' where template = 'placement_your_tribe' and status = 'sent'",
    );
    expect(
      (await rows(db, "select public.placement_team_mail($1) as r", [run]))[0]
        .r,
    ).toBe(2);
    const all = await teamMails();
    expect(all.map((m) => m.person_id).sort()).toEqual(
      [A.leader.id, A.assistant!.id, B.leader.id].sort(),
    );
    for (const m of all) expect(m.force_channel).toBe("email");
  });

  it("is said once: asking again queues nothing, and the run closes when every leader has been told", async () => {
    const before = (await teamMails()).length;
    expect(
      (await rows(db, "select public.placement_team_mail($1) as r", [run]))[0]
        .r,
    ).toBe(0);
    expect((await teamMails()).length).toBe(before);
    expect(
      (
        await rows(
          db,
          "select status from public.placement_runs where id = $1",
          [run],
        )
      )[0].status,
    ).toBe("closed");
  });

  it("lists the members who were told, with their name, email and WhatsApp, and 'contact withheld' for those who held back", async () => {
    const mail = (await teamMails()).find((m) => m.person_id === A.leader.id)!;
    expect(Object.keys(mail.params).sort()).toEqual([
      "call_by",
      "first_meeting_by",
      "in_season",
      "members",
      "tribe",
      "week",
    ]);
    const names = mail.params.members.map((m: { name: string }) => m.name);
    expect(names).toContain("Mem0 Test");
    expect(names).not.toContain("Mem2 Test"); // gave up the seat
    for (const m of mail.params.members) {
      expect(Object.keys(m).sort()).toEqual([
        "email",
        "name",
        "opens_on",
        "state",
        "whatsapp",
        "withheld",
      ]);
      if (m.withheld) expect(m).toMatchObject({ email: null, whatsapp: null, state: "withheld" });
      else if (m.state === "open") expect(m.email).toMatch(/@/);
      else expect(m).toMatchObject({ email: null, whatsapp: null });
    }
    const byName = Object.fromEntries(
      mail.params.members.map((m: { name: string }) => [m.name, m]),
    );
    // their email never went out, so they are listed as not yet reached, with no contact: they have not had their chance to hold back
    expect(byName["Mem7 Test"]).toMatchObject({ state: "not_reached", email: null, whatsapp: null, withheld: false });
    expect(byName["Mem3 Test"].withheld).toBe(true); // said no on the form
    expect(byName["Mem1 Test"].withheld).toBe(true); // said no from the link
    expect(byName["Mem0 Test"].whatsapp).toBe("+2348012345000"); // consented to be contacted there
    // Sunday B: both ticked the contact line on the form and neither has said yes, so the leader has their names and no numbers
    const sun = (await teamMails()).find((m) => m.person_id === B.leader.id)!;
    const sunBy = Object.fromEntries(
      sun.params.members.map((m: { name: string }) => [m.name, m]),
    );
    expect(sunBy["Mem6 Test"]).toMatchObject({ state: "unanswered", email: null, whatsapp: null, withheld: false });
    expect(sunBy["Mem13 Test"]).toMatchObject({ state: "unanswered", email: null, whatsapp: null, withheld: false });
    // and in Mid A the clock has opened nothing either: whoever has not said yes is "unanswered", with no number
    const quiet = mail.params.members.filter((m: { state: string }) => m.state === "unanswered");
    expect(quiet.length).toBeGreaterThan(0);
    for (const m of quiet) expect(m).toMatchObject({ email: null, whatsapp: null, withheld: false });
  });

  it("carries nothing but names, addresses and numbers: no answers, scores, faith journey or needs", async () => {
    for (const m of await teamMails()) {
      expect(JSON.stringify(m.params)).not.toMatch(
        /degree|compat|score|faith|(?<!un)answer|need|care|sensitive|support|journey/i, // "unanswered" is a member's state, not an answer they gave
      );
    }
  });

  it("goes to the leader and the assistant only, and never to the platform owner", async () => {
    const to = (await teamMails()).map((m) => m.person_id);
    expect(to).not.toContain(o.owner.id);
    expect(new Set(to)).toEqual(
      new Set([A.leader.id, A.assistant!.id, B.leader.id]),
    );
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.messages where person_id = $1 and template like 'placement%'",
          [o.owner.id],
        )
      )[0].c,
    ).toBe(0);
  });

  it("shows the leader their members only now, marked confirmed or pending, with contact left off for those who held back", async () => {
    const roster = await asUser(
      db,
      A.leader.id,
      "tribe_roster_marked",
      A.tribe,
    );
    const by = Object.fromEntries(
      roster.members.map((m: { name: string }) => [m.name, m]),
    );
    expect(by["Mem0 Test"].placement).toBe("confirmed");
    expect(by["Mem8 Test"].placement).toBe("pending");
    expect(by["Chose Test"]).not.toHaveProperty("placement");
    expect(by["Mem3 Test"]).toMatchObject({ withheld: true, whatsapp: null });
    expect(by["Mem1 Test"]).toMatchObject({ withheld: true, whatsapp: null });
    expect(by["Mem2 Test"]).toBeUndefined();
    // the assistant sees the same; another tribe's leader cannot ask
    expect(
      (await asUser(db, A.assistant!.id, "tribe_roster_marked", A.tribe))
        .members.length,
    ).toBe(roster.members.length);
    await expectCode(
      db.asUser(B.leader.id, (q) =>
        q("select public.tribe_roster_marked($1)", [A.tribe]),
      ),
      "42501",
    );
    await expectCode(
      db.asAnon((q) => q("select public.tribe_roster_marked($1)", [A.tribe])),
      "42501",
    );
  });

  it("still counts a 'don't share' that comes after the leader was told: that email carried no details for a member who had not said yes", async () => {
    const l = (await linkFor(db, mem[13].id))!;
    expect(await anon(db, "worker_placed_withhold", wt, l)).toEqual({
      ok: true,
      late: false,
    });
    expect(
      (
        await rows(
          db,
          "select contact_withheld from public.tribe_members where person_id = $1 and placed_by_run = $2",
          [mem[13].id, run],
        )
      )[0].contact_withheld,
    ).toBe(true);
    expect((await anon(db, "worker_placed_info", wt, l)).leader_told).toBe(
      true,
    );
  });

  it("treats a 'don't share' that comes after God Mode opened the tribe as late, and changes nothing for them", async () => {
    await db.admin.query(
      "update public.placement_teams set contact_opened_at = now() where run_id = $1 and tribe_id = $2",
      [run, B.tribe],
    );
    const l = (await linkFor(db, mem[6].id))!;
    expect(await anon(db, "worker_placed_withhold", wt, l)).toEqual({
      ok: true,
      late: true,
    });
    expect(
      (
        await rows(
          db,
          "select contact_withheld from public.tribe_members where person_id = $1 and placed_by_run = $2",
          [mem[6].id, run],
        )
      )[0].contact_withheld,
    ).toBe(false);
  });
});
