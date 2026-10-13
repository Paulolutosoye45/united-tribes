import { draftContext, leaderNoteContext, open, parseKeys, seal, sealedWith, supportContext } from "./seal";

/**
 * Key rotation. Private notes are sealed with the first key in DATA_ENCRYPTION_KEYS; every key in the list can open them.
 * To change keys: put the new one in front, run this, and only when it says every note is sealed with the new key take
 * the old one out of the list. Run by `npm run reseal` (a person at a terminal, never the app).
 *
 * A note is only ever rewritten after it has been opened and the new seal has been checked by opening it again, and
 * only if it has not changed in the meantime (a member saving at the same moment is left alone and counted).
 * Nothing here ever prints a note or a sealed token.
 */

/** Everything the app seals, and what each note is bound to. Add a line here when something new is sealed. */
export const SEALED_PLACES = [
  { table: "member_profiles", column: "support_enc", owner: "person_id", context: supportContext },
  { table: "member_profiles", column: "leader_note_enc", owner: "person_id", context: leaderNoteContext },
  { table: "intake_drafts", column: "sealed", owner: "person_id", context: draftContext },
] as const;

export type Verdict = "current" | "reseal" | "unreadable";

/** What to do with one sealed note. `next` is the re-sealed token when the verdict is "reseal". */
export function judge(token: string, context: string, keys: string): { verdict: Verdict; next?: string } {
  const ring = parseKeys(keys, true);
  if (!ring) return { verdict: "unreadable" };
  const plain = open(token, context, keys);
  if (plain === null) return { verdict: "unreadable" };
  if (sealedWith(token) === ring.current.id) return { verdict: "current" };
  const next = seal(plain, context, keys);
  // Never replace a note that can be read with one that cannot.
  return open(next, context, keys) === plain ? { verdict: "reseal", next } : { verdict: "unreadable" };
}

export type PlaceReport = {
  place: string;
  total: number;
  current: number;
  /** Notes sealed with an older key (and, when applied, now rewritten). */
  resealed: number;
  /** Notes that no key in the list opens. They are left exactly as they are. */
  unreadable: number;
  /** Notes someone saved while this ran, so they were left for the next run. */
  changedMeanwhile: number;
  /** How many notes each key sealed, before this run. */
  byKey: Record<string, number>;
};

type Query = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

/** Looks at every sealed note and, with `apply`, rewrites the ones that are not sealed with the current key. */
export async function resealAll(db: Query, keys: string, options: { apply: boolean } = { apply: false }): Promise<PlaceReport[]> {
  const ring = parseKeys(keys, true);
  if (!ring) throw new Error("DATA_ENCRYPTION_KEYS is not set.");
  const reports: PlaceReport[] = [];
  for (const place of SEALED_PLACES) {
    const report: PlaceReport = { place: `${place.table}.${place.column}`, total: 0, current: 0, resealed: 0, unreadable: 0, changedMeanwhile: 0, byKey: {} };
    const rows = (await db.query(`select ${place.owner} as owner, ${place.column} as token from public.${place.table} where ${place.column} is not null order by ${place.owner}`)).rows;
    for (const row of rows) {
      const token = String(row.token);
      const owner = String(row.owner);
      report.total += 1;
      const id = sealedWith(token) ?? "unknown";
      report.byKey[id] = (report.byKey[id] ?? 0) + 1;
      const result = judge(token, place.context(owner), keys);
      if (result.verdict === "current") report.current += 1;
      else if (result.verdict === "unreadable") report.unreadable += 1;
      else if (!options.apply) report.resealed += 1;
      else {
        // Compare and set: only replace the very note that was read.
        const done = await db.query(`update public.${place.table} set ${place.column} = $1 where ${place.owner} = $2 and ${place.column} = $3`, [result.next, owner, token]);
        if (done.rowCount === 1) report.resealed += 1;
        else report.changedMeanwhile += 1;
      }
    }
    reports.push(report);
  }
  return reports;
}

/**
 * Whether the older keys can be taken out of the list: after a real run, every note opens and none was left behind; after a
 * look-only run, nothing needs rewriting. Anything unreadable means stop and find out why first.
 */
export function safeToRetire(reports: PlaceReport[], applied: boolean): boolean {
  return reports.every((r) => r.unreadable === 0 && r.changedMeanwhile === 0 && (applied || r.resealed === 0));
}
