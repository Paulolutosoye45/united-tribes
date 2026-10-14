import { randomBytes } from "node:crypto";
import type { TestDb } from "./helpers";

/**
 * What a referee goes through, done directly against the database so other tests can use it. The sending service makes the link and the
 * code when a message goes out; here the database is told what they are, so the tests know them.
 */
export const secret = () => randomBytes(32).toString("hex");

/** A phone or email nobody else uses, so the rule against sharing a referee between applicants does not get in the way. */
let counter = 0;
export const uniqueEmail = (label = "referee") => `${label}-${Date.now().toString(36)}-${++counter}@example.org`;
export const uniquePhone = () => `+23480${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}`;

/** The link the sending service would have put in the message. */
export async function issueLink(db: TestDb, refId: string): Promise<string> {
  const s = secret();
  await db.admin.query(
    "update public.leader_references set token_hash = public.referee_hash($2), token_expires_at = now() + interval '30 days' where id = $1",
    [refId, s],
  );
  return s;
}

/** The code the sending service would have put in the message. */
export async function issueCode(db: TestDb, refId: string, code = "123456", minutes = 10): Promise<string> {
  await db.admin.query(
    `update public.referee_access
        set code_salt = 'salt', code_hash = public.referee_hash('salt' || $2), code_expires_at = now() + make_interval(mins => $3), code_tries = 0
      where reference_id = $1`,
    [refId, code, minutes],
  );
  return code;
}

/** Puts a person on the church's list. */
export async function listInDirectory(
  db: TestDb,
  contact: string,
  o: { name?: string; standing?: "pastor" | "unit_head" | "ministry_leader"; active?: boolean } = {},
): Promise<string> {
  const norm = (await db.admin.query("select public.referee_contact_norm($1) as n", [contact])).rows[0].n as string;
  const id = (
    await db.admin.query("insert into public.referee_directory (name, standing, active) values ($1, $2, $3) returning id", [
      o.name ?? "Pastor Listed",
      o.standing ?? "pastor",
      o.active ?? true,
    ])
  ).rows[0].id as string;
  await db.admin.query("insert into public.referee_directory_contacts (entry_id, kind, value) values ($1, $2, $3)", [
    id,
    norm.includes("@") ? "email" : "phone",
    norm,
  ]);
  return id;
}

/** The referee opens the link, asks for the code, types it: the real functions, with a known code. Returns what the page would keep. */
export async function verifyReferee(db: TestDb, refId: string, o: { net?: string; bid?: string; secondsAgo?: number } = {}) {
  const link = await issueLink(db, refId);
  const code = await issueCode(db, refId);
  const net = o.net ?? "a".repeat(64);
  const bid = o.bid ?? "b".repeat(64);
  const out = (await db.asAnon((q) => q("select public.referee_check_code($1, $2, $3, $4) as r", [link, code, net, bid]))).rows[0].r;
  if (!out.ok) throw new Error(`The code was refused: ${JSON.stringify(out)}`);
  // Open the page once with the session, as the browser does, then make it look as if the referee had taken their time
  await db.asAnon((q) => q("select public.referee_open($1, $2, $3, $4, true)", [link, out.session, net, bid]));
  const ago = o.secondsAgo ?? 300;
  await db.admin.query(
    "update public.referee_trust set verified_at = now() - make_interval(secs => $2), form_seen_at = now() - make_interval(secs => $2) where reference_id = $1",
    [refId, ago],
  );
  return { link, session: out.session as string, net, bid };
}

export type Ratings = { reliability?: number; warmth?: number; confidentiality?: number; maturity?: number };

/** A complete, honest reference. */
export async function answerAs(
  db: TestDb,
  refId: string,
  o: { rating?: number; ratings?: Ratings; concern?: string | null; secondsAgo?: number; net?: string; bid?: string; submitNet?: string; submitBid?: string } = {},
) {
  const v = await verifyReferee(db, refId, { net: o.net, bid: o.bid, secondsAgo: o.secondsAgo });
  const n = o.rating ?? 5;
  const r = { reliability: n, warmth: n, confidentiality: n, maturity: n, ...(o.ratings ?? {}) };
  const out = (
    await db.asAnon((q) =>
      q("select public.submit_reference($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r", [
        v.link, v.session, r.reliability, r.warmth, r.confidentiality, r.maturity,
        o.concern !== undefined && o.concern !== null, o.concern ?? null, o.submitNet ?? v.net, o.submitBid ?? v.bid,
      ]),
    )
  ).rows[0].r;
  return { ...v, out };
}
