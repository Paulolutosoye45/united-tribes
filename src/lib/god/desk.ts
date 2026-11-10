// The Leader Desk in God Mode (Phase 1: see): the words of the page and everything it reads from the database, read defensively. The database is the source of
// every number here; nothing is worked out on the website. No full phone number reaches any of these shapes: a number has its middle hidden, and the one
// full number a reveal returns is handled by the reveal alone and never kept.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string");

export const isDeskId = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export type DeskMode = "off" | "rehearsal" | "on";
export const parseDeskMode = (v: unknown): DeskMode => (v === "rehearsal" || v === "on" ? v : "off");

// ---------------------------------------------------------------------------
// The lists a waiting member can be on, and the pools a possible leader can be in
// ---------------------------------------------------------------------------
export const CHIPS = [
  { key: "none_shown", label: "No tribe shown", help: "The matching found no tribe to show them." },
  { key: "few_shown", label: "One or two shown", help: "The matching found fewer than three tribes for them." },
  { key: "not_chosen", label: "Has options", help: "They were shown three tribes and have not chosen one." },
  { key: "not_run", label: "Never ran the matching", help: "They finished the form but have not looked at their tribes." },
  { key: "starter", label: "Asked for a Starter tribe", help: "They said they would like a Starter tribe." },
] as const;
export type Chip = (typeof CHIPS)[number]["key"];
export const isChip = (v: unknown): v is Chip => CHIPS.some((c) => c.key === v);
export const chipLabel = (v: string): string => CHIPS.find((c) => c.key === v)?.label ?? "Waiting";

export const POOLS = [
  { key: "ready", label: "Ready now", help: "Said yes or maybe to serving, established or leading in faith, and a signal of 70 or more." },
  { key: "almost", label: "Almost", help: "Said yes or maybe to serving, with a signal of 50 or more." },
  { key: "members", label: "Members", help: "Everyone else, best signal first. Someone who said not now stays here." },
] as const;
export type Pool = (typeof POOLS)[number]["key"];
export const isPool = (v: unknown): v is Pool => POOLS.some((p) => p.key === v);
export const poolLabel = (v: string): string => POOLS.find((p) => p.key === v)?.label ?? "Members";

export const TABS = [
  { key: "waiting", label: "Waiting" },
  { key: "proposals", label: "Proposals" },
  { key: "leaders", label: "Leaders" },
] as const;
export type Tab = (typeof TABS)[number]["key"];
export const isTab = (v: unknown): v is Tab => TABS.some((t) => t.key === v);

/** What each part of the leadership signal is, and the most it can be worth. */
export const SIGNAL_PARTS = [
  { key: "willingness", label: "Willingness to serve", max: 30 },
  { key: "walk", label: "Walk of faith", max: 25 },
  { key: "reliability", label: "Showing up", max: 20 },
  { key: "named", label: "Named by others", max: 15 },
  { key: "progress", label: "Weekly steps", max: 10 },
] as const;

export const SLOTS: Record<string, string> = {
  "sunday-afternoon": "Sunday afternoon",
  "sunday-evening": "Sunday evening",
  "weeknight-evening": "Weeknight evening",
  "saturday-morning": "Saturday morning",
};
export const SLOT_KEYS = Object.keys(SLOTS);
export const ZONES: Record<string, string> = {
  "iganmu-surulere": "Iganmu and Surulere",
  mainland: "Mainland",
  "island-lekki": "Island and Lekki",
  "other-nigeria": "Elsewhere in Nigeria",
  abroad: "Abroad",
};
export const LAGOS_ZONES = ["iganmu-surulere", "mainland", "island-lekki"] as const;
export const MODES: Record<string, string> = { online: "Online", in_person: "In person", either: "Online or in person" };
export const KINDS: Record<string, string> = { mixed: "Mixed", women: "Women", men: "Men", any: "No preference" };
export const slotWord = (v: string | null): string => (v ? (SLOTS[v] ?? v) : "");
export const zoneWord = (v: string | null): string => (v ? (ZONES[v] ?? v) : "");
export const modeWord = (v: string | null): string => (v ? (MODES[v] ?? v) : "");
export const kindWord = (v: string | null): string => (v ? (KINDS[v] ?? v) : "");

export const FAITH: Record<string, string> = { exploring: "Exploring", new: "New to faith", growing: "Growing", established: "Established", leading: "Leading" };
export const SERVING: Record<string, string> = { yes: "Yes to serving", maybe: "Maybe to serving", not_now: "Not now", none: "Has not said" };

/** The sentence a draft group is described by, such as "Weeknight evening, in person, Mainland, mixed, up to 8". */
export function describeGroup(g: { slot: string; mode: string; zone: string | null; type: string; capacity: number }): string {
  const parts = [slotWord(g.slot), modeWord(g.mode).toLowerCase()];
  if (g.mode === "in_person" && g.zone) parts.push(zoneWord(g.zone));
  parts.push(`${kindWord(g.type).toLowerCase()}`, `up to ${g.capacity}`);
  return parts.join(", ");
}

export const DESK_WORDS = {
  title: "Leader Desk",
  intro:
    "Members who finished the form and still have no tribe, the groups you could form for them, and the members who could lead one. This page only shows things: nothing here sends a message, seats anyone or tells anyone.",
  off: "The Leader Desk is switched off. Turn it on in Features to use it.",
  noSeason: "There is no season open for placement, so nobody is waiting.",
  rehearsalNote: "Rehearsal. Nothing on this page sends anything in Rehearsal or in On yet: emailing a proposed group, recommending a leader and forming a tribe come next.",
  waitingEmpty: "Nobody is waiting in this list.",
  leadersEmpty: "Nobody is in this pool yet.",
  draftsEmpty: "No draft groups yet. Start one from the groups below, or make your own.",
  clustersTitle: "Groups waiting members could already fill",
  clustersHelp: "Each line is a life stage, a time, a way of meeting and a kind of group that at least this many waiting members could join. Starting a draft opens the form with those answers filled in.",
  clustersEmpty: "No group of waiting members is large enough to form yet.",
  numberHidden: "Number hidden",
  noNumber: "No number on file",
  showNumber: "Show number",
  hideNumber: "Hide number",
  numberRules: "A full number opens one at a time, between 8 am and 8 pm Lagos time, up to 60 an hour. Each opening is written down without the number.",
  signalHelp:
    "The leadership signal comes from five things the church already knows. It never looks at gender, age, area, health, care notes or how much support someone has needed.",
  noOptions: "No tribe would be shown to them",
  hasOptions: (n: number) => `${n} ${n === 1 ? "tribe" : "tribes"} would be shown to them`,
  bestFit: (name: string | null, score: number | null) => (score === null ? "No score" : `Best fit ${score}${name ? `: ${name}` : ""}`),
  waitingDays: (d: number) => (d === 0 ? "Finished today" : d === 1 ? "Waiting 1 day" : `Waiting ${d} days`),
  inDraft: (name: string) => `In the draft “${name}”`,
  fitsDraft: (name: string, score: number) => `${name}: ${score}`,
  cannotFitDraft: (name: string) => `${name}: cannot join`,
  stateWords: { ok: "Fine", fix: "Needs a change", wait: "Not yet" } as Record<string, string>,
} as const;

// ---------------------------------------------------------------------------
// The overview
// ---------------------------------------------------------------------------
export type Overview = {
  mode: DeskMode;
  season: { id: string; name: string; startsOn: string | null; weeks: number; week: number } | null;
  waiting: Record<"all" | Chip, number>;
  leaders: Record<Pool, number>;
  drafts: number;
  heldBack: number;
  minTribe: number;
  floor: number;
  callsOpen: boolean;
};

export function parseOverview(v: unknown): Overview | null {
  if (!isObj(v)) return null;
  const w = isObj(v.waiting) ? v.waiting : {};
  const l = isObj(v.leaders) ? v.leaders : {};
  const s = isObj(v.season) && isDeskId(v.season.id) ? v.season : null;
  return {
    mode: parseDeskMode(v.mode),
    season: s ? { id: String(s.id), name: text(s.name) ?? "This season", startsOn: text(s.starts_on), weeks: int(s.weeks), week: int(s.week) } : null,
    waiting: {
      all: int(w.all), none_shown: int(w.none_shown), few_shown: int(w.few_shown), not_chosen: int(w.not_chosen), not_run: int(w.not_run), starter: int(w.starter),
    },
    leaders: { ready: int(l.ready), almost: int(l.almost), members: int(l.members) },
    drafts: int(v.drafts),
    heldBack: int(v.held_back),
    minTribe: int(v.min_tribe) || 5,
    floor: int(v.floor) || 60,
    callsOpen: v.calls_open === true,
  };
}

// ---------------------------------------------------------------------------
// Waiting members
// ---------------------------------------------------------------------------
export type Reason = { code: string; text: string };
export type DraftFit = { groupId: string; name: string; degree: number; fits: boolean };
export type WaitingRow = {
  personId: string;
  name: string;
  chip: string;
  starter: boolean;
  days: number;
  community: string | null;
  goal: string | null;
  zone: string | null;
  mode: string | null;
  times: string[];
  kind: string | null;
  /** The number with its middle hidden */
  phone: string | null;
  hasNumber: boolean;
  options: number;
  best: number | null;
  bestTribe: string | null;
  block: Reason | null;
  drafts: DraftFit[];
  inDraft: string | null;
  lead: { score: number; pool: string } | null;
};

const reason = (v: unknown): Reason | null => (isObj(v) && text(v.text) ? { code: text(v.code) ?? "other", text: String(v.text) } : null);
const reasons = (v: unknown): Reason[] => list(v).map(reason).filter((r): r is Reason => r !== null);

export function parseWaitingRow(v: unknown): WaitingRow | null {
  if (!isObj(v) || !isDeskId(v.person_id)) return null;
  const lead = isObj(v.lead) ? { score: int(v.lead.score), pool: text(v.lead.pool) ?? "members" } : null;
  return {
    personId: String(v.person_id),
    name: text(v.name) ?? "A member",
    chip: text(v.chip) ?? "not_run",
    starter: v.starter === true,
    days: int(v.days),
    community: text(v.community),
    goal: text(v.goal),
    zone: text(v.zone),
    mode: text(v.mode),
    times: strings(v.times),
    kind: text(v.kind),
    phone: text(v.phone),
    hasNumber: v.has_number === true,
    options: int(v.options),
    best: intOrNull(v.best),
    bestTribe: text(v.best_tribe),
    block: reason(v.block),
    drafts: list(v.drafts)
      .filter(isObj)
      .filter((d) => isDeskId(d.group_id))
      .map((d) => ({ groupId: String(d.group_id), name: text(d.name) ?? "A draft", degree: int(d.degree), fits: d.fits === true })),
    inDraft: text(v.in_draft),
    lead,
  };
}

export type WaitingPage = { total: number; rows: WaitingRow[] };
export function parseWaiting(v: unknown): WaitingPage {
  if (!isObj(v)) return { total: 0, rows: [] };
  return { total: int(v.total), rows: list(v.rows).map(parseWaitingRow).filter((r): r is WaitingRow => r !== null) };
}

// ---------------------------------------------------------------------------
// Draft groups
// ---------------------------------------------------------------------------
export type CheckState = "ok" | "fix" | "wait";
export type Check = { code: string; state: CheckState; text: string };
export type GroupMember = { personId: string; name: string; degree: number; blocked: Reason[]; phone: string | null; hasNumber: boolean };
export type Group = {
  id: string;
  name: string;
  status: string;
  note: string | null;
  trackId: string;
  track: string | null;
  communityId: string | null;
  community: string | null;
  goalId: string | null;
  goal: string | null;
  slot: string;
  mode: string;
  zone: string | null;
  type: string;
  capacity: number;
  size: number;
  average: number | null;
  members: GroupMember[];
  checks: Check[];
  ready: boolean;
};

export function parseGroup(v: unknown): Group | null {
  if (!isObj(v) || !isDeskId(v.id)) return null;
  return {
    id: String(v.id),
    name: text(v.name) ?? "A draft group",
    status: text(v.status) ?? "draft",
    note: text(v.note),
    trackId: text(v.track_id) ?? "",
    track: text(v.track),
    communityId: text(v.community_id),
    community: text(v.community),
    goalId: text(v.goal_id),
    goal: text(v.goal),
    slot: text(v.slot) ?? "",
    mode: text(v.mode) ?? "online",
    zone: text(v.zone),
    type: text(v.type) ?? "mixed",
    capacity: int(v.capacity),
    size: int(v.size),
    average: intOrNull(v.average),
    members: list(v.members)
      .filter(isObj)
      .filter((m) => isDeskId(m.person_id))
      .map((m) => ({ personId: String(m.person_id), name: text(m.name) ?? "A member", degree: int(m.degree), blocked: reasons(m.blocked), phone: text(m.phone), hasNumber: m.has_number === true })),
    checks: list(v.checks)
      .filter(isObj)
      .map((c) => ({ code: text(c.code) ?? "", state: (c.state === "ok" || c.state === "fix" ? c.state : "wait") as CheckState, text: text(c.text) ?? "" })),
    ready: v.ready === true,
  };
}

export const parseGroups = (v: unknown): Group[] => list(v).map(parseGroup).filter((g): g is Group => g !== null);

export type Cluster = { trackId: string; track: string; slot: string; mode: string; type: string; size: number };
export function parseClusters(v: unknown): Cluster[] {
  return list(v)
    .filter(isObj)
    .filter((c) => isDeskId(c.track_id) && text(c.slot) && text(c.mode) && text(c.type))
    .map((c) => ({ trackId: String(c.track_id), track: text(c.track) ?? "", slot: String(c.slot), mode: String(c.mode), type: String(c.type), size: int(c.size) }));
}

export type Suggestion = { personId: string; name: string; degree: number; watch: Reason[]; days: number; phone: string | null; hasNumber: boolean };
export function parseSuggestions(v: unknown): Suggestion[] {
  return list(v)
    .filter(isObj)
    .filter((s) => isDeskId(s.person_id))
    .map((s) => ({ personId: String(s.person_id), name: text(s.name) ?? "A member", degree: int(s.degree), watch: reasons(s.watch), days: int(s.days), phone: text(s.phone), hasNumber: s.has_number === true }));
}

// ---------------------------------------------------------------------------
// Possible leaders
// ---------------------------------------------------------------------------
export type LeaderRow = {
  personId: string;
  name: string;
  score: number;
  pool: Pool;
  serving: string | null;
  faith: string | null;
  parts: Record<(typeof SIGNAL_PARTS)[number]["key"], number>;
  notes: string[];
  tribe: string | null;
  community: string | null;
  phone: string | null;
  hasNumber: boolean;
};

export function parseLeaderRow(v: unknown): LeaderRow | null {
  if (!isObj(v) || !isDeskId(v.person_id)) return null;
  const p = isObj(v.parts) ? v.parts : {};
  return {
    personId: String(v.person_id),
    name: text(v.name) ?? "A member",
    score: int(v.score),
    pool: isPool(v.pool) ? v.pool : "members",
    serving: text(v.serving),
    faith: text(v.faith),
    parts: { willingness: int(p.willingness), walk: int(p.walk), reliability: int(p.reliability), named: int(p.named), progress: int(p.progress) },
    notes: strings(v.notes),
    tribe: text(v.tribe),
    community: text(v.community),
    phone: text(v.phone),
    hasNumber: v.has_number === true,
  };
}

export type LeadersPage = { total: number; rows: LeaderRow[] };
export function parseLeaders(v: unknown): LeadersPage {
  if (!isObj(v)) return { total: 0, rows: [] };
  return { total: int(v.total), rows: list(v.rows).map(parseLeaderRow).filter((r): r is LeaderRow => r !== null) };
}

// ---------------------------------------------------------------------------
// A full number, as a reveal returns it
// ---------------------------------------------------------------------------
/** The only place a full number is read, and it is returned to the one screen that asked and kept nowhere. Anything that is not an international number is dropped. */
export function parseRevealed(v: unknown): { ok: true; number: string | null } | null {
  if (!isObj(v) || v.ok !== true) return null;
  const n = typeof v.number === "string" && /^\+[1-9][0-9]{7,14}$/.test(v.number) ? v.number : null;
  return { ok: true, number: n };
}

// ---------------------------------------------------------------------------
// Where a page of results begins
// ---------------------------------------------------------------------------
export const PAGE_SIZE = 25;
export const pageOf = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;
};
