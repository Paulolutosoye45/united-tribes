import { describe, expect, it } from "vitest";
import { csvValue, toCsv } from "@/lib/exports/csv";
import { cleanDate, cleanDateTime, cleanPhone, cleanText, needsGuard } from "@/lib/exports/guard";
import { col, slug, type Table } from "@/lib/exports/model";

describe("keeping a file from running anything when it is opened", () => {
  it("spots every first character that can start a formula, spaces in front included", () => {
    for (const s of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "\n=1", "＝1", "＋1", "－1", "＠SUM", "  =HYPERLINK(\"http://x\")", '=cmd|\' /C calc\'!A0']) {
      expect(needsGuard(s), JSON.stringify(s)).toBe(true);
    }
    for (const s of ["Ada", "Plain words", "1 + 1", "a=b", "", "(+234)"]) expect(needsGuard(s), JSON.stringify(s)).toBe(false);
  });

  it("takes out control characters and the marks that reorder text on screen", () => {
    expect(cleanText("a\u0000b\u0007c‮d​e﻿f⁦g")).toBe("abcdefg");
    expect(cleanText("keeps\nnew lines\tand tabs")).toBe("keeps\nnew lines\tand tabs");
    expect(cleanText(null)).toBe("");
    expect(cleanText("x".repeat(5000), 10)).toHaveLength(10);
  });

  it("keeps only what looks like a phone number", () => {
    expect(cleanPhone("+234 803 123 4567")).toBe("+234 803 123 4567");
    expect(cleanPhone("08031234567")).toBe("08031234567");
    expect(cleanPhone("(0803) 123-4567")).toBe("(0803) 123-4567");
    for (const bad of ["call me", "=1+1", "+cmd|' /C calc'!A0", "123", "", null, undefined, "+234803123456789012345"]) expect(cleanPhone(bad), String(bad)).toBeNull();
  });

  it("reads days and moments the way the database gives them, and shows moments in Lagos time", () => {
    expect(cleanDate("2026-10-27")).toBe("2026-10-27");
    expect(cleanDate("2026-10-27T23:30:00+00:00")).toBe("2026-10-27");
    expect(cleanDate("2026-02-30")).toBeNull();
    expect(cleanDate("not a date")).toBeNull();
    expect(cleanDateTime("2026-10-27T23:30:00Z")).toBe("2026-10-28 00:30");
    expect(cleanDateTime("2026-10-27 10:00:00+00")).toBe("2026-10-27 11:00");
    expect(cleanDateTime("2026-10-27 10:00:00")).toBe("2026-10-27 11:00");
    expect(cleanDateTime("2026-10-27T10:00:00.123456+00:00")).toBe("2026-10-27 11:00");
    expect(cleanDateTime("yesterday")).toBeNull();
  });

  it("makes a file name from words: lower case, letters and digits, never empty", () => {
    expect(slug("Alpha Tribe, Season 3!")).toBe("alpha-tribe-season-3");
    expect(slug("Ọmọ Èkó")).toBe("omo-eko");
    expect(slug("***")).toBe("file");
    expect(slug("x".repeat(100))).toHaveLength(40);
  });
});

describe("the CSV a reporting tool reads", () => {
  const table: Table = {
    id: "t",
    sheet: "T",
    title: "T",
    columns: [col.text("name", "Name", "n"), col.int("n", "N", "n"), col.percent("rate", "Rate", "r"), col.date("day", "Day", "d"), col.yesno("ok", "Ok", "o"), col.phone("tel", "Tel", "t"), col.free("note", "Note", "free")],
    rows: [
      ["Ada, the \"first\"", 3, 0.7512345, "2026-09-14", true, "+2348031234567", "something a person wrote"],
      ["=HYPERLINK(\"http://x\")", "7", 1.5, "bad", "No", "=1+1", ""],
      [null, null, null, null, null, null, null],
    ],
  };

  it("leaves out free text altogether, so a feed can never carry what someone typed", () => {
    const csv = toCsv(table);
    expect(csv).not.toContain("something a person wrote");
    expect(csv.split("\r\n")[0].replace("﻿", "")).toBe("name,n,rate,day,ok,tel");
  });

  it("starts with a byte-order mark, ends lines with CR LF and quotes what needs it", () => {
    const csv = toCsv(table);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Ada, the ""first"""');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(5);
  });

  it("gives a text that could be a formula a leading apostrophe, and writes only valid numbers, days and phone numbers", () => {
    const lines = toCsv(table).split("\r\n");
    expect(lines[2]).toBe(`"'=HYPERLINK(""http://x"")",7,1.5,,false,`);
    expect(lines[1]).toBe('"Ada, the ""first""",3,0.7512,2026-09-14,true,+2348031234567');
    expect(lines[3]).toBe(",,,,,");
  });

  it("types each value by its column", () => {
    expect(csvValue(3.6, "int")).toBe("4");
    expect(csvValue("abc", "int")).toBe("");
    expect(csvValue(Infinity, "decimal")).toBe("");
    expect(csvValue("2026-10-27T10:00:00Z", "datetime")).toBe("2026-10-27 11:00");
    expect(csvValue("true", "yesno")).toBe("true");
    expect(csvValue("-5 apples", "text")).toBe("'-5 apples");
    expect(csvValue(-5, "int")).toBe("-5");
  });
});
