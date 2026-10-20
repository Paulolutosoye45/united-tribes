/**
 * The ready-made Tribe Cards: one reviewed card for every goal a leader can run. The database holds them and decides who may read,
 * change and sign off (card_template_*). This file reads what it sends, says it in words, checks an edit before it is sent so the person
 * does not wait for a refusal, and builds the review sheet. A card is only live once a pastor or director has signed it off.
 */

export type TemplateStatus = "draft" | "signed_off" | "retired";
export const WAYS = ["structure", "connection", "teaching", "doing"] as const;
export type Way = (typeof WAYS)[number];

export const WAY_LABEL: Record<Way, string> = { structure: "Structure", connection: "Connection", teaching: "Teaching", doing: "Doing" };
export const DEMAND_WORD = ["Not needed", "A little", "Quite a lot", "Essential"] as const;

export const SLOTS = ["sunday-afternoon", "sunday-evening", "weeknight-evening", "saturday-morning"] as const;
export const SLOT_LABEL: Record<(typeof SLOTS)[number], string> = {
  "sunday-afternoon": "Sunday afternoon",
  "sunday-evening": "Sunday evening",
  "weeknight-evening": "A weeknight evening",
  "saturday-morning": "Saturday morning",
};
export const MODES = ["online", "in_person"] as const;
export const MODE_LABEL: Record<(typeof MODES)[number], string> = { online: "Online", in_person: "In person" };

/** What the database puts in a field nobody has written yet. A card with this in it cannot be signed off. */
export const NOT_WRITTEN = "To be written by the pastorate";

export type Template = {
  slug: string;
  title: string;
  communityId: string;
  community: string;
  goalId: string | null;
  goalActive: boolean | null;
  sort: number;
  whoFor: string;
  lovingGod: string;
  lovingOthers: string;
  lovingLife: string;
  week12: string;
  arc: [string, string, string];
  guardrail: string;
  tracks: string[];
  slot: string;
  mode: string;
  whoLeadsWell: string;
  demand: Record<Way, number>;
  sensitive: boolean;
  status: TemplateStatus;
  version: number;
  signedOffAt: string | null;
  signedOffBy: string | null;
  updatedAt: string | null;
};

export type CommunityCount = { communityId: string; slug: string; name: string; total: number; signedOff: number; draft: number; retired: number; sensitiveLeft: number };
export type TemplateList = {
  counts: { total: number; draft: number; signedOff: number; retired: number };
  communities: CommunityCount[];
  templates: Template[];
};

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const STATUSES: readonly string[] = ["draft", "signed_off", "retired"];

function template(v: unknown): Template | null {
  if (!isObject(v)) return null;
  const slug = strOrNull(v.slug);
  const title = strOrNull(v.title);
  const communityId = strOrNull(v.community_id);
  const status = typeof v.status === "string" && STATUSES.includes(v.status) ? (v.status as TemplateStatus) : null;
  if (!slug || !title || !communityId || !status) return null;
  const d = isObject(v.demand) ? v.demand : {};
  const arc = Array.isArray(v.arc) ? v.arc.map(str) : [];
  const way = (k: Way) => Math.max(0, Math.min(3, int(d[k])));
  return {
    slug,
    title,
    communityId,
    community: str(v.community),
    goalId: strOrNull(v.goal_id),
    goalActive: typeof v.goal_active === "boolean" ? v.goal_active : null,
    sort: int(v.sort),
    whoFor: str(v.who_for),
    lovingGod: str(v.loving_god),
    lovingOthers: str(v.loving_others),
    lovingLife: str(v.loving_life),
    week12: str(v.week12_outcome),
    arc: [arc[0] ?? "", arc[1] ?? "", arc[2] ?? ""],
    guardrail: str(v.guardrail),
    tracks: Array.isArray(v.tracks) ? v.tracks.filter((t): t is string => typeof t === "string") : [],
    slot: str(v.rhythm_slot),
    mode: str(v.rhythm_mode),
    whoLeadsWell: str(v.who_leads_well),
    demand: { structure: way("structure"), connection: way("connection"), teaching: way("teaching"), doing: way("doing") },
    sensitive: v.sensitive === true,
    status,
    version: Math.max(1, int(v.version)),
    signedOffAt: strOrNull(v.signed_off_at),
    signedOffBy: strOrNull(v.signed_off_by),
    updatedAt: strOrNull(v.updated_at),
  };
}

/** Reads card_template_list. Null if it is not usable; cards that are not in the expected shape are left out. */
export function parseTemplateList(json: unknown): TemplateList | null {
  if (!isObject(json) || !Array.isArray(json.templates)) return null;
  const c = isObject(json.counts) ? json.counts : {};
  const communities: CommunityCount[] = [];
  if (Array.isArray(json.by_community)) {
    for (const x of json.by_community) {
      if (!isObject(x)) continue;
      const communityId = strOrNull(x.community_id);
      const name = strOrNull(x.name);
      if (!communityId || !name) continue;
      communities.push({
        communityId,
        slug: str(x.slug),
        name,
        total: int(x.total),
        signedOff: int(x.signed_off),
        draft: int(x.draft),
        retired: int(x.retired),
        sensitiveLeft: int(x.sensitive_left),
      });
    }
  }
  return {
    counts: { total: int(c.total), draft: int(c.draft), signedOff: int(c.signed_off), retired: int(c.retired) },
    communities,
    templates: json.templates.map(template).filter((t): t is Template => t !== null),
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<TemplateStatus, string> = { draft: "Waiting for sign-off", signed_off: "Signed off", retired: "Retired" };

/** "Structure 2, Connection 3, Teaching 1, Doing 0": what the group asks of its leader. Only a pastor or director reads it. */
export function demandLine(d: Record<Way, number>): string {
  return WAYS.map((w) => `${WAY_LABEL[w]} ${d[w]}`).join(", ");
}

/** The ways of leading this card asks the most of, in words. */
export function demandSummary(d: Record<Way, number>): string {
  const top = Math.max(...WAYS.map((w) => d[w]));
  if (top === 0) return "No particular way of leading";
  const names = WAYS.filter((w) => d[w] === top).map((w) => WAY_LABEL[w].toLowerCase());
  return `Asks most for ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`}`;
}

/** The parts of a card that still hold the placeholder, by the name a person would use. */
export function notWritten(t: Template): string[] {
  const fields: [string, string][] = [
    ["Who it is for", t.whoFor],
    ["Loving God", t.lovingGod],
    ["Loving Others", t.lovingOthers],
    ["Loving Life", t.lovingLife],
    ["The week-12 outcome", t.week12],
    ["Weeks 1 to 4", t.arc[0]],
    ["Weeks 5 to 8", t.arc[1]],
    ["Weeks 9 to 12", t.arc[2]],
    ["The guardrail", t.guardrail],
    ["Who leads it well", t.whoLeadsWell],
  ];
  return fields.filter(([, v]) => v.trim() === NOT_WRITTEN).map(([name]) => name);
}

/** The cards in a community that "sign off the rest" would sign: drafts that are not sensitive and have nothing unwritten. */
export function bulkEligible(list: TemplateList, communityId: string): Template[] {
  return list.templates.filter((t) => t.communityId === communityId && t.status === "draft" && !t.sensitive && notWritten(t).length === 0);
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export type EditFields = {
  title: string;
  who_for: string;
  loving_god: string;
  loving_others: string;
  loving_life: string;
  week12_outcome: string;
  arc_1: string;
  arc_2: string;
  arc_3: string;
  guardrail: string;
  who_leads_well: string;
  track_slugs: string[];
  rhythm_slot: string;
  rhythm_mode: string;
  demand_structure: number;
  demand_connection: number;
  demand_teaching: number;
  demand_doing: number;
  sensitive: boolean;
};

export const fieldsOf = (t: Template): EditFields => ({
  title: t.title,
  who_for: t.whoFor,
  loving_god: t.lovingGod,
  loving_others: t.lovingOthers,
  loving_life: t.lovingLife,
  week12_outcome: t.week12,
  arc_1: t.arc[0],
  arc_2: t.arc[1],
  arc_3: t.arc[2],
  guardrail: t.guardrail,
  who_leads_well: t.whoLeadsWell,
  track_slugs: [...t.tracks],
  rhythm_slot: t.slot,
  rhythm_mode: t.mode,
  demand_structure: t.demand.structure,
  demand_connection: t.demand.connection,
  demand_teaching: t.demand.teaching,
  demand_doing: t.demand.doing,
  sensitive: t.sensitive,
});

/** The words and limits the database uses for each text, so a slip is caught before it is sent. */
export const TEXT_FIELDS = [
  { key: "who_for", label: "Who it is for", min: 10, max: 160, rows: 2 },
  { key: "loving_god", label: "Loving God", min: 10, max: 200, rows: 2 },
  { key: "loving_others", label: "Loving Others", min: 10, max: 200, rows: 2 },
  { key: "loving_life", label: "Loving Life", min: 10, max: 200, rows: 2 },
  { key: "week12_outcome", label: "The week-12 outcome", min: 10, max: 200, rows: 2 },
  { key: "arc_1", label: "Weeks 1 to 4", min: 10, max: 300, rows: 3 },
  { key: "arc_2", label: "Weeks 5 to 8", min: 10, max: 300, rows: 3 },
  { key: "arc_3", label: "Weeks 9 to 12", min: 10, max: 300, rows: 3 },
  { key: "guardrail", label: "The guardrail", min: 10, max: 300, rows: 3 },
  { key: "who_leads_well", label: "Who leads it well (only the pastorate reads this)", min: 10, max: 300, rows: 3 },
] as const satisfies readonly { key: keyof EditFields; label: string; min: number; max: number; rows: number }[];

/** The first thing wrong with an edit, in words, or null. The database checks everything again. */
export function editProblem(f: EditFields, titleEditable: boolean): string | null {
  if (titleEditable) {
    const n = f.title.trim().length;
    if (n < 6 || n > 100) return "The title must be 6 to 100 characters.";
  }
  for (const t of TEXT_FIELDS) {
    const n = f[t.key].trim().length;
    if (n < t.min) return `${t.label} needs at least ${t.min} characters.`;
    if (n > t.max) return `${t.label} can be up to ${t.max} characters.`;
    if (f[t.key].trim() === NOT_WRITTEN) return `${t.label} has not been written yet.`;
  }
  if (f.track_slugs.length === 0) return "Choose at least one life stage.";
  if (!(SLOTS as readonly string[]).includes(f.rhythm_slot)) return "Choose one of the four meeting times.";
  if (!(MODES as readonly string[]).includes(f.rhythm_mode)) return "Choose online or in person.";
  const d = [f.demand_structure, f.demand_connection, f.demand_teaching, f.demand_doing];
  if (d.some((n) => !Number.isInteger(n) || n < 0 || n > 3)) return "Each way of leading is a number from 0 to 3.";
  if (d.every((n) => n === 0)) return "At least one way of leading must be above 0.";
  return null;
}

/** Only what differs from the saved card, in the names the database uses. Empty when nothing changed. */
export function editDiff(t: Template, f: EditFields, titleEditable: boolean): Partial<EditFields> {
  const before = fieldsOf(t);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(before) as (keyof EditFields)[]) {
    if (key === "title" && !titleEditable) continue;
    const a = before[key];
    const b = f[key];
    const same = Array.isArray(a) && Array.isArray(b) ? [...a].sort().join("|") === [...b].sort().join("|") : typeof b === "string" ? (a as string).trim() === b.trim() : a === b;
    if (!same) out[key] = typeof b === "string" ? b.trim() : b;
  }
  return out as Partial<EditFields>;
}

// ---------------------------------------------------------------------------
// What the actions say
// ---------------------------------------------------------------------------

/** One sentence for what signing off a whole community did. */
export function communitySentence(r: { signed: number; left: number }, name: string): string {
  const done = r.signed === 0 ? `No cards were waiting in ${name}.` : `${r.signed} ${r.signed === 1 ? "card" : "cards"} signed off in ${name}.`;
  return r.left > 0 ? `${done} ${r.left} sensitive ${r.left === 1 ? "card is" : "cards are"} left for you to sign off one at a time.` : done;
}

// ---------------------------------------------------------------------------
// The review sheet
// ---------------------------------------------------------------------------

export const SHEET_HEADER = [
  "#",
  "Community",
  "Goal (card title)",
  "Existing goal?",
  "Who it is for",
  "Loving God",
  "Loving Others",
  "Loving Life",
  "Week-12 outcome",
  "Weeks 1-4",
  "Weeks 5-8",
  "Weeks 9-12",
  "Guardrail",
  "Suits (life stages)",
  "Suggested slot",
  "Suggested mode",
  "HIDDEN: who leads it well",
  "HIDDEN: Structure",
  "HIDDEN: Connection",
  "HIDDEN: Teaching",
  "HIDDEN: Doing",
  "HIDDEN: Sensitive",
  "Pastor decision (sign off / change / retire)",
  "Pastor notes",
  "Status now",
] as const;

/** One cell. Quoted when it has a comma, quote or line break; a cell that a spreadsheet could read as a formula is made plain text. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The review sheet: every card in the order it appears on the page, with the hidden columns marked, a column for the pastor's
 * decision and notes, and where the card stands now. Opens in Excel (the file starts with a byte order mark).
 */
export function reviewSheet(list: TemplateList): string {
  const rows = list.templates.map((t, i) =>
    [
      i + 1,
      t.community,
      t.title,
      t.goalId ? "Yes" : "No",
      t.whoFor,
      t.lovingGod,
      t.lovingOthers,
      t.lovingLife,
      t.week12,
      t.arc[0],
      t.arc[1],
      t.arc[2],
      t.guardrail,
      t.tracks.join(", "),
      t.slot,
      t.mode,
      t.whoLeadsWell,
      t.demand.structure,
      t.demand.connection,
      t.demand.teaching,
      t.demand.doing,
      t.sensitive ? "Yes" : "No",
      "",
      "",
      STATUS_LABEL[t.status],
    ]
      .map(csvCell)
      .join(","),
  );
  return `﻿${[SHEET_HEADER.map(csvCell).join(","), ...rows].join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// What a leader may see of the card behind their own tribe
// ---------------------------------------------------------------------------

/** The public fields only. The database sends nothing hidden to a leader, and this reads nothing else even if it did. */
export type ReadyMade = {
  title: string;
  whoFor: string;
  lovingGod: string;
  lovingOthers: string;
  lovingLife: string;
  week12: string;
  arc: [string, string, string];
  guardrail: string;
  slot: string | null;
  mode: string | null;
};

/** Reads card_template_for_tribe. Null when there is no signed-off card for the tribe's goal, or the answer is not usable. */
export function parseReadyMade(json: unknown): ReadyMade | null {
  if (!isObject(json)) return null;
  const title = strOrNull(json.title);
  const god = strOrNull(json.loving_god);
  const others = strOrNull(json.loving_others);
  const life = strOrNull(json.loving_life);
  const arc = Array.isArray(json.arc) ? json.arc.map(str) : [];
  if (!title || !god || !others || !life || arc.length !== 3 || arc.some((a) => !a.trim())) return null;
  return {
    title,
    whoFor: str(json.who_for),
    lovingGod: god,
    lovingOthers: others,
    lovingLife: life,
    week12: str(json.week12_outcome),
    arc: [arc[0], arc[1], arc[2]],
    guardrail: str(json.guardrail),
    slot: strOrNull(json.rhythm_slot),
    mode: strOrNull(json.rhythm_mode),
  };
}

/**
 * What "Start from the ready-made card" puts in: each of the three lines the leader has not written. The database applies the same rule
 * (a line with anything in it is never touched); this lets the screen show the result without asking again.
 */
export function prefillLines(card: { god: string; others: string; life: string }, r: ReadyMade): { god: string; others: string; life: string } {
  return {
    god: card.god.trim() ? card.god : r.lovingGod,
    others: card.others.trim() ? card.others : r.lovingOthers,
    life: card.life.trim() ? card.life : r.lovingLife,
  };
}
