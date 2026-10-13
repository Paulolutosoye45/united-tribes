import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resealAll, safeToRetire } from "../../src/lib/crypto/reseal";
import { open, seal, sealedWith } from "../../src/lib/crypto/seal";
import { kit, type Kit } from "./builders";
import { createTestDb, type Row, type TestDb } from "./helpers";

// Changing the key that seals private notes, against the real tables.

const key = (n: number) => Buffer.alloc(32, n).toString("base64");
const OLD = `k1:${key(1)}`;
const BOTH = `k2:${key(2)},k1:${key(1)}`;
const NEW_ONLY = `k2:${key(2)}`;

let db: TestDb;
let k: Kit;
const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;

beforeAll(async () => {
  db = await createTestDb();
  k = await kit(db);
});
afterAll(async () => {
  await db?.close();
});

describe("moving sealed notes to a new key", () => {
  it("rewrites every old note in every place, leaves the rest, and the app can still read them", async () => {
    const S = (await sql("select id from public.seasons order by starts_on limit 1"))[0].id as string;
    const { tribe } = await k.tribe(S, { name: "Reseal tribe" });
    const a = await k.seat(tribe, S, "Ada");
    const b = await k.seat(tribe, S, "Bisi");
    await sql("update public.member_profiles set support_enc = $2, leader_note_enc = $3 where person_id = $1", [
      a.id,
      seal(JSON.stringify({ chips: ["quiet"], note: "Evenings are hard." }), `support:${a.id}`, OLD),
      seal("Call me Ada.", `leadernote:${a.id}`, OLD),
    ]);
    await sql("update public.member_profiles set support_enc = $2 where person_id = $1", [b.id, seal(JSON.stringify({ chips: [], note: "Already new." }), `support:${b.id}`, BOTH)]);
    const oldDraft = seal(JSON.stringify({ supportChips: [], supportNote: "A draft", leaderNote: "" }), `draft:${a.id}`, OLD);
    await sql("insert into public.intake_drafts (person_id, step, answers, sealed) values ($1, 'about', '{}'::jsonb, $2) on conflict (person_id) do update set sealed = excluded.sealed", [a.id, oldDraft]);
    const bBefore = (await sql("select support_enc from public.member_profiles where person_id = $1", [b.id]))[0].support_enc as string;

    const look = await resealAll(db.admin, BOTH);
    expect(look.reduce((n, r) => n + r.resealed, 0)).toBe(3);
    expect((await sql("select support_enc from public.member_profiles where person_id = $1", [a.id]))[0].support_enc).toSatisfy((t: string) => sealedWith(t) === "k1");

    const done = await resealAll(db.admin, BOTH, { apply: true });
    expect(done.reduce((n, r) => n + r.resealed, 0)).toBe(3);
    expect(safeToRetire(done, true)).toBe(true);

    const rows = await sql("select person_id, support_enc, leader_note_enc from public.member_profiles where person_id in ($1, $2)", [a.id, b.id]);
    const ada = rows.find((r) => r.person_id === a.id)!;
    expect(sealedWith(ada.support_enc as string)).toBe("k2");
    expect(open(ada.support_enc as string, `support:${a.id}`, NEW_ONLY)).toContain("Evenings are hard.");
    expect(open(ada.leader_note_enc as string, `leadernote:${a.id}`, NEW_ONLY)).toBe("Call me Ada.");
    const draft = (await sql("select sealed from public.intake_drafts where person_id = $1", [a.id]))[0].sealed as string;
    expect(open(draft, `draft:${a.id}`, NEW_ONLY)).toContain("A draft");
    // a note that was already on the new key is byte-for-byte what it was
    expect(rows.find((r) => r.person_id === b.id)!.support_enc).toBe(bBefore);

    // with the old key gone from the list, nothing is left behind
    const after = await resealAll(db.admin, NEW_ONLY);
    expect(after.every((r) => r.unreadable === 0 && r.resealed === 0)).toBe(true);
  });

  it("leaves a note nobody can open exactly as it is", async () => {
    const S = (await sql("select id from public.seasons order by starts_on limit 1"))[0].id as string;
    const { tribe } = await k.tribe(S, { name: "Lost key tribe" });
    const c = await k.seat(tribe, S, "Chidi");
    const lost = seal("x", `support:${c.id}`, `k0:${key(9)}`);
    await sql("update public.member_profiles set support_enc = $2 where person_id = $1", [c.id, lost]);
    const run = await resealAll(db.admin, BOTH, { apply: true });
    expect(run[0].unreadable).toBeGreaterThanOrEqual(1);
    expect(safeToRetire(run, true)).toBe(false);
    expect((await sql("select support_enc from public.member_profiles where person_id = $1", [c.id]))[0].support_enc).toBe(lost);
  });
});
