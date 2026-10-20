/**
 * Appointing a leader from the owner's console. The database does everything (god_appointment_*), and checks again that the caller is
 * the owner and unlocked. This file reads what it sends, checks the short form for slips so the owner does not wait for a refusal,
 * and says each outcome in words. An appointment gives someone the leader role and starts their Tribe Card. It does not approve the
 * card, and it does not certify them: a pastor and the Academy still do those.
 */

export type AppointForm = {
  track: string;
  lead_best: string;
  community: string;
  goal: string;
  relation: string;
  care_cleared: boolean;
};

export const EMPTY_FORM: AppointForm = { track: "", lead_best: "", community: "", goal: "", relation: "", care_cleared: false };

const LEAD = ["structure", "connection", "teaching", "doing"];
const RELATION = ["achieved", "pursuing"];

/** What is missing or wrong on the short form, in words, or null. */
export function formProblem(f: AppointForm): string | null {
  if (!f.track) return "Choose their stage of life.";
  if (!LEAD.includes(f.lead_best)) return "Say how they lead best.";
  if (f.goal && !RELATION.includes(f.relation)) return "Say whether they have reached that goal or are working on it.";
  if (f.relation && !RELATION.includes(f.relation)) return "Say whether they have reached that goal or are working on it.";
  return null;
}

/** The form as the database wants it: only what is filled in, and no empty strings. */
export function formPayload(f: AppointForm): Record<string, unknown> {
  const out: Record<string, unknown> = { track: f.track, lead_best: f.lead_best, care_cleared: f.care_cleared === true };
  if (f.community) out.community = f.community;
  if (f.goal) out.goal = f.goal;
  if (f.relation && f.goal) out.relation = f.relation;
  return out;
}

// ---------------------------------------------------------------------------
// Reading what the database sends
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

export type FoundPerson = { id: string; name: string; email: string; roles: string[]; leads: number; appointed: boolean; hasApplication: boolean };

export function parseFound(json: unknown): FoundPerson[] {
  if (!Array.isArray(json)) return [];
  const out: FoundPerson[] = [];
  for (const p of json) {
    if (!isObject(p)) continue;
    const id = uuid(p.id);
    if (!id) continue;
    out.push({
      id,
      name: str(p.name) || str(p.email),
      email: str(p.email),
      roles: Array.isArray(p.roles) ? p.roles.filter((r): r is string => typeof r === "string") : [],
      leads: int(p.leads),
      appointed: p.appointed === true,
      hasApplication: p.has_application === true,
    });
  }
  return out;
}

export const PART_KEYS = ["calling", "judgement", "style", "need", "stage"] as const;
export type PartKey = (typeof PART_KEYS)[number];
export const PART_LABEL: Record<PartKey, string> = { calling: "Calling", judgement: "Judgement", style: "Style", need: "Need", stage: "Stage" };

export type Suggestion = {
  goalId: string;
  title: string;
  community: string;
  label: string;
  degree: number;
  nextTo: boolean;
  sensitive: boolean;
  /** Sensitive and the care result is below the bar: the tribe cannot be given unless a pastor has cleared them. */
  careFlag: boolean;
  parts: Record<PartKey, number>;
  waiting: number;
  seatsOpen: number;
  gap: number;
};

export type Suggestions = { status: "ok"; model: string; options: Suggestion[]; needed: Suggestion[] } | { status: "no_model" };

function suggestion(v: unknown): Suggestion | null {
  if (!isObject(v)) return null;
  const goalId = uuid(v.goal_id);
  const title = strOrNull(v.title);
  if (!goalId || !title) return null;
  const p = isObject(v.parts) ? v.parts : {};
  const part = (k: PartKey) => Math.max(0, Math.min(100, int(p[k])));
  return {
    goalId,
    title,
    community: str(v.community),
    label: str(v.label),
    degree: Math.max(0, Math.min(100, int(v.degree))),
    nextTo: v.next_to === true,
    sensitive: v.sensitive === true,
    careFlag: v.care_flag === true,
    parts: { calling: part("calling"), judgement: part("judgement"), style: part("style"), need: part("need"), stage: part("stage") },
    waiting: Math.max(0, int(v.waiting)),
    seatsOpen: Math.max(0, int(v.seats_open)),
    gap: int(v.gap),
  };
}

/** Reads the suggestions. Null when the answer is not usable. */
export function parseSuggestions(json: unknown): Suggestions | null {
  if (!isObject(json)) return null;
  if (json.status === "no_model") return { status: "no_model" };
  if (json.status !== "ok") return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(suggestion).filter((s): s is Suggestion => s !== null) : []);
  return { status: "ok", model: str(json.model), options: list(json.options), needed: list(json.needed) };
}

export type Appointment = {
  id: string;
  active: boolean;
  person: { id: string; name: string; email: string };
  goal: string;
  community: string;
  degree: number | null;
  label: string | null;
  flags: string[];
  careCleared: boolean;
  note: string | null;
  tribe: { id: string; status: string; name: string; members: number; certified: boolean } | null;
  appointedAt: string | null;
  steppedDownAt: string | null;
  stepDownReason: string | null;
};

export function parseAppointments(json: unknown): Appointment[] {
  if (!Array.isArray(json)) return [];
  const out: Appointment[] = [];
  for (const a of json) {
    if (!isObject(a)) continue;
    const id = uuid(a.id);
    const p = isObject(a.person) ? a.person : null;
    const personId = p ? uuid(p.id) : null;
    if (!id || !p || !personId) continue;
    const t = isObject(a.tribe) ? a.tribe : null;
    const tribeId = t ? uuid(t.id) : null;
    out.push({
      id,
      active: a.status === "active",
      person: { id: personId, name: str(p.name) || str(p.email), email: str(p.email) },
      goal: str(a.goal),
      community: str(a.community),
      degree: typeof a.degree === "number" ? int(a.degree) : null,
      label: strOrNull(a.label),
      flags: Array.isArray(a.flags) ? a.flags.filter((f): f is string => typeof f === "string") : [],
      careCleared: a.care_cleared === true,
      note: strOrNull(a.note),
      tribe: t && tribeId ? { id: tribeId, status: str(t.status), name: str(t.name), members: int(t.members), certified: t.certified === true } : null,
      appointedAt: strOrNull(a.appointed_at),
      steppedDownAt: strOrNull(a.stepped_down_at),
      stepDownReason: strOrNull(a.step_down_reason),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "Strong match, 78%". */
export function matchLine(label: string | null, degree: number | null): string {
  if (!label || degree === null) return "No match recorded";
  const word = label.charAt(0).toUpperCase() + label.slice(1);
  return label === "stretch" ? word : `${word} match, ${degree}%`;
}

/** The members who are waiting and the seats open, in one line. */
export function demandText(s: Pick<Suggestion, "waiting" | "seatsOpen" | "gap">): string {
  if (s.waiting === 0 && s.seatsOpen === 0) return "Nobody is waiting for this tribe now.";
  const waiting = `${s.waiting} ${s.waiting === 1 ? "member is" : "members are"} waiting`;
  const seats = `${s.seatsOpen} ${s.seatsOpen === 1 ? "seat is" : "seats are"} open`;
  return s.gap > 0 ? `${waiting} and ${seats}. They need ${s.gap} more ${s.gap === 1 ? "leader" : "leaders"}.` : `${waiting} and ${seats}.`;
}

/** What an appointment does and does not do, shown before the owner confirms. */
export const APPOINT_PROMISE = [
  "They are given the leader role and their Tribe Card is started, with the community, goal and life stage locked.",
  "The three Success Picture lines come from the ready-made card.",
  "A pastor still approves the card, and the Academy still certifies them. Members cannot see the tribe until both are done.",
  "The office sees “appointed by an administrator” and no name.",
];

export const STEP_DOWN_PROMISE = [
  "The appointment ends. A tribe with no members joined is closed.",
  "If members have joined, nothing happens: a pastor moves them first.",
  "The leader role goes only if the appointment gave it and they have nothing else to lead.",
  "A certificate is never withdrawn.",
];

export const SEARCH_MIN = 2;
