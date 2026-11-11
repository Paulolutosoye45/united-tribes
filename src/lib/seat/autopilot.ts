// The Seat autopilot (Package 8): every sentence its screens say and everything they read from the database. Like the seat window's, every parser takes whatever the
// database sent and gives back something safe to show: anything it does not understand becomes nothing, never a guess. The office sees names and numbers here; a phone
// number, a note or a reason a member gave is never read.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type AutopilotMode = "off" | "rehearsal" | "on";
export type PlanState = "rehearsal" | "planned" | "applied" | "lapsed" | "empty";
export type WhyHard = "nobody" | "time" | "format" | "fit";
const PLAN_STATES: PlanState[] = ["rehearsal", "planned", "applied", "lapsed", "empty"];
const WHYS: WhyHard[] = ["nobody", "time", "format", "fit"];

export type AutopilotRow = { person: string; tribe: string; degree: number; kind: "fill" | "open"; rehearsal: boolean; outcome: string | null };
export type AutopilotPlan = { id: string; on: string; state: PlanState; madeAt: string | null; items: number; placed: number; skipped: number; today: boolean; rows: AutopilotRow[] };
export type AutopilotKind = { community: string; slot: string; waiting: number; seats: number };
export type SmallTribe = {
  tribeId: string | null; name: string; leader: string | null; members: number; slot: string; days: number; waitingFit: number; hard: boolean; why: WhyHard | null;
  merge: { to: string; fits: number; of: number; names: string[] } | null;
};
export type AutopilotStats = { benchTotal: number; considered: number; blockedByBar: number; bar: number; kinds: AutopilotKind[]; small: SmallTribe[] };
export type AutopilotView = {
  role: "act" | "look";
  mode: AutopilotMode;
  setting: "suggest" | "auto";
  paused: boolean;
  bar: number;
  until: string | null;
  plan: AutopilotPlan | null;
  stats: AutopilotStats | null;
};

function parseRow(v: unknown): AutopilotRow | null {
  if (!isObj(v)) return null;
  const person = text(v.person);
  const tribe = text(v.tribe);
  if (!person || !tribe || (v.kind !== "fill" && v.kind !== "open")) return null;
  return { person, tribe, degree: int(v.degree), kind: v.kind, rehearsal: v.rehearsal === true, outcome: text(v.outcome) };
}

function parsePlan(v: unknown): AutopilotPlan | null {
  if (!isObj(v) || typeof v.id !== "string" || !PLAN_STATES.includes(v.state as PlanState)) return null;
  return {
    id: v.id,
    on: text(v.on) ?? "",
    state: v.state as PlanState,
    madeAt: text(v.made_at),
    items: int(v.items),
    placed: int(v.placed),
    skipped: int(v.skipped),
    today: v.today === true,
    rows: list(v.rows).map(parseRow).filter((r): r is AutopilotRow => r !== null),
  };
}

function parseSmall(v: unknown): SmallTribe | null {
  if (!isObj(v)) return null;
  const name = text(v.name);
  if (!name) return null;
  const m = v.merge;
  const merge = isObj(m) && text(m.to) ? { to: text(m.to) as string, fits: int(m.fits), of: int(m.of), names: list(m.names).filter((n): n is string => typeof n === "string") } : null;
  return {
    tribeId: typeof v.tribe_id === "string" ? v.tribe_id : null,
    name,
    leader: text(v.leader),
    members: int(v.members),
    slot: text(v.slot) ?? "",
    days: int(v.days),
    waitingFit: int(v.waiting_fit),
    hard: v.hard === true,
    why: WHYS.includes(v.why as WhyHard) ? (v.why as WhyHard) : null,
    merge,
  };
}

function parseStats(v: unknown): AutopilotStats | null {
  if (!isObj(v)) return null;
  return {
    benchTotal: int(v.bench_total),
    considered: int(v.considered),
    blockedByBar: int(v.blocked_by_bar),
    bar: int(v.bar),
    kinds: list(v.kinds)
      .map((k) => (isObj(k) && text(k.community) ? { community: text(k.community) as string, slot: text(k.slot) ?? "any", waiting: int(k.waiting), seats: int(k.seats) } : null))
      .filter((k): k is AutopilotKind => k !== null),
    small: list(v.small).map(parseSmall).filter((s): s is SmallTribe => s !== null),
  };
}

export function parseAutopilot(v: unknown): AutopilotView | null {
  if (!isObj(v) || (v.role !== "act" && v.role !== "look")) return null;
  return {
    role: v.role,
    mode: v.mode === "on" || v.mode === "rehearsal" ? v.mode : "off",
    setting: v.setting === "auto" ? "auto" : "suggest",
    paused: v.paused === true,
    bar: int(v.bar),
    until: text(v.until),
    plan: parsePlan(v.plan),
    stats: parseStats(v.stats),
  };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------
const SLOT_WORDS: Record<string, string> = {
  "weeknight-evening": "weeknight evening",
  "saturday-morning": "Saturday morning",
  "sunday-afternoon": "Sunday afternoon",
  "sunday-evening": "Sunday evening",
  any: "any time",
};
export const slotWords = (slot: string): string => SLOT_WORDS[slot] ?? slot.replace(/-/g, " ");

const OUTCOMES: Record<string, string> = {
  placed: "Placed",
  "skipped:full": "Skipped: the tribe filled up first",
  "skipped:not_eligible": "Skipped: they changed their answers or asked to be left out",
  "skipped:no_longer_fits": "Skipped: no longer a strong fit",
  "skipped:tribe_closed": "Skipped: the tribe is no longer open",
  "skipped:day_limit": "Skipped: the day's limit was reached",
  "skipped:tribe_day_limit": "Skipped: that tribe's limit for the day was reached",
};
/** What happened to one person in a plan, in words. Anything unexpected is said plainly, never shown raw. */
export function outcomeWords(outcome: string | null): string {
  if (!outcome) return "";
  if (OUTCOMES[outcome]) return OUTCOMES[outcome];
  return outcome.startsWith("failed") ? "Not placed: the placement was refused" : "Not placed";
}

const HARD_WORDS: Record<WhyHard, string> = {
  nobody: "Nobody is waiting for a seat at the moment.",
  time: "Nobody waiting can meet at its time.",
  format: "Nobody waiting can meet the way it meets (online or in person).",
  fit: "Nobody waiting fits it well enough.",
};

export const AUTOPILOT_WORDS = {
  title: "Autopilot",
  intro:
    "Once a day, between 8 am and 7 pm, autopilot looks at the people waiting for a seat and puts each with their best fit at the bar or above. A tribe with enough members is filled one person at a time; a smaller one is opened only when enough people fit it to start as a team. Every person is placed the way the office places one, with the same checks, the same email and the same Undo.",
  off: "Autopilot is Off. Nobody is placed by itself.",
  rehearsal: "This is Rehearsal. Each day's plan is written down, but nobody is placed and nothing is sent.",
  paused: "Autopilot is stopped by the office. Nothing will be planned or placed until it is started again.",
  until: (when: string) => `It keeps placing until ${when}.`,
  mode: (m: "suggest" | "auto") => (m === "auto" ? "Auto: it places by itself at the first beat after 9 am." : "Suggest: it makes the plan at 8 am, and one tap places it."),
  planHeading: "Today's plan",
  lastPlan: (on: string) => `The last plan, for ${on}`,
  noPlan: "No plan has been made yet. The first is made at 8 am on the next beat.",
  state: {
    rehearsal: "Rehearsal: written down only",
    planned: "Waiting for a tap",
    applied: "Placed",
    lapsed: "Ran out at midnight: nobody tapped",
    empty: "Nobody to place",
  } as Record<PlanState, string>,
  ready: (n: number) => `${n} ${n === 1 ? "placement is" : "placements are"} ready. Look at the list, then place them. Each person gets the same email and the same Undo as a placement made by hand. A plan nobody places runs out at midnight.`,
  place: "Place them",
  placing: "Placing…",
  placed: (placed: number, skipped: number) => `${placed} ${placed === 1 ? "person" : "people"} placed${skipped > 0 ? `, ${skipped} skipped (the list says why)` : ""}.`,
  columns: ["Person", "Tribe", "Fit", "What happens"],
  kind: { fill: "Joins the tribe", open: "Starts the tribe as a team" } as Record<string, string>,
  rehearsalRow: "Would be placed",
  bench: "Waiting for a seat",
  benchTotal: (n: number) => `${n} ${n === 1 ? "person is" : "people are"} waiting for a seat.`,
  kinds: (waiting: number, community: string, slot: string, seats: number) =>
    `${waiting} waiting for a ${community} tribe (${slotWords(slot)}), ${seats === 0 ? "no seats open" : `${seats} ${seats === 1 ? "seat" : "seats"} open`}`,
  kindsHelp: "A person who can meet at two times is counted under each. A tribe's seats are counted without the seat kept free for people who choose for themselves.",
  blocked: (n: number, bar: number) => `${n} ${n === 1 ? "person is" : "people are"} held back only by the ${bar}% bar: they fit a tribe that has room, but not that well.`,
  asOf: (when: string) => (when ? `Counted when today's plan was made, ${when}.` : ""),
  small: "Small tribes",
  smallIntro: "Tribes that are still under the smallest size after being open for the number of days set for autopilot.",
  openFor: (n: number) => `${n} ${n === 1 ? "day" : "days"} open`,
  smallNone: "No tribe is small.",
  members: (n: number) => `${n} ${n === 1 ? "member" : "members"}`,
  mergeTo: (to: string, fits: number, of: number, bar: number) => `Could join ${to}: ${fits} of ${of} fit at ${bar}% or more.`,
  hard: "Hard to fill",
  waitingFit: (n: number) => `${n} waiting ${n === 1 ? "person fits" : "people fit"} it, not yet enough to start it.`,
  hardWhy: (why: WhyHard | null) => (why ? HARD_WORDS[why] : "Nobody waiting fits it."),
  stop: "Stop autopilot",
  start: "Start autopilot",
  stopHelp: "Nothing will be planned or placed until it is started again. People already placed stay placed.",
  reasonLabel: "Why? (5 to 300 characters)",
  confirm: "Confirm",
  cancel: "Cancel",
  unavailable: "Autopilot is not available yet. The database file for it has not been applied.",
} as const;

// ---------------------------------------------------------------------------
// The owner's numbers
// ---------------------------------------------------------------------------
export type AutopilotSettings = { mode: "suggest" | "auto"; bar: number; perTribeDay: number; dayCap: number; extraDays: number; smallDays: number; paused: boolean };
export function parseAutopilotSettings(v: unknown): AutopilotSettings | null {
  if (!isObj(v) || typeof v.bar !== "number") return null;
  return {
    mode: v.mode === "auto" ? "auto" : "suggest",
    bar: int(v.bar),
    perTribeDay: int(v.per_tribe_day),
    dayCap: int(v.day_cap),
    extraDays: int(v.extra_days),
    smallDays: int(v.small_days),
    paused: v.paused === true,
  };
}

/** The ranges the database enforces; the form checks them first so a typing slip is caught before the database is asked. */
export const AUTOPILOT_RANGES = { bar: [60, 95], perTribe: [1, 4], dayCap: [5, 100], extra: [0, 30], small: [5, 30] } as const;

export type AutopilotSettingsInput = { mode: string; bar: string; perTribe: string; dayCap: string; extra: string; small: string; reason: string };
export type AutopilotSettingsValue = { mode: "suggest" | "auto"; bar: number; perTribe: number; dayCap: number; extra: number; small: number; reason: string };
export function checkAutopilotSettings(i: AutopilotSettingsInput): { ok: true; value: AutopilotSettingsValue } | { ok: false; message: string } {
  if (i.mode !== "suggest" && i.mode !== "auto") return { ok: false, message: "Choose Suggest or Auto." };
  const one = (raw: string, key: keyof typeof AUTOPILOT_RANGES, label: string): number | string => {
    const t = raw.trim();
    if (!/^\d{1,3}$/.test(t)) return `${label}: use a whole number.`;
    const n = Number(t);
    const [lo, hi] = AUTOPILOT_RANGES[key];
    return n < lo || n > hi ? `${label}: between ${lo} and ${hi}.` : n;
  };
  const bar = one(i.bar, "bar", "The bar (%)");
  const perTribe = one(i.perTribe, "perTribe", "New members to one tribe in a day");
  const dayCap = one(i.dayCap, "dayCap", "Placements in a day");
  const extra = one(i.extra, "extra", "Days it keeps placing after joining closes");
  const small = one(i.small, "small", "Days before a tribe is called small");
  for (const n of [bar, perTribe, dayCap, extra, small]) if (typeof n === "string") return { ok: false, message: n };
  const reason = i.reason.trim();
  if (reason.length < 5 || reason.length > 300) return { ok: false, message: "Say why you are changing this, in 5 to 300 characters." };
  return { ok: true, value: { mode: i.mode, bar: bar as number, perTribe: perTribe as number, dayCap: dayCap as number, extra: extra as number, small: small as number, reason } };
}
