import type { Row, TestDb } from "./helpers";
import type { OwnerKit } from "./activity-kit";
import type { Kit } from "./builders";

// The fingerprint of what the platform does today, for "Off must mean identical".
//
// A fixed little church is built with the platform's own functions (never one added by Profiles and the Weekly Rhythm), and the functions people
// and the office read it through are called as the people who read them. What comes back is written down in a plain form: made-up ids are
// replaced by the name of the person or tribe they belong to, times and dates by a mark, emails and long codes by a mark. The same story run
// on the database as it stood before Profiles stage 1 and on the database with everything applied and everything Off must tell the same
// thing, word for word. tests/db/golden/fingerprint-v1.json holds the first telling. It is recorded only with UT_UPTO=20261231000100
// and UT_RECORD=1, from the database before stage 1.
//
// Nothing here may call a function Profiles stage 1 added, or the story could not be told on the earlier database.

export type Fingerprint = Record<string, unknown>;

export type Story = {
  names: Map<string, string>;
  season: string;
  tribeA: string;
  tribeB: string;
  leaderA: string;
  leaderB: string;
  assistant: string;
  members: Record<string, string>;
  director: string;
  pastor: string;
  admin: string;
  coach: string;
  app: string;
  welcomeId: string;
  /** what choosing a place for the unplaced member said, asked once so that reading it later changes nothing */
  matchRun: unknown;
};

const json = (v: unknown) => JSON.stringify(v);

/** Builds the story. Everything is created through the platform's own doors where there is one. */
export async function tellStory(db: TestDb, k: Kit, o: OwnerKit): Promise<Story> {
  const names = new Map<string, string>();
  const name = <T extends { id: string }>(label: string, p: T) => (names.set(p.id, label), p);
  const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;

  const season = await k.season("Golden season", 40);
  names.set(season, "season");
  const pastor = name("pastor", await k.staff("Pastor", "pastor"));
  const director = name("director", await k.staff("Director", "director"));
  const admin = name("admin", await k.staff("Admin", "admin"));
  const coach = name("coach", await k.staff("Coach", "coach"));

  const a = await k.tribe(season, { name: "Alpha Tribe", track: "builders", coach: coach.id, assistant: "certified" });
  names.set(a.tribe, "tribeA");
  name("leaderA", a.leader);
  if (a.assistant) name("assistantA", a.assistant);
  const b = await k.tribe(season, { name: "Beta Tribe", track: "stewards", community: "professionals", slot: "sunday-afternoon" });
  names.set(b.tribe, "tribeB");
  name("leaderB", b.leader);
  // a third tribe waits for the pastor to approve it
  const c = await k.tribe(season, { name: "Gamma Tribe", status: "submitted", track: "builders", certified: false });
  names.set(c.tribe, "tribeC");
  name("leaderC", c.leader);

  const members: Record<string, string> = {};
  for (const [label, tribe, opts] of [
    ["ada", a.tribe, { degree: 92 }],
    ["bola", a.tribe, { degree: 80, profile: { gender: "male" as const, age: "41-50" } }],
    ["chidi", a.tribe, { degree: 71, profile: { social: 1 } }],
    ["dayo", b.tribe, { degree: 88 }],
  ] as const) {
    const p = name(label, await k.seat(tribe, season, label[0].toUpperCase() + label.slice(1), opts));
    members[label] = p.id;
  }
  // Someone with a profile and no tribe, so there is something to match
  const unplaced = name("eze", await k.person("Eze"));
  await k.profile(unplaced.id, season, { age: "26-32", social: -1 });
  members.eze = unplaced.id;

  // Five weeks of meetings and pulses, so the numbers have something to count
  await k.meetings(a.tribe, a.leader.id, 5, [
    [members.ada, 5],
    [members.bola, 3],
    [members.chidi, 1],
  ]);
  await k.meetings(b.tribe, b.leader.id, 3, [[members.dayo, 3]]);
  for (const w of [1, 6]) {
    await k.pulse(a.tribe, members.ada, w, 4);
    await k.pulse(a.tribe, members.bola, w, 3);
  }
  await k.pulse(a.tribe, members.chidi, 1, 2);

  // The pastor approves a tribe's card: the Tribe Card hold of a later stage sits on this write
  await k.call(pastor.id, "decide_tribe_card", [c.tribe, "approve", null]);

  // An application in its first step, for the readiness check
  const applicant = name("applicant", await k.person("Applicant"));
  const app = (
    await sql(
      "insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, 'welcome', $2::jsonb, '2026-10-v1') returning id",
      [applicant.id, json({ calling: { track: "builders", community: "professionals" } })],
    )
  )[0].id as string;

  // The leader's welcome email is queued through the platform's own door, which a later stage touches with a step on the table
  const welcomeId = (
    await sql("select public.enqueue_message($1, 'leader_welcome', $2::jsonb, null, $3) as id", [a.leader.id, json({ goal: "Grow", choose: false }), "golden-welcome"])
  )[0].id as string;

  // The unplaced member asks for a match, once (it records a run, so it is part of the story, not of reading it)
  const matchRun = await seen(db, unplaced.id, "match_me", [false]);

  // The owner opens the two Leader packs the story reads, in the way the Exports tests do
  await o.call("export_settings_save", json({ formats: ["xlsx", "csv"], deliveries: ["download"], doors: ["open_data_pack"] }), null);
  await o.call("export_pack_set", "tribe_sheet", "rehearsal", "{}", "Trying the sheet with the leaders");
  await o.call("export_settings_save", json({ people_cleared_on: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) }), "Signed by the pastor and the data lead");
  await o.call("export_pack_set", "tribe_sheet", "on", "{}", "Trying the sheet with the leaders");
  await o.call("export_pack_set", "leaders_roster", "rehearsal", "{}", "Trying the roster with the director");
  await o.call("export_pack_set", "leaders_roster", "on", "{}", "Trying the roster with the director");

  return { names, season, tribeA: a.tribe, tribeB: b.tribe, leaderA: a.leader.id, leaderB: b.leader.id, assistant: a.assistant!.id, members, director: director.id, pastor: pastor.id, admin: admin.id, coach: coach.id, app, welcomeId, matchRun };
}

/** Plain form: names for ids, marks for times, dates, emails and long codes. */
export function plain(value: unknown, names: Map<string, string>): unknown {
  const text = JSON.stringify(value ?? null);
  const swapped = text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => `<${names.get(id) ?? "id"}>`)
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?/g, "<time>")
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}(?::?\d{2})?)?/g, "<time>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<date>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\b[0-9a-f]{32,}\b/g, "<hex>");
  return JSON.parse(swapped);
}

/**
 * Lists the platform builds from groups with no order of their own (the tracks on the dashboard, the tribes in a count) come back in the order
 * the database finds them, which follows made-up ids and so differs between runs. They are told in sorted order; every other list keeps its order.
 */
const UNORDERED = /^(dashboard_|kpi_|reminders_overview_)/;
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([key, x]) => [key, sorted(x)]))
      : v;

/** The readers that give back rows, not one value. */
const SETS = new Set(["kpi_members", "kpi_tribes", "match_candidates"]);

/**
 * What a later change added to the dashboard's answer. The recording predates it, so it is set aside here, but only while it says nothing: the
 * "waiting" figure (members placed by the church who have not said yes) is zero when every seat was chosen by its member, as in this story, and
 * the funnel step "Chose a tribe" is now named "Said yes to a tribe" for the same count. A number in "waiting" would show up as a difference.
 */
function setAside(fn: string, out: unknown): unknown {
  if (fn !== "dashboard" || typeof out !== "object" || out === null) return out;
  type Holder = { waiting?: number };
  const d = JSON.parse(JSON.stringify(out)) as Holder & {
    headline?: Holder;
    tribes?: Holder[];
    supply?: Holder & { cells?: Holder[] };
    funnel?: { key: string; label: string }[];
  };
  for (const holder of [d, d.headline, d.supply, ...(d.supply?.cells ?? []), ...(d.tribes ?? [])]) if (holder && holder.waiting === 0) delete holder.waiting;
  // The step is the same step; it is now named for what it counts (members who said yes)
  for (const step of d.funnel ?? []) if (step.key === "chose" && step.label === "Said yes to a tribe") step.label = "Chose a tribe";
  return d;
}

/** Calls one function as one person and keeps what came back, or the code it refused with. */
async function seen(db: TestDb, who: string | "db" | null, fn: string, params: unknown[] = []): Promise<unknown> {
  const args = params.map((_, i) => `$${i + 1}`).join(", ");
  const sql = SETS.has(fn) ? `select to_jsonb(r) as r from public.${fn}(${args}) r` : `select public.${fn}(${args}) as r`;
  try {
    const out = await (who === "db" ? db.admin.query(sql, params) : who ? db.asUser(who, (q) => q(sql, params)) : db.asAnon((q) => q(sql, params)));
    return SETS.has(fn) ? { rows: out.rows.map((r) => r.r) } : { ok: setAside(fn, out.rows[0]?.r ?? null) };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { refused: err.code ?? "error", message: String(err.message ?? "").slice(0, 120) };
  }
}

/** The fingerprint: what each reader sees. */
export async function read(db: TestDb, s: Story): Promise<Fingerprint> {
  const m = s.members;
  const today = (await db.admin.query("select public.today_lagos()::text as d, (public.today_lagos() - 28)::text as s")).rows[0] as { d: string; s: string };
  const f: Fingerprint = {};
  // A member and what they see of their own place
  f.my_tribe_ada = await seen(db, m.ada, "my_tribe");
  f.my_tribe_leaderA = await seen(db, s.leaderA, "my_tribe");
  f.my_tribe_assistantA = await seen(db, s.assistant, "my_tribe");
  f.my_tribe_leaderB = await seen(db, s.leaderB, "my_tribe");
  f.my_tribe_eze = await seen(db, m.eze, "my_tribe");
  f.match_me_eze = s.matchRun;
  f.my_match_eze = await seen(db, m.eze, "my_match");
  f.my_match_ada = await seen(db, m.ada, "my_match");
  // The matching engine's own readers (the sending service and the office's database role call these, never a signed-in person)
  f.match_candidates_eze = await seen(db, "db", "match_candidates", [m.eze]);
  f.match_card_alpha = await seen(db, "db", "match_card", [s.tribeA]);
  f.match_card_beta = await seen(db, "db", "match_card", [s.tribeB]);
  // The people who lead and look after
  for (const [label, who] of [["leaderA", s.leaderA], ["director", s.director], ["coach", s.coach], ["admin", s.admin], ["pastor", s.pastor], ["leaderB", s.leaderB]] as const) {
    f[`tribe_roster_alpha_by_${label}`] = await seen(db, who, "tribe_roster", [s.tribeA]);
    f[`tribe_roster_marked_alpha_by_${label}`] = await seen(db, who, "tribe_roster_marked", [s.tribeA]);
  }
  f.tribe_roster_beta_by_leaderB = await seen(db, s.leaderB, "tribe_roster", [s.tribeB]);
  // The office's numbers
  for (const [label, who] of [["director", s.director], ["admin", s.admin], ["pastor", s.pastor]] as const) {
    f[`dashboard_by_${label}`] = await seen(db, who, "dashboard", [s.season]);
    f[`reminders_overview_by_${label}`] = await seen(db, who, "reminders_overview");
  }
  f.kpi_members = await seen(db, "db", "kpi_members", [s.season]);
  f.kpi_tribes = await seen(db, "db", "kpi_tribes", [s.season]);
  f.report_movement = await seen(db, "db", "report_movement", [s.season, today.s, today.d]);
  f.application_readiness = await seen(db, "db", "application_readiness", [s.app]);
  // The sheets leaders and the office take away
  f.export_tribe_sheet_by_leaderA = await seen(db, s.leaderA, "export_tribe_sheet", [s.tribeA]);
  f.export_tribe_sheet_by_leaderB = await seen(db, s.leaderB, "export_tribe_sheet", [s.tribeA]);
  f.export_leaders_roster_by_director = await seen(db, s.director, "export_leaders_roster", [s.season]);
  // What was written: the tribes' standing, the seats, and the welcome email as queued
  const rows = async (text: string, params: unknown[] = []) => (await db.admin.query(text, params)).rows;
  f.tribes = await rows(
    `select t.id, t.name, t.status, t.track_id is not null as has_track, t.published_at is not null as published, t.capacity
       from public.tribes t where t.season_id = $1 order by t.name`,
    [s.season],
  );
  f.seats = await rows("select tm.tribe_id, tm.person_id, tm.status, tm.degree, tm.contact_withheld from public.tribe_members tm where tm.season_id = $1", [s.season]);
  f.seats = (f.seats as Row[]).map((r) => ({ ...r, tribe_id: s.names.get(r.tribe_id) ?? r.tribe_id, person_id: s.names.get(r.person_id) ?? r.person_id })).sort((a, b) => `${a.tribe_id}${a.person_id}`.localeCompare(`${b.tribe_id}${b.person_id}`));
  f.welcome_message = await rows("select template, params, urgency, force_channel, dedupe_key, status, channel from public.messages where id = $1", [s.welcomeId]);
  for (const key of Object.keys(f)) if (UNORDERED.test(key)) f[key] = sorted(plain(f[key], s.names));
  return plain(f, s.names) as Fingerprint;
}
