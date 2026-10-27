import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { feedCsv, feedTable, FEED_SCHEMA, isFeedTable, OPEN_DATA_RULES, openDataPack } from "@/lib/exports/feeds";
import { FEED_TABLES, type TableRows } from "@/lib/exports/types";
import { readZip } from "@/lib/leaders/referee/sheet/zip";

const rows = (table: TableRows["table"], r: Record<string, unknown>[], young = 0): TableRows => ({ table, rows: r, young_not_listed: young, refreshed_at: "2026-10-27T02:00:00+00:00" });

const all = (): TableRows[] => [
  rows("members", [{ season_id: "s1", season: "Season 3", member_key: "a1b2c3", tribe_id: "t1", community: "Gospel", track: "Builders", season_goal: "Lead", zone: "Mainland", degree_of_compatibility: 88, chosen_rank: 1, meetings_attended: 3, thriving: true, joined_on: "2026-09-14", form_minutes: 7.5, name: "Should Not Appear", whatsapp: "+2348031234567" }], 2),
  rows("tribes", [{ season_id: "s1", season: "Season 3", tribe_id: "t1", community: "Gospel", attendance_rate: 0.8123456, thriving_rate: 0.7, verdict: "close", has_coach: true, leader_certified: false, leader: "Chidinma Eze" }]),
  rows("weekly", [{ season_id: "s1", tribe_id: "t1", week: 1, meeting_date: "2026-09-16", held: true, present: 8 }]),
  rows("care_weekly", [{ week_start: "2026-10-19", kind: "call", opened: 3, closed: 2 }]),
  rows("messages_daily", [{ day: "2026-10-26", template: "welcome", channel: "email", status: "sent", messages: 12 }]),
  rows("ai_fields", [{ season_id: "s1", season: "Season 3", field: "community", shown: 20, kept: 12, keep_rate: 0.6 }]),
  rows("kpi_daily", [{ season_id: "s1", season: "Season 3", taken_on: "2026-10-26", week: 6, members: 40, attendance_rate: 0.8 }]),
];

describe("the coded tables", () => {
  it("has seven, each with a schema, and recognises only those", () => {
    expect(Object.keys(FEED_SCHEMA).sort()).toEqual([...FEED_TABLES].sort());
    expect(isFeedTable("members")).toBe(true);
    expect(isFeedTable("people")).toBe(false);
    expect(isFeedTable(undefined)).toBe(false);
  });

  it("holds no column for a name, a phone number, an email or free text", () => {
    for (const [name, spec] of Object.entries(FEED_SCHEMA)) {
      for (const c of spec.columns) {
        expect(c.key, `${name}.${c.key}`).not.toMatch(/(^|_)name($|_)|phone|whatsapp|email|^leader$|^coach$|^assistant$|note|story|success_sentence|statement/);
        expect(c.type, `${name}.${c.key}`).not.toBe("free");
        expect(c.about.length, `${name}.${c.key}`).toBeGreaterThan(8);
      }
    }
  });

  it("drops anything the source gave that is not in the schema, so a new column can never leak by accident", () => {
    const csv = feedCsv(all()[0]);
    expect(csv).not.toContain("Should Not Appear");
    expect(csv).not.toContain("2348031234567");
    expect(csv).toContain("a1b2c3");
    expect(feedTable("tribes", all()[1].rows).rows[0]).not.toContain("Chidinma Eze");
  });

  it("writes shares as numbers from 0 to 1 and yes/no as true or false", () => {
    const line = feedCsv(all()[1]).split("\r\n")[1];
    expect(line).toContain("0.8123");
    expect(line).toContain(",true,false,");
  });
});

describe("the Open Data Pack", () => {
  const made = new Date("2026-10-27T03:07:00Z");
  const zip = readZip(openDataPack(all(), made, "0b1f6c7a-1111-4222-8333-444455556666"));
  const text = (n: string) => zip.get(n)?.toString("utf8") ?? "";

  it("holds a CSV for each table, a dictionary, a read-me and a manifest", () => {
    expect([...zip.keys()].sort()).toEqual([...FEED_TABLES.map((t) => `${t}.csv`), "README.txt", "dictionary.csv", "manifest.json"].sort());
  });

  it("lists every file in the manifest with its row count and a SHA-256 that matches", () => {
    const m = JSON.parse(text("manifest.json"));
    expect(m.pack).toBe("open_data_pack");
    expect(m.file).toBe("0b1f6c7a-1111-4222-8333-444455556666");
    expect(m.members_under_18_not_listed).toBe(2);
    expect(m.refreshed_at).toBe("2026-10-27T02:00:00+00:00");
    expect(m.files).toHaveLength(8);
    for (const f of m.files as { file: string; sha256: string; bytes: number; rows: number }[]) {
      const data = zip.get(f.file)!;
      expect(createHash("sha256").update(data).digest("hex"), f.file).toBe(f.sha256);
      expect(data.length).toBe(f.bytes);
    }
    expect(m.files.find((f: { file: string }) => f.file === "members.csv").rows).toBe(1);
    expect(m.rules).toEqual(OPEN_DATA_RULES);
  });

  it("explains every column in the dictionary, and says the rules in the read-me", () => {
    const dict = text("dictionary.csv").split("\r\n").filter(Boolean);
    const cols = Object.values(FEED_SCHEMA).reduce((n, s) => n + s.columns.length, 0);
    expect(dict).toHaveLength(1 + cols);
    expect(dict[0].replace("﻿", "")).toBe('"table","column","type","meaning"');
    const readme = text("README.txt");
    expect(readme).toContain("Members under 18 are not listed");
    expect(readme).toContain("SHA-256");
    expect(readme).toContain("2026-10-27");
  });

  it("carries nothing a person wrote or a name, anywhere in the pack", () => {
    for (const [name, data] of zip) expect(data.toString("utf8"), name).not.toMatch(/Should Not Appear|Chidinma|2348031234567/);
  });

  it("gives the same bytes for the same tables", () => {
    expect(openDataPack(all(), made, "x").equals(openDataPack(all(), made, "x"))).toBe(true);
  });
});
