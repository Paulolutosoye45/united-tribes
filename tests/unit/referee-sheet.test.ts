import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fieldOf, isNo, splitContacts, standingFromText } from "@/lib/leaders/referee/sheet/columns";
import { buildExport, buildTemplate } from "@/lib/leaders/referee/sheet/build";
import { decodeText, parseCsv, sniffDelimiter, writeCsv } from "@/lib/leaders/referee/sheet/csv";
import { parseDirectoryFile, type ParseOk } from "@/lib/leaders/referee/sheet/parse";
import { columnIndex, columnLetters, numberText, readXlsx, writeXlsx } from "@/lib/leaders/referee/sheet/xlsx";
import { crc32, readZip, writeZip } from "@/lib/leaders/referee/sheet/zip";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/referee/${name}`, import.meta.url));
const ok = (r: ReturnType<typeof parseDirectoryFile>): ParseOk => {
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("zip", () => {
  it("writes what it reads back, byte for byte", () => {
    const a = Buffer.from("hello ".repeat(500));
    const b = Buffer.from([0, 1, 2, 3, 255]);
    const back = readZip(writeZip([{ name: "a.txt", data: a }, { name: "dir/b.bin", data: b }]));
    expect(back.get("a.txt")).toEqual(a);
    expect(back.get("dir/b.bin")).toEqual(b);
  });

  it("matches the standard checksum", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("refuses what is not a zip, and a damaged one, with words a person can use", () => {
    expect(() => readZip(Buffer.from("this is plainly not a zip file at all, just text"))).toThrow(/isn’t a spreadsheet/);
    const good = writeZip([{ name: "a.txt", data: Buffer.from("x".repeat(100)) }]);
    const broken = Buffer.from(good);
    broken.writeUInt32LE(0, 0); // the first local header signature
    expect(() => readZip(broken)).toThrow(/damaged/);
  });

  it("will not unpack something that claims to be enormous", () => {
    const good = writeZip([{ name: "a.txt", data: Buffer.from("x") }]);
    const bomb = Buffer.from(good);
    const eocd = bomb.length - 22;
    const dir = bomb.readUInt32LE(eocd + 16);
    bomb.writeUInt32LE(900 * 1024 * 1024, dir + 24); // uncompressed size in the directory
    expect(() => readZip(bomb)).toThrow(/too large/);
  });
});

describe("csv", () => {
  it("reads quotes, commas and line breaks inside quotes, and doubled quotes", () => {
    const rows = parseCsv('Name,Note\r\n"Ife, Pastor","said ""hi""\r\nand left"\r\nTunde,\r\n');
    expect(rows.map((r) => r.cells)).toEqual([["Name", "Note"], ["Ife, Pastor", 'said "hi"\r\nand left'], ["Tunde", ""]]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  it("skips empty lines but keeps the line numbers a person sees", () => {
    const rows = parseCsv("Name,Phone\n\nIfe,0803\n\n\nTunde,0805\n");
    expect(rows.map((r) => r.line)).toEqual([1, 3, 6]);
  });

  it("finds the separator, and decodes the older Windows text and a byte-order mark", () => {
    expect(sniffDelimiter("Name;Phone;Email")).toBe(";");
    expect(sniffDelimiter("Name\tPhone")).toBe("\t");
    expect(sniffDelimiter('"A,B",C,D')).toBe(",");
    expect(sniffDelimiter("Name")).toBe(",");
    const w = fixture("windows-1252-semicolon.csv");
    expect(decodeText(w)).toContain("Zoë Adé");
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Name,Phone")]))).toBe("Name,Phone");
  });

  it("writes a file Excel opens correctly, and never one that runs as a formula", () => {
    const out = writeCsv(["Name", "Note"], [["=HYPERLINK(\"x\")", 'He said "hi", twice'], ["+234 803", "ok"]]).toString("utf8");
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('" =HYPERLINK(""x"")"');
    expect(out).toContain('"He said ""hi"", twice"');
    expect(out).toContain('" +234 803"');
  });
});

describe("reading an Excel file", () => {
  it("turns column letters into numbers and back", () => {
    expect(columnIndex("A")).toBe(0);
    expect(columnIndex("Z")).toBe(25);
    expect(columnIndex("AA")).toBe(26);
    expect([0, 25, 26, 701, 702].map(columnLetters)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
  });

  it("writes a phone number stored as a number the way a person typed it, without an exponent or a decimal", () => {
    expect(numberText("8031112222")).toBe("8031112222");
    expect(numberText("2.348031234567E12")).toBe("2348031234567");
    expect(numberText("8031112222.0")).toBe("8031112222");
    expect(numberText("0.5")).toBe("0.5");
    expect(numberText("")).toBe("");
  });

  it("reads a file made by Excel: numbers as phones, a title row above the headings, several sheets, a hidden one", () => {
    const sheets = readXlsx(fixture("excel-style.xlsx"));
    expect(sheets.map((s) => s.name)).toEqual(["Pastors & Unit Heads", "Notes"]); // the hidden one is skipped
    const first = sheets[0].rows;
    expect(first[0].line).toBe(1);
    expect(first[1].cells.slice(0, 5)).toEqual(["S/N", "Full Name", "Position", "Dept / Unit", "Phone No."]);
    expect(first[2].cells[4]).toBe("8031112222");
  });

  it("reads a file made by LibreOffice", () => {
    const sheets = readXlsx(fixture("libreoffice-style.xlsx"));
    expect(sheets[0].rows[1].cells).toEqual(["Pastor Ife Adeyemi", "Pastor", "Ota Central", "0803 111 2222", "ife@church.org", 'Says "hello", always']);
    expect(sheets[0].rows[3].cells[5]).toBe("Uses émigré spelling");
  });

  it("reads inline strings, shared strings with rich text, booleans and sparse cells from hand-made XML", () => {
    const xml = (name: string, data: string) => ({ name, data: Buffer.from(data) });
    const zip = writeZip([
      xml("xl/workbook.xml", '<workbook xmlns:r="x"><sheets><sheet name="List" sheetId="1" r:id="rId9"/></sheets></workbook>'),
      xml("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId9" Type="t" Target="worksheets/data.xml"/></Relationships>'),
      xml("xl/sharedStrings.xml", '<sst><si><t>Name</t></si><si><r><t>Pas</t></r><r><t xml:space="preserve">tor &amp; Co</t></r><rPh><t>ignored</t></rPh></si></sst>'),
      xml(
        "xl/worksheets/data.xml",
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Phone</t></is></c></row>' +
          '<row r="4"><c r="A4" t="s"><v>1</v></c><c r="C4"><v>8031112222</v></c><c r="D4" t="b"><v>1</v></c></row></sheetData></worksheet>',
      ),
    ]);
    const [sheet] = readXlsx(zip);
    expect(sheet.rows).toEqual([
      { line: 1, cells: ["Name", "", "Phone"] },
      { line: 4, cells: ["Pastor & Co", "", "8031112222", "TRUE"] },
    ]);
  });

  it("says what is wrong with a file that is not a spreadsheet", () => {
    expect(() => readXlsx(writeZip([{ name: "a.txt", data: Buffer.from("x") }]))).toThrow(/doesn’t look like an Excel file/);
  });
});

describe("reading the titles and roles people write", () => {
  it.each([
    ["Name", "name"], ["Full Name", "name"], ["Pastor's name", "name"], ["Name of Unit Head", "name"], ["First Name", "first"], ["Surname", "last"],
    ["Role", "role"], ["Position", "role"], ["Designation", "role"], ["Unit", "unit"], ["Dept / Unit", "unit"], ["Department", "unit"], ["Ministry", "unit"],
    ["Phone", "phone"], ["Phone No.", "phone"], ["Mobile", "phone"], ["WhatsApp number", "phone"], ["GSM", "phone"], ["Phone 2", "phone"], ["Alt Phone", "phone"],
    ["Telephone (home)", "phone"], ["Email", "email"], ["E-mail", "email"], ["E-mail Address:", "email"], ["Email 2", "email"], ["Contact", "contact"],
    ["Phone / Email", "contact"], ["Notes", "note"], ["Remarks", "note"], ["Active", "active"],
  ])("reads the title %j as %s", (title, field) => {
    expect(fieldOf(title)).toBe(field);
  });

  it("leaves a title it does not know alone", () => {
    expect(fieldOf("S/N")).toBeNull();
    expect(fieldOf("Date joined")).toBeNull();
    expect(fieldOf("")).toBeNull();
  });

  it.each([
    ["Pastor", "pastor"], ["PASTOR", "pastor"], ["Pst", "pastor"], ["Senior Pastor", "pastor"], ["Assistant Pastor", "pastor"], ["Rev.", "pastor"], ["Reverend", "pastor"], ["Bishop", "pastor"],
    ["Unit Head", "unit_head"], ["unit-head", "unit_head"], ["UnitHead", "unit_head"], ["Unit Leader", "unit_head"], ["HOD", "unit_head"], ["Head of Department", "unit_head"],
    ["Department Head", "unit_head"], ["Dept. Head", "unit_head"], ["Unit Pastor", "pastor"],
    ["Ministry Leader", "ministry_leader"], ["Head of Ministry", "ministry_leader"], ["Team Lead", "ministry_leader"], ["Coordinator", "ministry_leader"], ["Leader", "ministry_leader"],
  ])("reads the role %j as %s", (text, standing) => {
    expect(standingFromText(text)).toEqual({ standing, blank: false });
  });

  it("does not guess at a role it does not clearly know, and ignores a bare honorific", () => {
    expect(standingFromText("Evangelist")).toEqual({ standing: null, blank: false });
    expect(standingFromText("Deacon in charge of nothing")).toEqual({ standing: null, blank: false });
    expect(standingFromText("")).toEqual({ standing: null, blank: true });
    expect(standingFromText("Mr")).toEqual({ standing: null, blank: true });
    expect(standingFromText("Dr.")).toEqual({ standing: null, blank: true });
  });

  it("splits one cell into the phones and emails inside it", () => {
    expect(splitContacts("0803 111 2222")).toEqual(["0803 111 2222"]);
    expect(splitContacts("08011223344 / 08055667788")).toEqual(["08011223344", "08055667788"]);
    expect(splitContacts("ife@church.org; ife.a+x@gmail.com")).toEqual(["ife@church.org", "ife.a+x@gmail.com"]);
    expect(splitContacts("0803 111 2222, ife@church.org")).toEqual(["ife@church.org", "0803 111 2222"]);
    expect(splitContacts("08011223344 or 08055667788")).toEqual(["08011223344", "08055667788"]);
    expect(splitContacts("08011223344\n08055667788")).toEqual(["08011223344", "08055667788"]);
    expect(splitContacts("  ")).toEqual([]);
    expect(splitContacts("Tel: ife@church.org.")).toContain("ife@church.org");
  });

  it("reads No in the usual ways, and anything else as yes", () => {
    for (const no of ["No", "no", "N", "FALSE", "0", "Retired", "inactive"]) expect(isNo(no)).toBe(true);
    for (const yes of ["Yes", "Y", "TRUE", "1", "", "active"]) expect(isNo(yes)).toBe(false);
  });
});

describe("turning a file into people", () => {
  it("reads the Excel-style file: finds the headings below the title, reads the numeric phones, splits two contacts in a cell, and says what it skipped", () => {
    const r = ok(parseDirectoryFile({ name: "list.xlsx", bytes: fixture("excel-style.xlsx") }));
    expect(r.sheet).toBe("Pastors & Unit Heads");
    expect(r.headerLine).toBe(3);
    expect(r.ignored).toEqual(["S/N"]);
    expect(r.sheets).toEqual([{ name: "Pastors & Unit Heads", people: 7 }, { name: "Notes", people: 1 }]);
    const by = Object.fromEntries(r.rows.map((p) => [p.name, p]));
    expect(by["Pastor Ife Adeyemi"]).toMatchObject({ line: 4, standing: "pastor", unit: "Ota Central", contacts: ["8031112222", "8051113333", "ife@church.org"] });
    expect(by["Bro. Tunde Bello"]).toMatchObject({ standing: "unit_head", contacts: ["8082223333", "tunde@church.org", "tunde.bello@gmail.com"], note: "Prefers WhatsApp" });
    expect(by["Sis. Chi Okoro"]).toMatchObject({ standing: "unit_head", contacts: ["0905 444 5555"] });
    expect(by["Mrs Kemi Ojo"]).toMatchObject({ standing: "ministry_leader", contacts: ["08011223344", "08055667788"] });
    expect(by["Rev. (Dr) Gbenga Ade"]).toMatchObject({ standing: "pastor", contacts: ["2348077778888", "gbenga@church.org"] });
    expect(by["Deacon Sam Eze"]).toMatchObject({ standing: "", roleText: "Deacon" });
    expect(r.rolesMissing).toBe(true);
    expect(r.rows.map((p) => p.line)).not.toContain(10); // the blank row
  });

  it("gives rows whose role cannot be read the role the person chooses, and only those rows", () => {
    const r = ok(parseDirectoryFile({ name: "list.xlsx", bytes: fixture("excel-style.xlsx"), fallback: "ministry_leader" }));
    const by = Object.fromEntries(r.rows.map((p) => [p.name, p]));
    expect(by["Deacon Sam Eze"].standing).toBe("ministry_leader");
    expect(by["Pastor Ife Adeyemi"].standing).toBe("pastor");
  });

  it("reads the other sheet when it is asked for, and the best one by default", () => {
    const r = ok(parseDirectoryFile({ name: "list.xlsx", bytes: fixture("excel-style.xlsx"), sheet: "Pastors & Unit Heads" }));
    expect(r.rows).toHaveLength(7);
    const notes = parseDirectoryFile({ name: "list.xlsx", bytes: fixture("excel-style.xlsx"), sheet: "Notes" });
    expect(notes.ok).toBe(false);
  });

  it("reads the LibreOffice file and the plain CSV the same way (LibreOffice stored one phone as a number, dropping its zero)", () => {
    const expected = (tunde: string) => [
      ["Pastor Ife Adeyemi", "pastor", ["0803 111 2222", "ife@church.org"]],
      ["Tunde Bello", "unit_head", [tunde]],
      ["Chi Okoro", "ministry_leader", ["chi@church.org"]],
    ];
    for (const [name, file, tunde] of [["a.xlsx", "libreoffice-style.xlsx", "8082223333"], ["a.csv", "plain.csv", "08082223333"]] as const) {
      const r = ok(parseDirectoryFile({ name, bytes: fixture(file) }));
      expect(r.rows.map((p) => [p.name, p.standing, p.contacts])).toEqual(expected(tunde));
      expect(r.rolesMissing).toBe(false);
      expect(r.rows[0].note).toBe('Says "hello", always');
    }
  });

  it("reads a Windows-1252 CSV with semicolons, accents and a quoted semicolon", () => {
    const r = ok(parseDirectoryFile({ name: "liste.csv", bytes: fixture("windows-1252-semicolon.csv") }));
    expect(r.rows.map((p) => p.name)).toEqual(["Pastor Zoë Adé", "Tunde; Bello"]);
  });

  it("copes with no headings at all when it is plainly name, phone and email", () => {
    const csv = Buffer.from("Pastor Ife,0803 111 2222,ife@church.org\nTunde Bello,0808 222 3333,tunde@church.org\n");
    const r = ok(parseDirectoryFile({ name: "x.csv", bytes: csv, fallback: "pastor" }));
    expect(r.rows.map((p) => [p.name, p.standing, p.contacts])).toEqual([
      ["Pastor Ife", "pastor", ["0803 111 2222", "ife@church.org"]],
      ["Tunde Bello", "pastor", ["0808 222 3333", "tunde@church.org"]],
    ]);
  });

  it("combines a first name and a surname column, and takes Active: No", () => {
    const csv = Buffer.from("First name,Surname,Role,Mobile,Active\nIfe,Adeyemi,Pastor,08031112222,Yes\nTunde,Bello,HOD,08082223333,No\n");
    const r = ok(parseDirectoryFile({ name: "x.csv", bytes: csv }));
    expect(r.rows[0]).toMatchObject({ name: "Ife Adeyemi", standing: "pastor" });
    expect(r.rows[0].active).toBeUndefined();
    expect(r.rows[1]).toMatchObject({ name: "Tunde Bello", active: false });
  });

  it("leaves out the template's example rows and says so", () => {
    const t = buildTemplate("xlsx");
    const csv = buildTemplate("csv");
    for (const d of [t, csv]) {
      const r = parseDirectoryFile({ name: d.filename, bytes: d.bytes });
      expect(r.ok).toBe(false); // nothing but examples
    }
    const filled = Buffer.concat([csv.bytes, Buffer.from("Pastor Real,Pastor,Ota,0803 000 1111,real@church.org,\r\n")]);
    const r = ok(parseDirectoryFile({ name: "x.csv", bytes: filled }));
    expect(r.rows.map((p) => p.name)).toEqual(["Pastor Real"]);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0].reason).toMatch(/example/i);
  });

  it("gives plain-spoken reasons for files it cannot use", () => {
    const msg = (name: string, bytes: Buffer) => {
      const r = parseDirectoryFile({ name, bytes });
      return r.ok ? "" : r.message;
    };
    expect(msg("a.csv", Buffer.alloc(0))).toMatch(/empty/);
    expect(msg("a.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]))).toMatch(/older Excel file/);
    expect(msg("a.xlsx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]))).toMatch(/protected/);
    expect(msg("a.pdf", Buffer.from("%PDF-1.4 hello"))).toMatch(/isn’t a spreadsheet/);
    expect(msg("a.xlsx", Buffer.from("not really"))).toMatch(/isn’t a real Excel file/);
    expect(msg("a.csv", Buffer.from("Colour,Size\nred,big\n"))).toMatch(/couldn’t find the columns/);
    expect(msg("a.csv", Buffer.from("Name,Phone\n"))).toMatch(/nothing in that file|no people/i);
    expect(msg("a.csv", Buffer.alloc(9 * 1024 * 1024, "a"))).toMatch(/too large/);
  });
});

describe("the template and the export", () => {
  it("makes a template that opens as a real workbook with a how-to sheet and a drop-down for the role", () => {
    const t = buildTemplate("xlsx");
    expect(t.filename).toBe("pastors-and-unit-heads-template.xlsx");
    const sheets = readXlsx(t.bytes);
    expect(sheets.map((s) => s.name)).toEqual(["People", "How to fill this in"]);
    expect(sheets[0].rows[0].cells).toEqual(["Name", "Role", "Unit", "Phone", "Email", "Note"]);
    const files = readZip(t.bytes);
    expect(files.get("xl/worksheets/sheet1.xml")!.toString()).toContain("Pastor,Unit head,Ministry leader");
  });

  it("exports the list in the shape it is uploaded in, so editing it and uploading it again changes nothing", () => {
    const people = [
      { name: "Pastor Ife Adeyemi", standing: "pastor", unit: "Ota", note: "Likes WhatsApp", active: true, phones: ["+2348031112222", "+447700900123"], emails: ["ife@church.org"] },
      { name: "Bro Tunde Bello", standing: "unit_head", unit: null, note: null, active: true, phones: [], emails: ["tunde@church.org", "t2@x.org", "t3@x.org"] },
      { name: "Sis Chi Okoro", standing: "ministry_leader", unit: "Choir", note: null, active: false, phones: ["+2348051112233"], emails: [] },
    ];
    for (const format of ["xlsx", "csv"] as const) {
      const d = buildExport(people, format, "2026-10-14");
      expect(d.filename).toBe(`pastors-and-unit-heads-2026-10-14.${format}`);
      const r = ok(parseDirectoryFile({ name: d.filename, bytes: d.bytes }));
      expect(r.rows).toHaveLength(3);
      expect(r.rows[0]).toMatchObject({ name: "Pastor Ife Adeyemi", standing: "pastor", unit: "Ota", note: "Likes WhatsApp" });
      expect(r.rows[0].contacts).toEqual(expect.arrayContaining(["ife@church.org"]));
      expect(r.rows[1].contacts).toHaveLength(3);
      expect(r.rows[2].active).toBe(false);
      expect(r.rolesMissing).toBe(false);
    }
  });

  it("writes Nigerian numbers starting with 0 so a spreadsheet keeps them, and other countries' in a form it still reads", () => {
    const d = buildExport([{ name: "A B", standing: "pastor", unit: null, note: null, active: true, phones: ["+2348031112222", "+447700900123"], emails: [] }], "csv", "x");
    const text = d.bytes.toString("utf8");
    expect(text).toContain("0803 111 2222");
    expect(text).toContain("00447700900123");
  });

  it("writes a workbook that real spreadsheet programs accept", () => {
    const bytes = writeXlsx([{ name: "A / B?", header: ["Name", "Role"], rows: [["Ife & <Co>", "Pastor"], ["", ""]], choices: { column: 1, values: ["Pastor"] } }]);
    const [s] = readXlsx(bytes);
    expect(s.name).toBe("A   B");
    expect(s.rows[1].cells[0]).toBe("Ife & <Co>");
  });
});
