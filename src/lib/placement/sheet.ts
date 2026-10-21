import { decodeText, parseCsv } from "@/lib/leaders/referee/sheet/csv";
import {
  readXlsx,
  type Sheet,
  type SheetRow,
} from "@/lib/leaders/referee/sheet/xlsx";
import { ZipError } from "@/lib/leaders/referee/sheet/zip";

/**
 * The list of people to appoint as leaders, pasted or uploaded. One row each: their email, their stage of life, how they lead best,
 * and (if known) a community, a goal and whether they have reached it. Names are accepted in place of the codes the database uses.
 * This only reads the file. The database checks every row again, and says why any row cannot be used.
 */

export const MAX_ROWS = 300;
export const MAX_BYTES = 2 * 1024 * 1024;

export type SheetCatalogue = {
  tracks: { slug: string; name: string }[];
  communities: {
    slug: string;
    name: string;
    goals: { slug: string; title: string }[];
  }[];
};

export type SheetPerson = {
  email: string;
  track: string;
  lead_best: string;
  community?: string;
  goal?: string;
  relation?: string;
  care_cleared: boolean;
};
export type SheetProblem = { line: number; text: string };
export type SheetRead =
  | { ok: true; people: SheetPerson[]; problems: SheetProblem[] }
  | { ok: false; message: string };

type Column =
  | "email"
  | "track"
  | "lead_best"
  | "community"
  | "goal"
  | "relation"
  | "care_cleared";

const HEADERS: Record<Column, string[]> = {
  email: ["email", "email address", "e mail", "mail"],
  track: ["stage of life", "stage", "track", "life stage"],
  lead_best: [
    "how they lead best",
    "lead best",
    "leads best",
    "how they lead",
    "style",
    "leadership style",
  ],
  community: ["community", "a community they have lived in"],
  goal: ["goal", "a goal they have walked", "season goal"],
  relation: [
    "relation",
    "that goal is",
    "reached or working on",
    "goal status",
  ],
  care_cleared: [
    "cleared",
    "pastor cleared",
    "cleared for sensitive subjects",
    "care cleared",
    "sensitive cleared",
  ],
};

const norm = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const columnOf = (header: string): Column | null => {
  const h = norm(header);
  for (const [key, names] of Object.entries(HEADERS) as [Column, string[]][])
    if (names.includes(h)) return key;
  return null;
};

const LEAD: Record<string, string> = {
  structure: "structure",
  structured: "structure",
  organising: "structure",
  organizing: "structure",
  organiser: "structure",
  connection: "connection",
  connecting: "connection",
  people: "connection",
  relational: "connection",
  teaching: "teaching",
  teach: "teaching",
  teacher: "teaching",
  doing: "doing",
  action: "doing",
  practical: "doing",
  hands: "doing",
};

const RELATION: Record<string, string> = {
  achieved: "achieved",
  reached: "achieved",
  "reached it": "achieved",
  done: "achieved",
  walked: "achieved",
  "i reached it": "achieved",
  pursuing: "pursuing",
  "working on it": "pursuing",
  working: "pursuing",
  "still working": "pursuing",
  "in progress": "pursuing",
};

const YES = new Set(["yes", "y", "true", "1", "cleared", "x"]);
const NO = new Set(["", "no", "n", "false", "0", "not cleared"]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reads a .csv or .xlsx. Rows it cannot use are listed with their line, so nothing is dropped without a word. */
export function readLeaderSheet(
  fileName: string,
  bytes: Buffer,
  catalogue: SheetCatalogue,
): SheetRead {
  if (bytes.length === 0) return { ok: false, message: "That file is empty." };
  if (bytes.length > MAX_BYTES)
    return {
      ok: false,
      message:
        "That file is too large. A list of up to 300 people is well under 2 MB.",
    };
  let sheet: Sheet;
  const lower = fileName.toLowerCase();
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const sheets = readXlsx(bytes);
      sheet = sheets[0] ?? { name: "", rows: [] };
    } else if (/\.(xls|ods|numbers|pdf|docx?|png|jpe?g|gif|zip)$/.test(lower)) {
      return {
        ok: false,
        message:
          "We can read an Excel (.xlsx) or CSV file. Save the list as one of those and upload it again.",
      };
    } else {
      sheet = { name: "List", rows: parseCsv(decodeText(bytes)) };
    }
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof ZipError
          ? e.message
          : "We couldn’t read that file. Save it again as .xlsx or .csv and try once more.",
    };
  }
  return readRows(sheet.rows, catalogue);
}

/** Text pasted straight from a spreadsheet (tab separated) or a CSV. */
export function readLeaderText(
  text: string,
  catalogue: SheetCatalogue,
): SheetRead {
  if (!text.trim()) return { ok: false, message: "Paste the list first." };
  if (text.length > MAX_BYTES)
    return {
      ok: false,
      message: "That is too much text. Paste up to 300 people.",
    };
  return readRows(parseCsv(text), catalogue);
}

export function readRows(
  rows: SheetRow[],
  catalogue: SheetCatalogue,
): SheetRead {
  const at = rows.findIndex((r) =>
    r.cells.some((c) => columnOf(c) === "email"),
  );
  if (at < 0)
    return {
      ok: false,
      message:
        "We couldn’t find the columns. The first row should have titles: Email, Stage of life and How they lead best (Community, Goal, Relation and Cleared are optional).",
    };
  const index: Partial<Record<Column, number>> = {};
  rows[at].cells.forEach((c, i) => {
    const key = columnOf(c);
    if (key && index[key] === undefined) index[key] = i;
  });
  if (index.track === undefined || index.lead_best === undefined)
    return {
      ok: false,
      message:
        "The list needs a “Stage of life” column and a “How they lead best” column.",
    };

  const people: SheetPerson[] = [];
  const problems: SheetProblem[] = [];
  const seen = new Set<string>();
  const cell = (r: SheetRow, k: Column) =>
    index[k] === undefined ? "" : (r.cells[index[k]!] ?? "").trim();

  for (const r of rows.slice(at + 1)) {
    if (r.cells.every((c) => !c.trim())) continue;
    if (/^\(?example\)?/i.test(cell(r, "email"))) continue;
    if (people.length >= MAX_ROWS) {
      problems.push({
        line: r.line,
        text: `Only the first ${MAX_ROWS} people are read.`,
      });
      break;
    }
    const email = cell(r, "email").toLowerCase();
    if (!EMAIL.test(email)) {
      problems.push({ line: r.line, text: "This is not an email address." });
      continue;
    }
    if (seen.has(email)) {
      problems.push({ line: r.line, text: "This email is on the list twice." });
      continue;
    }
    const trackText = norm(cell(r, "track"));
    const track = catalogue.tracks.find(
      (t) => norm(t.slug) === trackText || norm(t.name) === trackText,
    );
    if (!track) {
      problems.push({
        line: r.line,
        text: `“${cell(r, "track").slice(0, 40)}” is not a stage of life we have.`,
      });
      continue;
    }
    const lead = LEAD[norm(cell(r, "lead_best"))];
    if (!lead) {
      problems.push({
        line: r.line,
        text: "Say how they lead best: structure, connection, teaching or doing.",
      });
      continue;
    }
    const person: SheetPerson = {
      email,
      track: track.slug,
      lead_best: lead,
      care_cleared: false,
    };

    const communityText = norm(cell(r, "community"));
    const goalText = norm(cell(r, "goal"));
    if (communityText) {
      const community = catalogue.communities.find(
        (c) => norm(c.slug) === communityText || norm(c.name) === communityText,
      );
      if (!community) {
        problems.push({
          line: r.line,
          text: `“${cell(r, "community").slice(0, 40)}” is not a community we have.`,
        });
        continue;
      }
      person.community = community.slug;
      if (goalText) {
        const goal = community.goals.find(
          (g) => norm(g.slug) === goalText || norm(g.title) === goalText,
        );
        if (!goal) {
          problems.push({
            line: r.line,
            text: `“${cell(r, "goal").slice(0, 60)}” is not a goal in that community.`,
          });
          continue;
        }
        person.goal = goal.slug;
      }
    } else if (goalText) {
      const hit = catalogue.communities
        .flatMap((c) => c.goals.map((g) => ({ c, g })))
        .find(
          (x) => norm(x.g.slug) === goalText || norm(x.g.title) === goalText,
        );
      if (!hit) {
        problems.push({
          line: r.line,
          text: `“${cell(r, "goal").slice(0, 60)}” is not a goal we have.`,
        });
        continue;
      }
      person.community = hit.c.slug;
      person.goal = hit.g.slug;
    }
    if (person.goal) {
      const relation = RELATION[norm(cell(r, "relation"))];
      if (!relation) {
        problems.push({
          line: r.line,
          text: "Say whether they reached that goal or are working on it.",
        });
        continue;
      }
      person.relation = relation;
    }
    const cleared = norm(cell(r, "care_cleared"));
    if (YES.has(cleared)) person.care_cleared = true;
    else if (!NO.has(cleared)) {
      problems.push({ line: r.line, text: "Cleared should be yes or no." });
      continue;
    }
    seen.add(email);
    people.push(person);
  }
  if (people.length === 0 && problems.length === 0)
    return { ok: false, message: "There is nobody on that list." };
  return { ok: true, people, problems };
}

/** The titles for a template the person can fill in. */
export const SHEET_HEADER = [
  "Email",
  "Stage of life",
  "How they lead best",
  "Community",
  "Goal",
  "Relation",
  "Cleared",
] as const;
