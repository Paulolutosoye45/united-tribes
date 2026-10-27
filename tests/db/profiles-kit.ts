import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import type { Row, TestDb } from "./helpers";

// Shared by the Profiles stage 1 database tests: the owner and the staff, an appointed leader, a leader whose tribe has members, and
// short names for the switchboard calls.

export const FORM = { track: "builders", lead_best: "connection", community: "professionals", goal: "step-into-a-leadership-role", relation: "achieved" };
const NOTE = "Known to the church for years, asked by the pastor.";

export type Cast = {
  db: TestDb;
  k: Kit;
  o: OwnerKit;
  season: string;
  pastor: string;
  director: string;
  admin: string;
  member: string;
  /** appointed by the office; the tribe is a draft with nobody in it */
  appointed: { id: string; tribe: string };
  /** a leader with an approved tribe and two members */
  seasoned: { id: string; tribe: string; members: string[] };
  sql: (text: string, params?: unknown[]) => Promise<Row[]>;
  one: (text: string, params?: unknown[]) => Promise<Row>;
  as: (who: string, fn: string, ...params: unknown[]) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  anon: (fn: string, ...params: unknown[]) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Moves one function. Everything is Off until this is called. */
  set: (feature: string, position: string, opts?: { scope?: string; id?: string | null; roles?: string[]; reason?: string | null; holdout?: string | null }) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Back to the day it was applied: no rule, no pause, no log. */
  reset: () => Promise<void>;
  /** My page and the Details Check On for everyone, the hold as given. */
  open: (hold?: "off" | "optional" | "required") => Promise<void>;
  appoint: (name: string) => Promise<{ id: string; tribe: string }>;
  /** The notice groups On, so the notices the new functions queue can be seen. */
  noticesOn: () => Promise<void>;
};

export async function makeCast(): Promise<Cast> {
  const { db, k } = await newKit();
  const o = await makeOwner(db);
  const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
  const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
  const as = (who: string, fn: string, ...params: unknown[]) => k.call(who, fn, params);
  const anon = (fn: string, ...params: unknown[]) => k.anon(fn, params);
  const season = await k.season("Test season", 20);
  const pastor = (await k.staff("Pastor", "pastor")).id;
  const director = (await k.staff("Director", "director")).id;
  const admin = (await k.staff("Admin", "admin")).id;
  const member = (await k.person("Plain")).id;

  // The office can only appoint once the pastorate has signed off the cards and approved a fit model
  for (const c of await sql("select id from public.communities")) await as(pastor, "card_template_sign_off_community", c.id);
  for (const t of await sql("select slug from public.tribe_card_templates where status <> 'signed_off'")) await as(pastor, "card_template_sign_off", t.slug);
  await as(pastor, "leader_fit_model_activate", "lf-1");

  const goal = (await one("select id from public.season_goals where slug = $1", [FORM.goal])).id as string;
  let n = 0;
  async function appoint(name: string) {
    const p = await k.person(`${name}${++n}`);
    const r = await o.call("god_appoint_leader", p.id, JSON.stringify(FORM), goal, NOTE);
    expect(r).toMatchObject({ ok: true });
    const a = await one("select tribe_id from public.leader_appointments where person_id = $1 and status = 'active'", [p.id]);
    return { id: p.id, tribe: a.tribe_id as string };
  }

  const appointed = await appoint("Ada");
  const t = await k.tribe(season, { name: "Seasoned Tribe", track: "stewards" });
  const m1 = await k.seat(t.tribe, season, "Bola");
  const m2 = await k.seat(t.tribe, season, "Chidi");
  const seasoned = { id: t.leader.id, tribe: t.tribe, members: [m1.id, m2.id] };

  const set: Cast["set"] = (feature, position, opts = {}) =>
    o.call("god_feature_set", feature, opts.scope ?? "platform", opts.id ?? null, position, opts.roles ?? [], opts.reason ?? null, opts.holdout ?? null);
  const reset = async () => {
    await db.admin.query("delete from public.feature_settings");
    await db.admin.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
    await db.admin.query("delete from public.feature_log");
  };
  const open: Cast["open"] = async (hold = "optional") => {
    await reset();
    await set("my_page", "on", { reason: "Trying the whole road with everyone" });
    await set("details_check", "on", { reason: "Trying the whole road with everyone" });
    await set("hold_card", hold, { reason: "Trying the whole road with everyone" });
  };
  const noticesOn = async () => {
    await db.admin.query("update public.notice_settings set mode = 'on'");
  };
  return { db, k, o, season, pastor, director, admin, member, appointed, seasoned, sql, one, as, anon, set, reset, open, appoint, noticesOn };
}

/** A made-up id that is not anyone's. */
export const NOBODY = "00000000-0000-0000-0000-000000000000";
export const session = () => randomUUID();
