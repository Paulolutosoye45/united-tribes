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
  planRun,
  proposedCount,
  readyMember,
  resolveAll,
  rows,
  workerToken,
} from "./placement-kit";

// Automatic placement: taking a run back, what is checked again at the moment of placing, a rehearsal, the ordinary route out of a seat,
// the heartbeat, and the proof that a member who chooses for themselves is treated exactly as before.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let season: string;
let wt: string;
let tag = 0;

type World = {
  C: Awaited<ReturnType<Kit["tribe"]>>;
  D: Awaited<ReturnType<Kit["tribe"]>>;
  mem: { id: string }[];
};

/** Two fresh tribes and a fresh set of members: eight who meet on weeknights and four on Sunday afternoons. Every older tribe is closed. */
async function world(weeknight = 8, sunday = 4, capacity = 12): Promise<World> {
  tag++;
  await db.admin.query(
    "update public.tribes set status = 'closed' where status = 'approved'",
  );
  const C = await k.tribe(season, {
    capacity,
    name: `Mid ${tag}`,
    assistant: "certified",
  });
  const D = await k.tribe(season, {
    capacity,
    name: `Sunday ${tag}`,
    slot: "sunday-afternoon",
  });
  const mem: { id: string }[] = [];
  for (let i = 0; i < weeknight; i++)
    mem.push(
      await readyMember(db, k, season, `W${tag}x${i}`, {
        times: ["weeknight-evening"],
        daysAgo: 40 - i,
        whatsapp: `+234801000${tag}${String(i).padStart(3, "0")}`,
      }),
    );
  for (let i = 0; i < sunday; i++)
    mem.push(
      await readyMember(db, k, season, `S${tag}x${i}`, {
        times: ["sunday-afternoon"],
        daysAgo: 40 - weeknight - i,
      }),
    );
  return { C, D, mem };
}

const cancelOpen = () =>
  db.admin.query(
    "update public.placement_runs set status = 'cancelled' where status in ('planning', 'planned', 'approved')",
  );

beforeAll(async () => {
  ({ db, k } = await newKit());
  season = await openSeason(db);
  o = await makeOwner(db);
  wt = await workerToken(db);
  await o.call(
    "placement_settings_save",
    JSON.stringify({ mode: "on", min_tribe: 4 }),
  );
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("undoing a run", () => {
  it("releases everyone who has not answered, keeps the members who confirmed or held back, withdraws the emails still waiting, and frees the links", async () => {
    const w = await world();
    const { run, n } = await placeRun(db, o, {});
    const seats = await rows(
      db,
      "select id, person_id from public.tribe_members where placed_by_run = $1 and status = 'active'",
      [run],
    );
    expect(seats.length).toBe(n);
    const confirmed = seats[0].person_id as string;
    const held = seats[1].person_id as string;
    expect(
      await anon(
        db,
        "worker_placed_confirm",
        wt,
        (await linkFor(db, confirmed))!,
        FORM_VERSION,
      ),
    ).toEqual({ ok: true });
    expect(
      await anon(db, "worker_placed_withhold", wt, (await linkFor(db, held))!),
    ).toEqual({ ok: true, late: false });

    const undone = await o.call("placement_undo", run);
    expect(undone).toEqual({
      status: "undone",
      released: n - 2,
      kept_confirmed: 2,
      kept_leader_told: 0,
      restored: false, // new with "place or move from Admin": true only when an undone move put the old seat back
    });
    const after = await rows(
      db,
      "select person_id, status, release_reason from public.tribe_members where placed_by_run = $1",
      [run],
    );
    expect(
      after
        .filter((s) => s.status === "active")
        .map((s) => s.person_id)
        .sort(),
    ).toEqual([confirmed, held].sort());
    for (const s of after.filter((x) => x.status === "released"))
      expect(s.release_reason).toBe("Placement undone by the church");
    // the emails still waiting for a released member are withdrawn, their links are gone, and the church's pick is no longer marked chosen
    const gone = after
      .filter((s) => s.status === "released")
      .map((s) => s.person_id);
    const msgs = await rows(
      db,
      "select status, reply_token from public.messages where person_id = any($1::uuid[]) and template in ('placement_your_tribe', 'placement_reminder')",
      [gone],
    );
    expect(msgs.length).toBe(2 * gone.length);
    for (const m of msgs)
      expect(m).toEqual({ status: "skipped", reply_token: null });
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.placement_tokens t join public.tribe_members m on m.id = t.placement_id where m.person_id = any($1::uuid[])",
          [gone],
        )
      )[0].c,
    ).toBe(0);
    expect(
      await anon(db, "worker_placed_info", wt, (await linkFor(db, confirmed))!),
    ).toMatchObject({ found: true });
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.match_recommendations r join public.tribe_members m on m.run_id = r.run_id and m.tribe_id = r.tribe_id where m.person_id = any($1::uuid[]) and r.chosen",
          [gone],
        )
      )[0].c,
    ).toBe(0);
    expect(
      (
        await rows(
          db,
          "select status, undone_at is not null as u from public.placement_runs where id = $1",
          [run],
        )
      )[0],
    ).toEqual({ status: "undone", u: true });
    // pressing it again changes nothing
    expect(await o.call("placement_undo", run)).toEqual({
      status: "undone",
      already: true,
    });
    // the released members can be considered again straight away: the run the church wrote for them is not their own activity
    const next = await planRun(o, {});
    const again = await rows(
      db,
      "select status, reason from public.placement_items where run_id = $1 and person_id = any($2::uuid[])",
      [next, gone],
    );
    expect(again.length).toBe(gone.length);
    expect(again.filter((x) => x.reason === "in_grace")).toEqual([]);
    await o.call("placement_run_cancel", next);
    void w;
  });

  it("still tells the leader about the members who stayed, once the 24 hours have passed", async () => {
    const mails = await rows(
      db,
      "select count(*)::int c from public.messages where template = 'placement_your_team'",
    );
    expect(mails[0].c).toBe(0);
    const run = (
      await rows(
        db,
        "select id from public.placement_runs where status = 'undone' order by seq desc limit 1",
      )
    )[0].id;
    await markSent(db, 26);
    expect(
      (await rows(db, "select public.placement_team_mail($1) as r", [run]))[0]
        .r,
    ).toBeGreaterThan(0);
    const team = await rows(
      db,
      "select params from public.messages where template = 'placement_your_team'",
    );
    // (the leader and the assistant each get the same list)
    const listed = new Set(
      team.flatMap((m) =>
        m.params.members.map((x: { name: string }) => x.name),
      ),
    );
    expect(listed.size).toBe(2);
  });

  it("keeps every tribe whose leader has already been told, and releases only the rest", async () => {
    const w = await world();
    const { run, n } = await placeRun(db, o, {});
    // only the Mid tribe's members were emailed, and 26 hours ago, so only its leader is told
    await db.admin.query(
      "update public.messages set status = 'sent', sent_at = now() - interval '26 hours' where template = 'placement_your_tribe' and tribe_id = $1",
      [w.C.tribe],
    );
    expect(
      (await rows(db, "select public.placement_team_mail($1) as r", [run]))[0]
        .r,
    ).toBe(1);
    const inC = (
      await rows(
        db,
        "select count(*)::int c from public.tribe_members where placed_by_run = $1 and tribe_id = $2",
        [run, w.C.tribe],
      )
    )[0].c;
    const res = await o.call("placement_undo", run);
    expect(res).toMatchObject({
      status: "undone",
      kept_leader_told: inC,
      released: n - inC,
    });
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.tribe_members where placed_by_run = $1 and tribe_id = $2 and status = 'active'",
          [run, w.C.tribe],
        )
      )[0].c,
    ).toBe(inC);
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.tribe_members where placed_by_run = $1 and tribe_id = $2 and status = 'active'",
          [run, w.D.tribe],
        )
      )[0].c,
    ).toBe(0);
    // the other tribe's leader is never told about a team that no longer exists
    expect(
      (
        await rows(
          db,
          "select cancelled_at is not null as c from public.placement_teams where run_id = $1 and tribe_id = $2",
          [run, w.D.tribe],
        )
      )[0].c,
    ).toBe(true);
    await markSent(db, 40);
    expect(
      (await rows(db, "select public.placement_team_mail($1) as r", [run]))[0]
        .r,
    ).toBe(0);
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.messages where template = 'placement_your_team' and person_id = $1",
          [w.D.leader.id],
        )
      )[0].c,
    ).toBe(0);
  });

  it("cannot be done once every leader has been told, and a rehearsal has nothing to undo", async () => {
    const w = await world();
    const { run } = await placeRun(db, o, {});
    await db.admin.query(
      "update public.messages set status = 'sent', sent_at = now() - interval '30 hours' where template = 'placement_your_tribe'",
    );
    await rows(db, "select public.placement_team_mail($1)", [run]);
    expect(
      (
        await rows(
          db,
          "select status from public.placement_runs where id = $1",
          [run],
        )
      )[0].status,
    ).toBe("closed");
    await expectCode(o.call("placement_undo", run), "22023");
    await expect(o.call("placement_undo", run)).rejects.toThrow(
      /no longer be undone/,
    );
    void w;

    await o.call(
      "placement_settings_save",
      JSON.stringify({ mode: "rehearsal" }),
    );
    await world();
    const rehearsal = await placeRun(db, o, {});
    await expectCode(o.call("placement_undo", rehearsal.run), "22023");
    await o.call("placement_settings_save", JSON.stringify({ mode: "on" }));
  });

  it("cancels a run that was approved but has not placed anyone", async () => {
    await world();
    const run = await planRun(o, {});
    await resolveAll(db, o, run, "keep");
    await o.call("placement_run_approve", run, await proposedCount(db, run));
    expect(await o.call("placement_undo", run)).toEqual({
      status: "cancelled",
      released: 0,
    });
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.tribe_members where placed_by_run = $1",
          [run],
        )
      )[0].c,
    ).toBe(0);
  });
});

describe("checking again at the moment of placing", () => {
  it("leaves out a member who chose for themselves, withdrew consent, or whose tribe closed or filled up after the plan was made", async () => {
    const w = await world(6, 4, 12);
    const run = await planRun(o, {});
    await resolveAll(db, o, run, "keep");
    const planned = await rows(
      db,
      "select person_id, tribe_id from public.placement_items where run_id = $1 and status = 'proposed' order by seq",
      [run],
    );
    const inD = planned
      .filter((p) => p.tribe_id === w.D.tribe)
      .map((p) => p.person_id as string);
    const inC = planned
      .filter((p) => p.tribe_id === w.C.tribe)
      .map((p) => p.person_id as string);
    expect(inD.length).toBeGreaterThanOrEqual(2);
    expect(inC.length).toBeGreaterThanOrEqual(4);
    const n = await proposedCount(db, run);
    await o.call("placement_run_approve", run, n);

    // 1. a member chooses a tribe for themselves between the plan and the placing
    const chooser = inC[0];
    await asUser(db, chooser, "match_me", true);
    await asUser(db, chooser, "choose_tribe", w.C.tribe, true, "cov-1");
    // 2. a member withdraws their consent to be matched, which also removes their form
    const withdrew = inC[1];
    await db.admin.query(
      "insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', false, 't')",
      [withdrew],
    );
    // 3. the Sunday tribe is closed
    await db.admin.query(
      "update public.tribes set status = 'closed' where id = $1",
      [w.D.tribe],
    );
    // 4. nine members take Mid's seats by other routes, so there is no room for all that were planned
    for (let i = 0; i < 9; i++)
      await k.seat(w.C.tribe, season, `Walkin${tag}${i}`, {
        profile: { times: ["weeknight-evening"], faith: "established" },
      });

    for (let i = 0; i < 20; i++)
      if ((await o.call("placement_run_place", run)).left === 0) break;
    const by = Object.fromEntries(
      (
        await rows(
          db,
          "select person_id, status, reason from public.placement_items where run_id = $1 and person_id = any($2::uuid[])",
          [run, [chooser, withdrew, ...inD]],
        )
      ).map((r) => [r.person_id, r]),
    );
    expect(by[chooser]).toMatchObject({
      status: "skipped",
      reason: "chose_own",
    });
    expect(["needs_form", "no_consent"]).toContain(by[withdrew].reason);
    expect(by[withdrew].status).toBe("skipped");
    for (const p of inD)
      expect(by[p]).toMatchObject({
        status: "skipped",
        reason: "tribe_closed",
      });
    // the tribe never ends fuller than it was told it could be, keeping the church's free seat
    const active = (
      await rows(
        db,
        "select count(*)::int c from public.tribe_members where tribe_id = $1 and status = 'active'",
        [w.C.tribe],
      )
    )[0].c;
    expect(active).toBeLessThanOrEqual(12 - 1);
    const skippedFull = await rows(
      db,
      "select count(*)::int c from public.placement_items where run_id = $1 and reason in ('tribe_full', 'tribe_changed')",
      [run],
    );
    expect(skippedFull[0].c).toBeGreaterThan(0); // the matching engine's own rules say the tribe can take no more
    // a person who was left out got no email and no seat from the run
    for (const p of [chooser, withdrew, ...inD]) {
      expect(
        (
          await rows(
            db,
            "select count(*)::int c from public.messages where person_id = $1 and template like 'placement%' and created_at >= (select created_at from public.placement_runs where id = $2)",
            [p, run],
          )
        )[0].c,
      ).toBe(0);
    }
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.tribe_members where person_id = $1 and placed_by_run = $2",
          [chooser, run],
        )
      )[0].c,
    ).toBe(0);
    expect(
      (
        await rows(
          db,
          "select status from public.placement_runs where id = $1",
          [run],
        )
      )[0].status,
      // (a run closes when there is nobody left to tell, which is the case when every tribe it planned lost all its members)
    ).toMatch(/^(placed|closed)$/);
    // the run's own count of who was told is the people it did place
    const told = (
      await rows(db, "select told from public.placement_runs where id = $1", [
        run,
      ])
    )[0].told;
    expect(told).toBe(
      (
        await rows(
          db,
          "select count(*)::int c from public.placement_items where run_id = $1 and status = 'placed'",
          [run],
        )
      )[0].c,
    );
  });

  it("does nothing while the switch is Off, and nothing for a run made under a different switch", async () => {
    await cancelOpen();
    await db.admin.query(
      "update public.placement_runs set status = 'closed', closed_at = now() where status in ('placed')",
    );
    await world();
    const run = await planRun(o, {});
    await resolveAll(db, o, run, "keep");
    await o.call("placement_run_approve", run, await proposedCount(db, run));
    await o.call("placement_settings_save", JSON.stringify({ mode: "off" }));
    await expect(o.call("placement_run_place", run)).rejects.toThrow(
      /switched Off/,
    );
    await o.call(
      "placement_settings_save",
      JSON.stringify({ mode: "rehearsal" }),
    );
    await expect(o.call("placement_run_place", run)).rejects.toThrow(
      /switch no longer matches/,
    );
    await o.call("placement_settings_save", JSON.stringify({ mode: "on" }));
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.tribe_members where placed_by_run = $1",
          [run],
        )
      )[0].c,
    ).toBe(0);
    await o.call("placement_undo", run);
  });
});

describe("a rehearsal", () => {
  it("writes what it would send into the log as skipped rows, seats nobody, sends nothing, and closes", async () => {
    await cancelOpen();
    const w = await world();
    await o.call(
      "placement_settings_save",
      JSON.stringify({ mode: "rehearsal" }),
    );
    try {
      const seatsBefore = (
        await rows(db, "select count(*)::int c from public.tribe_members")
      )[0].c;
      const { run, n } = await placeRun(db, o, {});
      expect(
        (await rows(db, "select count(*)::int c from public.tribe_members"))[0]
          .c,
      ).toBe(seatsBefore);
      expect(
        (
          await rows(
            db,
            "select status, rehearsal, told from public.placement_runs where id = $1",
            [run],
          )
        )[0],
      ).toEqual({ status: "closed", rehearsal: true, told: n });
      const mine = await rows(
        db,
        "select status, error, reply_token, force_channel from public.messages where template = 'placement_your_tribe' and dedupe_key like $1",
        [`placement-rehearsal:${run}:%`],
      );
      expect(mine.length).toBe(n);
      for (const m of mine)
        expect(m).toMatchObject({
          status: "skipped",
          reply_token: null,
          force_channel: "email",
        });
      expect(
        (
          await rows(
            db,
            "select count(*)::int c from public.messages where status = 'queued' and dedupe_key like $1",
            [`placement-rehearsal:${run}:%`],
          )
        )[0].c,
      ).toBe(0);
      const teams = await rows(
        db,
        "select person_id, params, status from public.messages where template = 'placement_your_team' and dedupe_key like $1",
        [`placement-rehearsal-team:${run}:%`],
      );
      expect(teams.length).toBeGreaterThan(0);
      for (const t of teams) {
        expect(t.status).toBe("skipped");
        expect(t.params.rehearsal).toBe(true);
        expect([w.C.leader.id, w.C.assistant!.id, w.D.leader.id]).toContain(
          t.person_id,
        );
        for (const m of t.params.members)
          expect(Object.keys(m).sort()).toEqual(["name", "withheld"]);
      }
      expect(
        (
          await rows(
            db,
            "select count(*)::int c from public.placement_tokens where person_id = any($1::uuid[])",
            [w.mem.map((m) => m.id)],
          )
        )[0].c,
      ).toBe(0);
      expect(
        (
          await rows(
            db,
            "select count(*)::int c from public.match_runs r join public.placement_items i on i.person_id = r.person_id where i.run_id = $1 and r.ran_at >= (select created_at from public.placement_runs where id = $1)",
            [run],
          )
        )[0].c,
      ).toBe(0);
      // and no member is left in the grace period or out of the pool because of it
      for (const m of w.mem)
        expect(
          (
            await rows(db, "select public.placement_pool_reason($1, $2) as r", [
              m.id,
              season,
            ])
          )[0].r,
        ).toBeNull();
    } finally {
      await o.call("placement_settings_save", JSON.stringify({ mode: "on" }));
    }
  });
});

describe("the ordinary routes are untouched", () => {
  it("still queues the standard welcome and 'someone joined' emails when a member chooses a tribe for themselves", async () => {
    await cancelOpen();
    await db.admin.query(
      "update public.placement_runs set status = 'closed', closed_at = now() where status = 'placed'",
    );
    const w = await world(3, 0);
    const m = w.mem[0].id;
    await asUser(db, m, "match_me", true);
    await asUser(db, m, "choose_tribe", w.C.tribe, true, "cov-1");
    const tm = (
      await rows(
        db,
        "select id, placement_source, confirmed_at, placed_by_run from public.tribe_members where person_id = $1",
        [m],
      )
    )[0];
    expect(tm).toMatchObject({
      placement_source: "self",
      confirmed_at: null,
      placed_by_run: null,
    });
    const std = await rows(
      db,
      "select dedupe_key from public.messages where dedupe_key = $1 or dedupe_key like $2",
      [`welcome:${tm.id}`, `newmember:${tm.id}:%`],
    );
    expect(std.length).toBeGreaterThanOrEqual(2);
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.messages where person_id = $1 and template like 'placement%'",
          [m],
        )
      )[0].c,
    ).toBe(0);
  });

  it("stops the reminder and the link when a placed member gives up the seat the ordinary way", async () => {
    await cancelOpen();
    await world();
    const { run } = await placeRun(db, o, {});
    const seat = (
      await rows(
        db,
        "select id, person_id from public.tribe_members where placed_by_run = $1 and status = 'active' limit 1",
        [run],
      )
    )[0];
    const link = (await linkFor(db, seat.person_id))!;
    expect((await anon(db, "worker_placed_info", wt, link)).found).toBe(true);
    await asUser(db, seat.person_id, "release_my_seat", "Work travel");
    const waiting = await rows(
      db,
      "select status, error, reply_token from public.messages where dedupe_key in ($1, $2)",
      [`placement:${seat.id}`, `placement-reminder:${seat.id}`],
    );
    expect(waiting.length).toBe(2);
    for (const w of waiting)
      expect(w).toMatchObject({
        status: "skipped",
        error: "released",
        reply_token: null,
      });
    expect(await anon(db, "worker_placed_info", wt, link)).toEqual({
      found: false,
    });
    await o.call("placement_undo", run);
  });
});

describe("the heartbeat", () => {
  it("does nothing at all while the switch is Off, and refuses a wrong token", async () => {
    await o.call("placement_settings_save", JSON.stringify({ mode: "off" }));
    expect(await anon(db, "worker_placement_tick", wt)).toEqual({
      mode: "off",
    });
    await expectCode(
      anon(db, "worker_placement_tick", "wrong-token-wrong-token-wrong-token"),
      "42501",
    );
    await expectCode(
      anon(db, "worker_assistant_tick", "wrong-token-wrong-token-wrong-token"),
      "42501",
    );
    await o.call("placement_settings_save", JSON.stringify({ mode: "on" }));
  });

  it("carries on placing an approved run when the page was closed, queues each leader's email when it is due, and tidies the links", async () => {
    await cancelOpen();
    await db.admin.query(
      "update public.placement_runs set status = 'closed', closed_at = now() where status in ('placed')",
    );
    const w = await world();
    const run = await planRun(o, {});
    await resolveAll(db, o, run, "keep");
    const n = await proposedCount(db, run);
    await o.call("placement_run_approve", run, n);
    let guard = 0;
    while (
      (
        await rows(
          db,
          "select status from public.placement_runs where id = $1",
          [run],
        )
      )[0].status !== "placed" &&
      guard++ < 20
    )
      await anon(db, "worker_placement_tick", wt);
    expect(
      (
        await rows(
          db,
          "select status from public.placement_runs where id = $1",
          [run],
        )
      )[0].status,
      // (a run closes when there is nobody left to tell, which is the case when every tribe it planned lost all its members)
    ).toMatch(/^(placed|closed)$/);
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.tribe_members where placed_by_run = $1",
          [run],
        )
      )[0].c,
    ).toBe(n);
    // the emails go; an hour on, the links in them are cleared; an expired link is deleted; the leaders are told once the hold-off has passed
    await db.admin.query(
      "update public.messages set status = 'sent', sent_at = now() - interval '27 hours' where template in ('placement_your_tribe', 'placement_reminder')",
    );
    const someone = (
      await rows(db, "select token_hash from public.placement_tokens limit 1")
    )[0];
    await db.admin.query(
      "update public.placement_tokens set expires_at = now() - interval '1 day' where token_hash = $1",
      [someone.token_hash],
    );
    const res = await anon(db, "worker_placement_tick", wt);
    expect(res.mode).toBe("on");
    expect(res.teams).toBeGreaterThan(0);
    expect(res.cleared).toBeGreaterThanOrEqual(2 * n);
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.messages where reply_token is not null and template like 'placement%'",
        )
      )[0].c,
    ).toBe(0);
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.placement_tokens where token_hash = $1",
          [someone.token_hash],
        )
      )[0].c,
    ).toBe(0);
    expect(
      (
        await rows(
          db,
          "select count(*)::int c from public.messages where template = 'placement_your_team' and person_id = any($1::uuid[])",
          [[w.C.leader.id, w.C.assistant!.id, w.D.leader.id]],
        )
      )[0].c,
    ).toBeGreaterThanOrEqual(3);
    // a second beat finds nothing more to do
    expect(await anon(db, "worker_placement_tick", wt)).toMatchObject({
      mode: "on",
      batches: 0,
      teams: 0,
      cleared: 0,
    });
  });
});
