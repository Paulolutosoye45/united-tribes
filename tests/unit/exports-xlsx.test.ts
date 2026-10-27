import { describe, expect, it } from "vitest";
import { col, type Workbook } from "@/lib/exports/model";
import { buildXlsx, columnLetters } from "@/lib/exports/xlsx";
import { readZip } from "@/lib/leaders/referee/sheet/zip";
import { readXlsx } from "@/lib/leaders/referee/sheet/xlsx";

const made = new Date("2026-10-27T03:07:00Z");

function sample(overrides: Partial<Workbook> = {}): Workbook {
  return {
    pack: "tribe_sheet", packName: "Tribe sheet", lane: "people", title: "Tribe sheet: Alpha Tribe", subtitle: "Gospel · Season 3", made,
    by: "Ada Okafor", role: "leader", purpose: "Planning", exportId: "0b1f6c7a-1111-4222-8333-444455556666", rehearsal: false,
    facts: [["Made for", "Ada Okafor (leader)"], ["Tribe", "Alpha Tribe"]],
    notes: ["Members under 18 are counted, never listed."],
    tables: [
      {
        id: "members", sheet: "Members", title: "Members of Alpha Tribe", caption: "As your roster shows them.",
        columns: [col.text("name", "Name", "The member's name."), col.phone("whatsapp", "WhatsApp", "Shared number."), col.date("joined", "Joined", "Day they joined."), col.int("weeks", "Weeks", "Weeks."), col.percent("rate", "Attendance", "Share."), col.datetime("called", "Called", "When."), col.yesno("ok", "Called?", "Yes."), col.free("note", "Note", "Written.")],
        rows: [
          ["Ada Okafor", "+2348031234567", "2026-09-14", 3, 0.75, "2026-10-01T10:30:00Z", true, "=HYPERLINK(\"http://x\",\"click\")"],
          ["+evil", "08031234567", "2026-09-15", 2, 0.5, null, false, "Plain & <tagged> 'words'"],
          ["Bola", "call me", "not a date", "x", null, "bad", "maybe", ""],
        ],
      },
      { id: "register", sheet: "Register", title: "Register", columns: [col.text("name", "Name", "n"), col.text("w1", "Wk 1", "w")], rows: [["Ada", ""], ["", ""]], grid: true },
      { id: "empty", sheet: "Nothing", title: "Nothing", columns: [col.text("a", "A", "a")], rows: [] },
    ],
    ...overrides,
  };
}

const parts = (b: Buffer) => readZip(b);
const text = (m: Map<string, Buffer>, name: string) => m.get(name)?.toString("utf8") ?? "";

/** Every tag closes: enough to catch an unescaped character or a part written wrongly. */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  const body = xml.replace(/<\?[\s\S]*?\?>/g, "");
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0 && !/<[^>]*<|&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(body.replace(/<[^>]*>/g, ""));
}

describe("the Excel file", () => {
  const book = buildXlsx(sample());
  const p = parts(book);

  it("has every part a spreadsheet needs, each one well formed", () => {
    for (const name of ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "docProps/app.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml", "xl/tables/table1.xml"]) {
      expect(p.has(name), name).toBe(true);
    }
    for (const [name, data] of p) expect(wellFormed(data.toString("utf8")), name).toBe(true);
  });

  it("opens with About, then one tab for each table, then the dictionary", () => {
    const sheets = readXlsx(book).map((s) => s.name);
    expect(sheets).toEqual(["About", "Members", "Register", "Nothing", "Dictionary"]);
  });

  it("makes each table with rows an Excel Table over its header and rows, and leaves a grid and an empty table alone", () => {
    const tables = [...p.keys()].filter((k) => k.startsWith("xl/tables/"));
    expect(tables).toEqual(["xl/tables/table1.xml"]);
    const t = text(p, "xl/tables/table1.xml");
    expect(t).toContain('name="tbl_members"');
    expect(t).toContain('ref="A4:H7"');
    expect(t).toContain('<tableColumn id="1" name="Name"/>');
    expect(t).toContain('<tableColumn id="8" name="Note"/>');
    expect(text(p, "xl/worksheets/_rels/sheet2.xml.rels")).toContain("../tables/table1.xml");
    expect(text(p, "[Content_Types].xml")).toContain("/xl/tables/table1.xml");
  });

  it("stores no formula anywhere, and marks text that looks like one so it stays text", () => {
    for (const [name, data] of p) if (name.startsWith("xl/worksheets/")) expect(data.toString("utf8"), name).not.toMatch(/<f[ >]/);
    const styles = text(p, "xl/styles.xml");
    expect((styles.match(/quotePrefix="1"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const sheet = text(p, "xl/worksheets/sheet2.xml");
    // the "=HYPERLINK" note and the "+evil" name are strings in a guarded style (17 and 3), never numbers
    expect(sheet).toMatch(/<c r="H5" s="17" t="s">/);
    expect(sheet).toMatch(/<c r="A6" s="3" t="s">/);
    // a phone number is text in a guarded style, so Excel never drops its leading zero
    expect(sheet).toMatch(/<c r="B6" s="9" t="s">/);
  });

  it("stores numbers as numbers, days as day numbers and shares as numbers from 0 to 1", () => {
    const sheet = text(p, "xl/worksheets/sheet2.xml");
    const days = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
    expect(sheet).toContain(`<c r="C5" s="7"><v>${days(2026, 9, 14)}</v></c>`);
    expect(sheet).toContain('<c r="D5" s="4"><v>3</v></c>');
    expect(sheet).toContain('<c r="E5" s="6"><v>0.75</v></c>');
    // 2026-10-01 10:30 UTC is 11:30 in Lagos
    expect(sheet).toContain(`<c r="F5" s="8"><v>${Math.round((days(2026, 10, 1) + (11 * 60 + 30) / 1440) * 1e8) / 1e8}</v></c>`);
    // a value that does not fit its column is an empty cell, not text in a number column
    expect(sheet).toContain('<c r="C7" s="7"/>');
    expect(sheet).toContain('<c r="D7" s="4"/>');
    expect(sheet).toContain('<c r="F7" s="8"/>');
  });

  it("escapes what XML cannot hold and keeps the words as they were", () => {
    const rows = readXlsx(book).find((s) => s.name === "Members")!.rows;
    expect(rows.find((r) => r.cells[7]?.startsWith("Plain"))?.cells[7]).toBe("Plain & <tagged> 'words'");
    expect(rows.find((r) => r.cells[0] === "+evil")).toBeTruthy();
  });

  it("sets up printing: landscape, fit to the width, headings repeated, who made it in the footer", () => {
    const sheet = text(p, "xl/worksheets/sheet2.xml");
    expect(sheet).toContain('<pageSetUpPr fitToPage="1"/>');
    expect(sheet).toContain('orientation="landscape" fitToWidth="1" fitToHeight="0"');
    expect(sheet).toContain("United Tribes");
    expect(sheet).toContain("Page &amp;P of &amp;N");
    expect(sheet).toContain("Ada Okafor");
    expect(text(p, "xl/workbook.xml")).toContain("_xlnm.Print_Titles");
    expect(text(p, "xl/workbook.xml")).toContain("'Members'!$4:$4");
  });

  it("puts the file's number in the document properties, and says on every tab when it is a rehearsal", () => {
    expect(text(p, "docProps/core.xml")).toContain("0b1f6c7a-1111-4222-8333-444455556666");
    const rehearsal = parts(buildXlsx(sample({ rehearsal: true })));
    expect(text(rehearsal, "xl/worksheets/sheet1.xml")).toContain("REHEARSAL");
    expect(text(rehearsal, "xl/worksheets/sheet2.xml")).toContain("REHEARSAL");
    expect(text(rehearsal, "xl/worksheets/sheet3.xml")).toContain("REHEARSAL");
    expect(text(p, "xl/worksheets/sheet2.xml")).not.toContain("REHEARSAL");
  });

  it("tells a person what is in it and what is left out, and writes a dictionary of every column", () => {
    const about = readXlsx(book).find((s) => s.name === "About")!.rows.flatMap((r) => r.cells).join("\n");
    expect(about).toContain("Members under 18 are counted, never listed.");
    expect(about).toContain("keep it private");
    expect(about).toContain("Made for");
    const dictionary = readXlsx(book).find((s) => s.name === "Dictionary")!.rows;
    expect(dictionary).toHaveLength(1 + 8 + 2 + 1);
    expect(dictionary[1].cells).toEqual(["Members", "Name", "Text", "The member's name."]);
  });

  it("gives the same bytes for the same content", () => {
    expect(buildXlsx(sample()).equals(buildXlsx(sample()))).toBe(true);
    expect(buildXlsx(sample()).equals(buildXlsx(sample({ title: "Another" })))).toBe(false);
  });

  it("makes tab names and column names that Excel accepts", () => {
    const wb = sample();
    wb.tables = [
      { id: "a", sheet: "Same: name/with*bad?chars[x]", title: "A", columns: [col.text("x", "Name", "n"), col.text("y", "name", "n")], rows: [["1", "2"]] },
      { id: "b", sheet: "Same: name/with*bad?chars[x]", title: "B", columns: [col.text("x", "X", "n")], rows: [["1"]] },
      { id: "c", sheet: "x".repeat(60), title: "C", columns: [col.text("x", "X", "n")], rows: [["1"]] },
    ];
    const out = buildXlsx(wb);
    const names = readXlsx(out).map((s) => s.name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[\\/?*[\]:]/);
    }
    expect(text(parts(out), "xl/tables/table1.xml")).toContain('name="name (2)"');
  });

  it("refuses a table id that cannot be a name", () => {
    const wb = sample();
    wb.tables[0].id = "Bad Id!";
    expect(() => buildXlsx(wb)).toThrow();
  });

  it("names columns A, B, … Z, AA", () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(columnLetters)).toEqual(["A", "B", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
});
