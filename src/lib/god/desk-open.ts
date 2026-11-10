// The Leader Desk's Open tribe, pipeline and limits (Phase 2b-2), as the God Mode screens read them. Every parser takes whatever the database sent and gives back something
// safe to show: anything it does not understand becomes nothing, never a guess. No number, note or reason is ever part of what these read.

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

export const OPEN_WORDS = {
  title: "Open the tribe",
  intro:
    "Once the leader has been appointed, a pastor has approved the card and the Academy has certified the leader, the members of this draft are placed in the tribe one at a time, the same way the office places one person. Anyone who cannot be placed is left alone and named here, so you can place them by hand.",
  button: "Place the members",
  buttonRehearsal: "See who would be placed",
  looking: "Checking each member…",
  waiting: "Not ready to open yet.",
  on: "This places each person who can be placed, and emails them “Your tribe”. The leader gets the team list.",
  rehearsal: "This is Rehearsal: nobody is placed and nothing is sent.",
  placementOff: "Placement is not switched On, so nobody can be placed for real yet.",
  confirm: "Place them",
  confirmRehearsal: "Show me",
  cancel: "Not now",
  tribe: (name: string, active: number, capacity: number) => `${name}: ${active} of ${capacity} seats taken`,
  states: {
    seated: "Already in the tribe",
    ready: "Can be placed",
    blocked: "Cannot be placed",
    full: "No seat left",
  } as Record<string, string>,
  yes: "said yes",
  counts: (ready: number, seated: number, notPlaced: number) =>
    [`${ready} can be placed`, seated > 0 ? `${seated} already in` : null, notPlaced > 0 ? `${notPlaced} cannot be placed` : null].filter(Boolean).join(", "),
  placed: (n: number) => `${n} ${n === 1 ? "person was" : "people were"} placed.`,
  would: (n: number) => `${n} ${n === 1 ? "person would" : "people would"} be placed. Nothing was done.`,
  closed: "Everyone is placed, so this draft has been archived.",
  left: "Left alone, for you to place by hand",
} as const;

export const PIPELINE_WORDS = {
  title: "On the way to an open tribe",
  intro: "Each draft group that is being led, from the moment a member is asked to the moment its tribe opens. A group that has stayed in one stage longer than its limit is marked as stuck.",
  none: "No group is on its way to an open tribe right now.",
  stuck: (n: number) => (n === 1 ? "1 group is stuck" : `${n} groups are stuck`),
  nothingStuck: "Nothing is stuck.",
  stages: {
    asked: "Asked to lead, waiting for an answer",
    said_yes: "Said yes, waiting for your decision",
    card_started: "The leader is filling in the tribe card",
    card_waiting: "The tribe card is waiting for the pastors",
    card_approved: "The card is approved, waiting for the Academy to certify the leader",
    ready: "Ready to open",
    opened: "Opened, with people still to place",
  } as Record<string, string>,
  formed: "Formed by the Desk",
  stuckTag: "Stuck",
  limit: (h: number) => `limit ${days(h)}`,
  settingsTitle: "Limits",
  settingsIntro: "These apply from the next offer and the next look. Changing them needs a reason, which is written to the log.",
  fields: {
    offerHours: { label: "Hours to answer an offer", help: "24 to 240" },
    backups: { label: "Backups for each group", help: "0, 1 or 2" },
    saidYesDays: { label: "Days a yes may wait for you", help: "1 to 14" },
    cardDays: { label: "Days a card may wait for the pastors", help: "1 to 14" },
    reason: { label: "Why are you changing this?", help: "3 to 300 characters" },
  },
  save: "Save the limits",
  saved: "Saved.",
} as const;

/** "5 hours", "1 day", "2 days 3 hours": how long something has been where it is, or how long it may stay. */
export function days(hours: number): string {
  const h = Math.max(0, Math.round(hours));
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"}`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  return `${d} ${d === 1 ? "day" : "days"}${r > 0 ? ` ${r} ${r === 1 ? "hour" : "hours"}` : ""}`;
}

// ---------------------------------------------------------------------------
// Open tribe
// ---------------------------------------------------------------------------
export type OpenMember = { personId: string; name: string; saidYes: boolean; state: "seated" | "ready" | "blocked" | "full"; text: string | null };
export type OpenPreview = {
  ok: boolean;
  problem: string | null;
  rehearsal: boolean;
  placementOn: boolean;
  tribe: { name: string; capacity: number; active: number } | null;
  members: OpenMember[];
  counts: { ready: number; seated: number; notPlaced: number };
};
const STATES = ["seated", "ready", "blocked", "full"] as const;

export function parseOpenPreview(v: unknown): OpenPreview | null {
  if (!isObj(v)) return null;
  const t = isObj(v.tribe) ? v.tribe : null;
  const c = isObj(v.counts) ? v.counts : {};
  const members: OpenMember[] = [];
  for (const m of list(v.members)) {
    if (!isObj(m)) continue;
    const pid = id(m.person_id);
    const state = STATES.find((s) => s === m.state);
    if (!pid || !state) continue;
    members.push({ personId: pid, name: text(m.name) ?? "A member", saidYes: m.said_yes === true, state, text: text(m.text) });
  }
  return {
    ok: v.ok === true,
    problem: text(v.problem),
    rehearsal: v.rehearsal === true,
    placementOn: v.placement_on === true,
    tribe: t ? { name: text(t.name) ?? "The tribe", capacity: int(t.capacity), active: int(t.active) } : null,
    members,
    counts: { ready: int(c.ready), seated: int(c.seated), notPlaced: int(c.not_placed) },
  };
}

export type OpenResult = { rehearsal: boolean; placed: number; would: number; closed: boolean; notPlaced: { personId: string; name: string; text: string }[] };

export function parseOpenResult(v: unknown): OpenResult | null {
  if (!isObj(v) || v.ok !== true) return null;
  const notPlaced: OpenResult["notPlaced"] = [];
  for (const n of list(v.not_placed)) {
    if (!isObj(n)) continue;
    const pid = id(n.person_id);
    if (pid) notPlaced.push({ personId: pid, name: text(n.name) ?? "A member", text: text(n.text) ?? "They could not be placed." });
  }
  return { rehearsal: v.rehearsal === true, placed: int(v.placed), would: int(v.would), closed: v.closed === true, notPlaced };
}

// ---------------------------------------------------------------------------
// The pipeline and its limits
// ---------------------------------------------------------------------------
export const PIPELINE_STAGES = ["asked", "said_yes", "card_started", "card_waiting", "card_approved", "ready", "opened"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type PipelineRow = { groupId: string; group: string; leaderId: string | null; name: string; stage: PipelineStage; since: string | null; hours: number; limitHours: number | null; stuck: boolean; formed: boolean };
export type PipelineSettings = { offerHours: number; backups: number; saidYesDays: number; cardDays: number };
export type Pipeline = { settings: PipelineSettings; stuck: number; rows: PipelineRow[] };
export const EMPTY_PIPELINE: Pipeline = { settings: { offerHours: 72, backups: 2, saidYesDays: 2, cardDays: 3 }, stuck: 0, rows: [] };

export function parsePipeline(v: unknown): Pipeline | null {
  if (!isObj(v)) return null;
  const s = isObj(v.settings) ? v.settings : null;
  if (!s) return null;
  const rows: PipelineRow[] = [];
  for (const r of list(v.rows)) {
    if (!isObj(r)) continue;
    const gid = id(r.group_id);
    const stage = PIPELINE_STAGES.find((x) => x === r.stage);
    if (!gid || !stage) continue;
    rows.push({
      groupId: gid,
      group: text(r.group) ?? "A group",
      leaderId: id(r.person_id),
      name: text(r.name) ?? "A member",
      stage,
      since: text(r.since),
      hours: int(r.hours),
      limitHours: typeof r.limit_hours === "number" ? int(r.limit_hours) : null,
      stuck: r.stuck === true,
      formed: r.formed === true,
    });
  }
  return {
    settings: { offerHours: int(s.offer_hours), backups: int(s.backups), saidYesDays: int(s.said_yes_days), cardDays: int(s.card_days) },
    stuck: rows.filter((r) => r.stuck).length,
    rows,
  };
}

/** The limits the owner can set, with the ranges the database enforces; the form checks them first so a typing slip is caught before the database is asked. */
export const PIPELINE_RANGES = { offerHours: [24, 240], backups: [0, 2], saidYesDays: [1, 14], cardDays: [1, 14] } as const;

export type SettingsInput = { offerHours: string; backups: string; saidYesDays: string; cardDays: string; reason: string };

/** The four numbers and the reason, checked: a whole number inside its range, a reason of 3 to 300 characters. A problem comes back in words. */
export function checkSettings(i: SettingsInput): { ok: true; value: { offerHours: number; backups: number; saidYesDays: number; cardDays: number; reason: string } } | { ok: false; message: string } {
  const one = (raw: string, key: keyof typeof PIPELINE_RANGES, label: string): number | string => {
    const t = raw.trim();
    if (!/^\d{1,3}$/.test(t)) return `${label}: use a whole number.`;
    const n = Number(t);
    const [lo, hi] = PIPELINE_RANGES[key];
    return n < lo || n > hi ? `${label}: between ${lo} and ${hi}.` : n;
  };
  const F = PIPELINE_WORDS.fields;
  const offerHours = one(i.offerHours, "offerHours", F.offerHours.label);
  const backups = one(i.backups, "backups", F.backups.label);
  const saidYesDays = one(i.saidYesDays, "saidYesDays", F.saidYesDays.label);
  const cardDays = one(i.cardDays, "cardDays", F.cardDays.label);
  for (const n of [offerHours, backups, saidYesDays, cardDays]) if (typeof n === "string") return { ok: false, message: n };
  const reason = i.reason.trim();
  if (reason.length < 3 || reason.length > 300) return { ok: false, message: "Say why you are changing this, in 3 to 300 characters." };
  return { ok: true, value: { offerHours: offerHours as number, backups: backups as number, saidYesDays: saidYesDays as number, cardDays: cardDays as number, reason } };
}
