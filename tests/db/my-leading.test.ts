import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// A leader can see the tribe they lead, and how many people have joined it, however they came to be a leader: through an application, by
// appointment, or because the role was given to them directly. The lookup says nothing about how they came to lead, and changes nothing.

let db: TestDb;
let k: Kit;
let season: string;
let nextSeason: string;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const leading = async (uid: string) => (await db.asUser(uid, (q) => q("select public.my_leading() as r"))).rows[0]?.r as Record<string, unknown> | null;

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  season = (await one("select id from public.seasons order by starts_on limit 1")).id as string;
  nextSeason = await k.season("Next season", -60);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("who can ask", () => {
  it("gives nothing to a member, to a pastor, or to a leader who leads nothing", async () => {
    const member = await k.person("Plain");
    const pastor = await k.staff("Pastor", "pastor");
    const empty = await k.staff("Empty", "leader");
    for (const who of [member.id, pastor.id, empty.id]) expect(await leading(who)).toBeNull();
  });

  it("is closed to visitors", async () => {
    await expectCode(db.asAnon((q) => q("select public.my_leading()")), "42501");
  });

  it("gives a person with no role nothing even if a tribe names them", async () => {
    const t = await k.tribe(season, { name: "Role taken away" });
    await sql("delete from public.person_roles where person_id = $1 and role = 'leader'", [t.leader.id]);
    expect(await leading(t.leader.id)).toBeNull();
  });
});

describe("a leader whose role was given directly (no application, no appointment)", () => {
  it("sees the tribe, its approved card and the people who joined", async () => {
    const t = await k.tribe(season, { name: "Directly led", status: "approved" });
    await k.seat(t.tribe, season, "JoinerOne");
    await k.seat(t.tribe, season, "JoinerTwo");
    expect(await sql("select 1 from public.leader_applications where person_id = $1", [t.leader.id])).toHaveLength(0);
    expect(await sql("select 1 from public.leader_appointments where person_id = $1", [t.leader.id])).toHaveLength(0);
    expect(await leading(t.leader.id)).toEqual({ role: "leader", tribe_id: t.tribe, tribe_name: "Directly led", tribe_status: "approved", members: 2, certified: true });
  });

  it("counts only the people still in the tribe", async () => {
    const t = await k.tribe(season, { name: "Some left", status: "approved" });
    await k.seat(t.tribe, season, "Stays");
    const gone = await k.seat(t.tribe, season, "Leaves");
    await sql("update public.tribe_members set status = 'released' where person_id = $1", [gone.id]);
    expect((await leading(t.leader.id))?.members).toBe(1);
  });

  it("counts what the leader's own list shows, no more", async () => {
    const t = await k.tribe(season, { name: "Same as the list", status: "approved" });
    for (const n of ["A", "B", "C"]) await k.seat(t.tribe, season, `List${n}`);
    const roster = (await db.asUser(t.leader.id, (q) => q("select public.tribe_roster_marked($1) as r", [t.tribe]))).rows[0].r as { members: unknown[] };
    expect((await leading(t.leader.id))?.members).toBe(roster.members.length);
    expect(roster.members.length).toBe(3);
  });

  it("says how a card that is not approved yet stands, with no people", async () => {
    for (const status of ["draft", "submitted", "changes_requested"]) {
      const t = await k.tribe(season, { name: `Card ${status}`, status, certified: false });
      const seen = await leading(t.leader.id);
      expect(seen).toMatchObject({ role: "leader", tribe_status: status, members: 0, certified: false });
    }
  });

  it("is not certified until the church says so", async () => {
    const t = await k.tribe(season, { name: "Not certified", status: "approved", certified: false });
    expect((await leading(t.leader.id))?.certified).toBe(false);
  });
});

describe("other leaders", () => {
  it("answers a leader who came through an application, in the same shape", async () => {
    const t = await k.tribe(season, { name: "From an application", status: "approved" });
    await sql("insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at) values ($1, 'approved_leader', 'review', '{}'::jsonb, 'test', now(), now())", [t.leader.id]);
    expect(await leading(t.leader.id)).toMatchObject({ role: "leader", tribe_name: "From an application", tribe_status: "approved" });
  });

  it("answers an appointed leader, and says nothing of the appointment", async () => {
    const t = await k.tribe(season, { name: "Chosen tribe", status: "approved" });
    await sql("insert into public.leader_appointments (person_id, tribe_id, form, granted_role, note) values ($1, $2, '{\"track\":\"builders\"}'::jsonb, true, 'known for years')", [t.leader.id, t.tribe]);
    const seen = await leading(t.leader.id);
    expect(seen).toMatchObject({ role: "leader", tribe_name: "Chosen tribe" });
    expect(JSON.stringify(seen)).not.toMatch(/appoint|known for years|builders|note|form/i);
  });

  it("answers an assistant leader about the tribe they assist", async () => {
    const t = await k.tribe(season, { name: "Assisted tribe", status: "approved", assistant: "certified" });
    await k.seat(t.tribe, season, "AssistedJoiner");
    expect(await leading(t.assistant!.id)).toEqual({ role: "assistant", tribe_id: t.tribe, tribe_name: "Assisted tribe", tribe_status: "approved", members: 1, certified: true });
  });

  it("shows the approved tribe, not a newer card, when a leader has two open", async () => {
    const t = await k.tribe(season, { name: "The one with people", status: "approved" });
    await k.seat(t.tribe, season, "Present");
    await sql(
      `insert into public.tribes (season_id, leader_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story, meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity)
       select $1, leader_id, 'draft', 'Next season draft', track_id, community_id, season_goal_id, '{}', tribe_type, story, meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity
         from public.tribes where id = $2`,
      [nextSeason, t.tribe],
    );
    expect(await leading(t.leader.id)).toMatchObject({ tribe_name: "The one with people", tribe_status: "approved", members: 1 });
  });

  it("ignores a closed tribe", async () => {
    const t = await k.tribe(season, { name: "Closed down", status: "approved" });
    await sql("update public.tribes set status = 'closed' where id = $1", [t.tribe]);
    expect(await leading(t.leader.id)).toBeNull();
  });
});

describe("what it is", () => {
  it("is read-only and says nothing about appointments, applications or notes", async () => {
    const r = await one("select p.provolatile as v, pg_get_functiondef(p.oid) as d from pg_proc p where p.proname = 'my_leading' and p.pronamespace = 'public'::regnamespace");
    expect(r.v).toBe("s");
    const text = (r.d as string).replace(/--[^\n]*/g, "");
    expect(text).not.toMatch(/appointed_by|leader_appointments|leader_applications|\bnote\b|\bform\b|\binsert\b|\bupdate\b|\bdelete\b/i);
  });

  it("changes nothing: asking leaves every card, member and leader record as it was", async () => {
    const t = await k.tribe(season, { name: "Untouched", status: "approved" });
    await k.seat(t.tribe, season, "Quiet");
    const snap = async () =>
      JSON.stringify(
        await Promise.all(["tribes", "tribe_members", "leader_applications", "leader_appointments", "person_roles", "leader_certifications"].map(async (tb) =>
          (await one(`select count(*)::int n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h from public.${tb} x`)),
        )),
      );
    const before = await snap();
    await leading(t.leader.id);
    expect(await snap()).toBe(before);
  });

  it("is open to signed-in people and closed to visitors, and keeps its search path pinned", async () => {
    const r = await one(
      "select has_function_privilege('authenticated', 'public.my_leading()', 'execute') a, has_function_privilege('anon', 'public.my_leading()', 'execute') b, (select prosecdef from pg_proc where proname = 'my_leading') s, (select proconfig::text from pg_proc where proname = 'my_leading') c",
    );
    expect(r.a).toBe(true);
    expect(r.b).toBe(false);
    expect(r.s).toBe(true);
    expect(r.c).toMatch(/search_path=/);
  });
});
