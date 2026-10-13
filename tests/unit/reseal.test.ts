import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { judge, resealAll, safeToRetire, SEALED_PLACES } from "@/lib/crypto/reseal";
import { open, seal, sealedWith } from "@/lib/crypto/seal";

const key = (n: number) => Buffer.alloc(32, n).toString("base64");
const OLD = `k1:${key(1)}`;
const BOTH = `k2:${key(2)},k1:${key(1)}`;
const NEW_ONLY = `k2:${key(2)}`;

describe("judging one sealed note", () => {
  it("leaves a note that is already on the current key", () => {
    const token = seal("hello", "support:a", BOTH);
    expect(judge(token, "support:a", BOTH)).toEqual({ verdict: "current" });
  });

  it("moves a note sealed with an older key, and the new seal opens with the new key alone", () => {
    const old = seal("My marriage is hard right now.", "support:a", OLD);
    const result = judge(old, "support:a", BOTH);
    expect(result.verdict).toBe("reseal");
    expect(sealedWith(result.next)).toBe("k2");
    expect(open(result.next, "support:a", NEW_ONLY)).toBe("My marriage is hard right now.");
    expect(result.next).not.toContain("marriage");
  });

  it("reports a note that no listed key opens, instead of touching it", () => {
    const old = seal("hello", "support:a", OLD);
    expect(judge(old, "support:a", NEW_ONLY).verdict).toBe("unreadable");
    expect(judge("not-a-token", "support:a", BOTH).verdict).toBe("unreadable");
  });

  it("reports a note copied onto the wrong owner", () => {
    const old = seal("hello", "support:a", OLD);
    expect(judge(old, "support:someone-else", BOTH).verdict).toBe("unreadable");
  });
});

describe("going through every sealed place", () => {
  it("knows where the app seals things", () => {
    expect(SEALED_PLACES.map((p) => `${p.table}.${p.column}`).sort()).toEqual(["intake_drafts.sealed", "member_profiles.leader_note_enc", "member_profiles.support_enc"]);
  });

  it("a look-only run writes nothing; a real run moves old notes and says when the old key can go", async () => {
    const rows: Record<string, Record<string, string>> = {
      "member_profiles.support_enc": { p1: seal("one", "support:p1", OLD), p2: seal("two", "support:p2", BOTH) },
      "member_profiles.leader_note_enc": { p1: seal("call me Folu", "leadernote:p1", OLD) },
      "intake_drafts.sealed": { p3: seal("{}", "draft:p3", OLD) },
    };
    const writes: string[] = [];
    const fake = {
      async query(text: string, params: unknown[] = []) {
        const sel = /select (\w+) as owner, (\w+) as token from public\.(\w+)/.exec(text);
        if (sel) return { rows: Object.entries(rows[`${sel[3]}.${sel[2]}`]).map(([owner, token]) => ({ owner, token })) };
        const upd = /update public\.(\w+) set (\w+) = \$1 where (\w+) = \$2 and \w+ = \$3/.exec(text);
        if (!upd) throw new Error(`unexpected: ${text}`);
        const at = rows[`${upd[1]}.${upd[2]}`];
        writes.push(`${upd[1]}.${upd[2]}`);
        if (at[String(params[1])] !== params[2]) return { rows: [], rowCount: 0 };
        at[String(params[1])] = String(params[0]);
        return { rows: [], rowCount: 1 };
      },
    };

    const look = await resealAll(fake, BOTH);
    expect(writes).toEqual([]);
    expect(look.map((r) => r.resealed)).toEqual([1, 1, 1]);
    expect(safeToRetire(look, false)).toBe(false);

    const done = await resealAll(fake, BOTH, { apply: true });
    expect(done.map((r) => r.resealed)).toEqual([1, 1, 1]);
    expect(safeToRetire(done, true)).toBe(true);
    for (const at of Object.values(rows)) for (const token of Object.values(at)) expect(sealedWith(token)).toBe("k2");
    // and every note still opens with the new key alone
    expect(open(rows["member_profiles.support_enc"].p1, "support:p1", NEW_ONLY)).toBe("one");

    const again = await resealAll(fake, NEW_ONLY, { apply: true });
    expect(again.every((r) => r.resealed === 0 && r.unreadable === 0)).toBe(true);
    expect(safeToRetire(again, true)).toBe(true);
  });

  it("does not overwrite a note someone saved while it ran, and does not call that safe", async () => {
    const original = seal("old", "support:p1", OLD);
    const fake = {
      async query(text: string) {
        if (text.startsWith("select")) return text.includes("support_enc") ? { rows: [{ owner: "p1", token: original }] } : { rows: [] };
        return { rows: [], rowCount: 0 }; // the row had changed under us
      },
    };
    const run = await resealAll(fake, BOTH, { apply: true });
    expect(run[0].changedMeanwhile).toBe(1);
    expect(run[0].resealed).toBe(0);
    expect(safeToRetire(run, true)).toBe(false);
  });

  it("counts unreadable notes and refuses to call that safe", async () => {
    const lost = seal("x", "support:p1", `k0:${key(9)}`);
    const fake = { async query(text: string) { return { rows: text.includes("support_enc") ? [{ owner: "p1", token: lost }] : [] }; } };
    const run = await resealAll(fake, BOTH);
    expect(run[0].unreadable).toBe(1);
    expect(run[0].byKey).toEqual({ k0: 1 });
    expect(safeToRetire(run, false)).toBe(false);
  });
});
