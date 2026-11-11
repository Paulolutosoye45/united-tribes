import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFER_REASONS } from "@/lib/desk/wording";
import { SWAP_REASONS } from "@/lib/growth/types";
import { NOT_SEASON_REASONS } from "@/lib/outreach/labels";
import { REASONS as PLACED_REASONS } from "@/lib/placement/answers";
import { REASONS as REMOVAL_REASONS } from "@/lib/removal/removal";

// The reason chips. Five different screens each offer a short list of reasons as chips, and the database refuses any other word. What these prove, for each of the five lists:
//   * the chips the screen offers are exactly the words the database accepts, so a person never taps a chip that the database then refuses, and no accepted reason is missing from the screen
//   * every list ends with "something else", no two chips say the same thing, and no chip blames the person who taps it

const ROOT = join(__dirname, "../..");
const sql = (file: string) => readFileSync(join(ROOT, "supabase/migrations", file), "utf8");
const words = (list: string) => [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const grab = (file: string, re: RegExp): string[] => {
  const m = sql(file).match(re);
  if (!m) throw new Error(`${file}: the reason list was not found`);
  return words(m[1]);
};

const LISTS: { name: string; where: string; chips: { key: string; label: string }[]; database: string[] }[] = [
  {
    name: "A member's answer to a leader's offer: Not this season",
    where: "20270118000100_desk_offers.sql",
    chips: OFFER_REASONS.map((r) => ({ key: r.id, label: r.label })),
    database: grab("20270118000100_desk_offers.sql", /check \(reasons <@ array\[([^\]]+)\]::text\[\]\)/),
  },
  {
    name: "A leader's request to change a member's place",
    where: "20270103000400_removal_requests.sql",
    chips: REMOVAL_REASONS.map((r) => ({ key: r.id, label: r.label })),
    database: grab("20270103000400_removal_requests.sql", /reason text not null check \(reason in \(([^)]+)\)\)/),
  },
  {
    name: "A member's reply to the reminders: Not this season",
    where: "20261213000100_reminders_broadcasts.sql",
    chips: NOT_SEASON_REASONS.map((r) => ({ key: r.value, label: r.label })),
    database: grab("20261213000100_reminders_broadcasts.sql", /reason text check \(reason in \(([^)]+)\)\)/),
  },
  {
    name: "A placed member's answer to the office",
    where: "20270114000100_placed_answers.sql",
    chips: PLACED_REASONS.map((r) => ({ key: r.key, label: r.label })),
    database: grab("20270114000100_placed_answers.sql", /reason text check \(reason in \(([^)]+)\)\)/),
  },
  {
    name: "A member's request to swap tribes",
    where: "20261205000100_learn_scale.sql",
    chips: SWAP_REASONS.map((k) => ({ key: k, label: k })),
    database: grab("20261205000100_learn_scale.sql", /reason text not null check \(reason in \(([^)]+)\)\)/),
  },
];

describe("the five lists of reason chips", () => {
  for (const l of LISTS) {
    describe(l.name, () => {
      it("offers five chips, and exactly the words the database accepts", () => {
        expect(l.chips).toHaveLength(5);
        expect(l.chips.map((c) => c.key).sort(), l.where).toEqual([...l.database].sort());
      });

      it("ends with something else, says nothing twice and blames nobody", () => {
        expect(l.chips[l.chips.length - 1].key).toBe("other");
        expect(new Set(l.chips.map((c) => c.key)).size).toBe(l.chips.length);
        expect(new Set(l.chips.map((c) => c.label.toLowerCase())).size).toBe(l.chips.length);
        for (const c of l.chips) expect(c.label, c.key).not.toMatch(/\b(your fault|you failed|wrong with you|lazy|excuse)\b/i);
      });
    });
  }

  it("is five lists, so a sixth is noticed", () => {
    expect(LISTS).toHaveLength(5);
  });
});
