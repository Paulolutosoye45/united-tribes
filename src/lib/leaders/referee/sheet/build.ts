import { prettyPhone } from "../contact";
import { standingLabel } from "../labels";
import { writeCsv } from "./csv";
import { writeXlsx, type OutSheet } from "./xlsx";

/** The people as the database exports them. */
export type ExportPerson = { name: string; standing: string; unit: string | null; note: string | null; active: boolean; phones: string[]; emails: string[] };

export type Download = { bytes: Buffer; filename: string; type: string };

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CSV = "text/csv; charset=utf-8";

const ROLE_CHOICES = ["Pastor", "Unit head", "Ministry leader"];

const HOW_TO = [
  ["How to fill this in"],
  [""],
  ["One person on each row. Name and a phone number or an email are the two things we need. Everything else is optional."],
  [""],
  ["Name", "Their full name, as people know them (for example Pastor Ife Adeyemi)."],
  ["Role", "Pastor, Unit head or Ministry leader. Pick from the list. Only pastors and unit heads count as the pastor or unit head every application needs, unless the pastorate changes that."],
  ["Unit", "Where they serve, such as Ushers, Choir, Ota Central. Helps the pastors tell two people with the same name apart."],
  ["Phone", "Any way you write it: 0803 123 4567, +234 803 123 4567 or 803 123 4567. A second number can go in a Phone 2 column, or in the same cell after a slash."],
  ["Email", "Their email. A second one can go in an Email 2 column."],
  ["Note", "Anything the pastors should know. Only they see it."],
  [""],
  ["Keeping the list up to date"],
  [""],
  ["Upload the same file again whenever the list changes. People already on the list are matched by their phone number or email, so nobody is added twice."],
  ["Choose “Add and update” to add new people and change the ones that are in the file, without removing anyone."],
  ["Choose “Replace the list” only when the file is the whole list. People who are not in it are taken off the list (never deleted, and you can undo it)."],
  ["To take one person off the list, put No in an Active column on their row and upload with “Add and update”."],
  [""],
  ["The example rows on the People sheet say (example) in the name. They are ignored when you upload, so you can leave them or delete them."],
];

function phoneCell(norm: string, forCsv: boolean): string {
  if (!norm.startsWith("+234")) return forCsv ? `00${norm.slice(1)}` : norm;
  // Written the way people write it, starting with 0: a spreadsheet keeps that and never mistakes it for a formula
  return `0${prettyPhone(norm).slice(5)}`;
}

/** The blank form people fill in. */
export function buildTemplate(format: "xlsx" | "csv"): Download {
  const header = ["Name", "Role", "Unit", "Phone", "Email", "Note"];
  const rows = [
    ["(example) Pastor Jane Doe", "Pastor", "Ota Central", "0803 123 4567", "jane.doe@example.org", ""],
    ["(example) Brother John Smith", "Unit head", "Ushers", "0805 987 6543", "", "Also on WhatsApp"],
  ];
  if (format === "csv") return { bytes: writeCsv(header, rows), filename: "pastors-and-unit-heads-template.csv", type: CSV };
  const people: OutSheet = { name: "People", header, rows, widths: [30, 18, 22, 20, 30, 34], choices: { column: 1, values: ROLE_CHOICES }, mutedRows: [0, 1] };
  const how: OutSheet = { name: "How to fill this in", header: [], rows: HOW_TO, widths: [28, 100], plain: true };
  return { bytes: writeXlsx([people, how]), filename: "pastors-and-unit-heads-template.xlsx", type: XLSX };
}

/** The whole list, in the shape that is uploaded, so it can be edited and put back. */
export function buildExport(people: ExportPerson[], format: "xlsx" | "csv", dateStamp: string): Download {
  const phones = Math.max(2, ...people.map((p) => p.phones.length));
  const emails = Math.max(2, ...people.map((p) => p.emails.length));
  const header = [
    "Name", "Role", "Unit",
    ...Array.from({ length: phones }, (_, i) => (i === 0 ? "Phone" : `Phone ${i + 1}`)),
    ...Array.from({ length: emails }, (_, i) => (i === 0 ? "Email" : `Email ${i + 1}`)),
    "Note", "Active",
  ];
  const forCsv = format === "csv";
  const rows = people.map((p) => [
    p.name,
    standingLabel(p.standing),
    p.unit ?? "",
    ...Array.from({ length: phones }, (_, i) => (p.phones[i] ? phoneCell(p.phones[i], forCsv) : "")),
    ...Array.from({ length: emails }, (_, i) => p.emails[i] ?? ""),
    p.note ?? "",
    p.active ? "Yes" : "No",
  ]);
  const filename = `pastors-and-unit-heads-${dateStamp}.${format}`;
  if (forCsv) return { bytes: writeCsv(header, rows), filename, type: CSV };
  const widths = [30, 18, 22, ...Array.from({ length: phones }, () => 20), ...Array.from({ length: emails }, () => 30), 34, 10];
  return { bytes: writeXlsx([{ name: "People", header, rows, widths, choices: { column: 1, values: ROLE_CHOICES } }]), filename, type: XLSX };
}
