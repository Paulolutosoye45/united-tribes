/**
 * What the Placement screens read from the database. The database does the work and decides who may ask; this file only turns
 * what comes back into plain typed values, dropping anything that is not usable rather than guessing.
 */

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isObject(v)) for (const [k, n] of Object.entries(v)) out[k] = int(n);
  return out;
};

export type PlacementMode = "off" | "rehearsal" | "on";
export const MODES: PlacementMode[] = ["off", "rehearsal", "on"];

export type Settings = {
  mode: PlacementMode;
  graceDays: number;
  seatsFree: number;
  minTribe: number;
  pacePerHour: number;
  sendFrom: number;
  sendUntil: number;
  holdHours: number;
  reminderDays: number;
  /** The lowest Degree of Compatibility the active model lets through. Set by the pastor's model, not here. */
  floor: number;
  /** Whether a tribe's WhatsApp group link waits until the member has answered about sharing their number. */
  holdGroupLink: boolean;
  /** When the heartbeat last ran, so the owner can see it is running. Null when it never has. */
  lastTickAt: string | null;
};

export const DEFAULT_SETTINGS: Settings = {
  mode: "off", graceDays: 7, seatsFree: 1, minTribe: 5, pacePerHour: 100, sendFrom: 9, sendUntil: 19, holdHours: 24, reminderDays: 5, floor: 60, holdGroupLink: true, lastTickAt: null,
};

export function parseSettings(json: unknown): Settings | null {
  if (!isObject(json)) return null;
  const mode = MODES.find((m) => m === json.mode);
  if (!mode) return null;
  return {
    mode,
    graceDays: int(json.grace_days), seatsFree: int(json.seats_free), minTribe: int(json.min_tribe), pacePerHour: int(json.pace_per_hour),
    sendFrom: int(json.send_from), sendUntil: int(json.send_until), holdHours: int(json.hold_hours), reminderDays: int(json.reminder_days), floor: int(json.floor),
    // an older database has no such setting: the safe way (holding the link) is the default
    holdGroupLink: json.hold_group_link !== false, lastTickAt: strOrNull(json.last_tick_at),
  };
}

export type RunSummary = {
  id: string;
  seq: number;
  status: string;
  rehearsal: boolean;
  createdAt: string | null;
  pool: number;
  placed: number;
  confirmed: number;
};

export type OpenRun = { id: string; seq: number; status: string; phase: string; rehearsal: boolean; pool: number; told: number };

export type Overview = {
  settings: Settings;
  season: { id: string; name: string; startsOn: string } | null;
  openRun: OpenRun | null;
  runs: RunSummary[];
  supply: { tribesOpen: number; seatsOpen: number; membersWithForm: number; membersWithoutForm: number; onHold: number };
};

export function parseOverview(json: unknown): Overview | null {
  if (!isObject(json)) return null;
  const settings = parseSettings(json.settings);
  if (!settings) return null;
  const s = isObject(json.season) ? json.season : null;
  const o = isObject(json.open_run) ? json.open_run : null;
  const sup = isObject(json.supply) ? json.supply : {};
  const openId = o ? uuid(o.id) : null;
  return {
    settings,
    season: s && uuid(s.id) ? { id: str(s.id), name: str(s.name), startsOn: str(s.starts_on) } : null,
    openRun: o && openId ? { id: openId, seq: int(o.seq), status: str(o.status), phase: str(o.phase), rehearsal: o.rehearsal === true, pool: int(o.pool), told: int(o.told) } : null,
    runs: arr(json.runs).flatMap((r) => {
      if (!isObject(r)) return [];
      const id = uuid(r.id);
      return id
        ? [{ id, seq: int(r.seq), status: str(r.status), rehearsal: r.rehearsal === true, createdAt: strOrNull(r.created_at), pool: int(r.pool), placed: int(r.placed), confirmed: int(r.confirmed) }]
        : [];
    }),
    supply: {
      tribesOpen: int(sup.tribes_open), seatsOpen: int(sup.seats_open), membersWithForm: int(sup.members_with_form),
      membersWithoutForm: int(sup.members_without_form), onHold: int(sup.on_hold),
    },
  };
}

/** Where a tribe's leader stands, in the words of the God Mode board. */
export type TeamState = "rehearsal" | "told" | "opened" | "cancelled" | "placing" | "waiting" | "holding" | "none_sent" | "due";
export const TEAM_STATES: TeamState[] = ["rehearsal", "told", "opened", "cancelled", "placing", "waiting", "holding", "none_sent", "due"];

export type Team = {
  tribe: string;
  name: string;
  leaderFirst: string;
  capacity: number;
  activeBefore: number;
  proposed: number;
  small: boolean;
  decision: "keep" | "hold" | "retry" | null;
  mailQueuedAt: string | null;
  cancelledAt: string | null;
  placed: number;
  confirmed: number;
  withheld: number;
  changed: number;
  fit: Record<string, number>;
  /** Member emails sent, still waiting to go, and failed or never made. */
  sent: number;
  waiting: number;
  failed: number;
  /** Members whose own day has not yet passed, and members whose details are not yet open for any reason. */
  holding: number;
  unanswered: number;
  opensAt: string | null;
  state: TeamState;
  contactOpenedAt: string | null;
};

export type RunView = {
  run: {
    id: string; seq: number; status: string; phase: string; rehearsal: boolean; pool: number; told: number;
    createdAt: string | null; plannedAt: string | null; approvedAt: string | null; placedAt: string | null; closedAt: string | null; undoneAt: string | null;
    graceDays: number; seatsFree: number; minTribe: number; pacePerHour: number; sendFrom: number; sendUntil: number; holdHours: number;
    scopeCommunity: string | null; scopeZone: string | null; season: string | null;
  };
  /** When the heartbeat last ran, and the switch's position now: a run can only finish telling leaders when the heartbeat runs. */
  heartbeatAt: string | null;
  mode: PlacementMode;
  counts: Record<string, number>;
  reasons: { status: string; reason: string; n: number }[];
  fit: Record<string, number>;
  days: number;
  teams: Team[];
  results: { placed: number; confirmed: number; withheld: number; changed: number; messages: Record<string, number>; leadersTold: number; leadersWaiting: number };
};

export function parseRunView(json: unknown): RunView | null {
  if (!isObject(json) || !isObject(json.run)) return null;
  const r = json.run;
  const id = uuid(r.id);
  if (!id) return null;
  const res = isObject(json.results) ? json.results : {};
  return {
    run: {
      id, seq: int(r.seq), status: str(r.status), phase: str(r.phase), rehearsal: r.rehearsal === true, pool: int(r.pool), told: int(r.told),
      createdAt: strOrNull(r.created_at), plannedAt: strOrNull(r.planned_at), approvedAt: strOrNull(r.approved_at), placedAt: strOrNull(r.placed_at),
      closedAt: strOrNull(r.closed_at), undoneAt: strOrNull(r.undone_at),
      graceDays: int(r.grace_days), seatsFree: int(r.seats_free), minTribe: int(r.min_tribe), pacePerHour: int(r.pace_per_hour),
      sendFrom: int(r.send_from), sendUntil: int(r.send_until), holdHours: int(r.hold_hours),
      scopeCommunity: strOrNull(r.scope_community), scopeZone: strOrNull(r.scope_zone), season: strOrNull(r.season),
    },
    heartbeatAt: strOrNull(json.heartbeat_at),
    mode: MODES.find((m) => m === json.mode) ?? "off",
    counts: counts(json.counts),
    reasons: arr(json.reasons).flatMap((x) => (isObject(x) ? [{ status: str(x.status), reason: str(x.reason), n: int(x.n) }] : [])),
    fit: counts(json.fit),
    days: Math.max(0, int(json.days)),
    teams: arr(json.teams).flatMap((t) => {
      if (!isObject(t)) return [];
      const tribe = uuid(t.tribe);
      if (!tribe) return [];
      const d = t.decision;
      const state = TEAM_STATES.find((x) => x === t.state) ?? "due";
      return [{
        tribe, name: str(t.name), leaderFirst: str(t.leader_first), capacity: int(t.capacity), activeBefore: int(t.active_before), proposed: int(t.proposed),
        small: t.small === true, decision: d === "keep" || d === "hold" || d === "retry" ? d : null, mailQueuedAt: strOrNull(t.mail_queued_at),
        cancelledAt: strOrNull(t.cancelled_at), placed: int(t.placed), confirmed: int(t.confirmed), withheld: int(t.withheld), changed: int(t.changed), fit: counts(t.fit),
        sent: int(t.sent), waiting: int(t.waiting), failed: int(t.failed), holding: int(t.holding), unanswered: int(t.unanswered), opensAt: strOrNull(t.opens_at),
        state, contactOpenedAt: strOrNull(t.contact_opened_at),
      }];
    }),
    results: {
      placed: int(res.placed), confirmed: int(res.confirmed), withheld: int(res.withheld), changed: int(res.changed),
      messages: counts(res.messages), leadersTold: int(res.leaders_told), leadersWaiting: int(res.leaders_waiting),
    },
  };
}

export type RunItem = {
  person: string;
  name: string;
  status: string;
  reason: string | null;
  tribe: string | null;
  tribeName: string | null;
  degree: number | null;
  fit: string | null;
  candCount: number;
  bestDegree: number | null;
  moved: boolean;
  message: string | null;
  confirmed: boolean;
  withheld: boolean;
  seat: string | null;
};

export function parseItems(json: unknown): { total: number; items: RunItem[] } {
  if (!isObject(json)) return { total: 0, items: [] };
  return {
    total: int(json.total),
    items: arr(json.items).flatMap((i) => {
      if (!isObject(i)) return [];
      const person = uuid(i.person);
      if (!person) return [];
      return [{
        person, name: str(i.name) || "A member", status: str(i.status), reason: strOrNull(i.reason), tribe: uuid(i.tribe), tribeName: strOrNull(i.tribe_name),
        degree: intOrNull(i.degree), fit: strOrNull(i.fit), candCount: int(i.cand_count), bestDegree: intOrNull(i.best_degree), moved: i.moved === true,
        message: strOrNull(i.message), confirmed: i.confirmed === true, withheld: i.withheld === true, seat: strOrNull(i.seat),
      }];
    }),
  };
}

export type TribeOption = { tribe: string; name: string; leader: string; degree: number; label: string; belowFloor: boolean; seats: number };

export function parseOptions(json: unknown): TribeOption[] {
  return arr(json).flatMap((o) => {
    if (!isObject(o)) return [];
    const tribe = uuid(o.tribe);
    return tribe ? [{ tribe, name: str(o.name), leader: str(o.leader), degree: int(o.degree), label: str(o.label), belowFloor: o.below_floor === true, seats: int(o.seats) }] : [];
  });
}

export type Hold = { person: string; name: string; since: string | null };

export function parseHolds(json: unknown): Hold[] {
  return arr(json).flatMap((h) => {
    if (!isObject(h)) return [];
    const person = uuid(h.person);
    return person ? [{ person, name: str(h.name) || "A member", since: strOrNull(h.since) }] : [];
  });
}

// ---- bulk leaders ----

export type LeaderItem = {
  person: string;
  name: string;
  source: "approved" | "sheet";
  goal: string;
  title: string;
  community: string;
  degree: number;
  label: string;
  status: string;
  reason: string | null;
  tribe: string | null;
};

export type LeadersView = {
  run: { id: string; seq: number; status: string; createdAt: string | null; approvedAt: string | null; doneAt: string | null } | null;
  leftOver: { person: string | null; name: string | null; email: string | null; reason: string }[];
  openGoals: { goal: string; title: string; community: string; tribesShort: number; gap: number }[];
  items: LeaderItem[];
};

export function parseLeadersView(json: unknown): LeadersView | null {
  if (!isObject(json)) return null;
  const r = isObject(json.run) ? json.run : null;
  const id = r ? uuid(r.id) : null;
  if (!r || !id) return { run: null, leftOver: [], openGoals: [], items: [] };
  return {
    run: { id, seq: int(r.seq), status: str(r.status), createdAt: strOrNull(r.created_at), approvedAt: strOrNull(r.approved_at), doneAt: strOrNull(r.done_at) },
    leftOver: arr(json.left_over).flatMap((x) => (isObject(x) ? [{ person: uuid(x.person), name: strOrNull(x.name), email: strOrNull(x.email), reason: str(x.reason) }] : [])),
    openGoals: arr(json.open_goals).flatMap((g) => {
      if (!isObject(g)) return [];
      const goal = uuid(g.goal);
      return goal ? [{ goal, title: str(g.title), community: str(g.community), tribesShort: int(g.tribes_short), gap: int(g.gap) }] : [];
    }),
    items: arr(json.items).flatMap((i) => {
      if (!isObject(i)) return [];
      const person = uuid(i.person);
      const goal = uuid(i.goal);
      if (!person || !goal) return [];
      return [{
        person, name: str(i.name) || "A leader", source: i.source === "sheet" ? "sheet" : "approved", goal, title: str(i.title), community: str(i.community),
        degree: int(i.degree), label: str(i.label), status: str(i.status), reason: strOrNull(i.reason), tribe: uuid(i.tribe),
      }];
    }),
  };
}

export type GoalOption = { goal: string; title: string; community: string; degree: number; label: string; gap: number };

export function parseGoalOptions(json: unknown): GoalOption[] {
  return arr(json).flatMap((o) => {
    if (!isObject(o)) return [];
    const goal = uuid(o.goal);
    return goal ? [{ goal, title: str(o.title), community: str(o.community), degree: int(o.degree), label: str(o.label), gap: int(o.gap) }] : [];
  });
}

// ---- the member's side ----

export type PlacedState = {
  found: true;
  firstName: string;
  active: boolean;
  confirmed: boolean;
  withheld: boolean;
  leaderTold: boolean;
  canChange: boolean;
  fit: string;
  hasWhatsapp: boolean;
  /** Whether the leader has this member's contact yet: open, or holding until a date, or waiting for the member's email. */
  contact: "open" | "withheld" | "holding" | "waiting" | "not_reached";
  contactOpensAt: string | null;
  /** True once the clock or God Mode has opened the member's details: the only time "don't share my details" comes too late. */
  contactLate: boolean;
  /** The WhatsApp group shows everyone in it your number, so its link appears only once the member has answered; when it will, if known. */
  groupVisible: boolean;
  groupOpensAt: string | null;
  tribe: {
    name: string; leaderFirst: string; assistantFirst: string | null; meetingDay: number; meetingTime: string; mode: string; placeNote: string;
    groupUrl: string | null; firstMeetingBy: string | null; season: string; startsOn: string; god: string; others: string; life: string;
  };
};

export function parsePlaced(json: unknown): PlacedState | null {
  if (!isObject(json) || json.found !== true || json.placed_by_church !== true || !isObject(json.tribe)) return null;
  const t = json.tribe;
  return {
    found: true,
    firstName: str(json.first_name),
    active: json.active === true,
    confirmed: json.confirmed === true,
    withheld: json.withheld === true,
    leaderTold: json.leader_told === true,
    canChange: json.can_change === true,
    fit: str(json.fit),
    hasWhatsapp: json.has_whatsapp === true,
    contact: (["open", "withheld", "holding", "waiting", "not_reached"] as const).find((x) => x === json.contact) ?? (json.withheld === true ? "withheld" : "open"),
    contactOpensAt: strOrNull(json.contact_opens_at),
    contactLate: json.contact_late === true,
    // an older database has no such field and always showed the link
    groupVisible: json.group_visible !== false,
    groupOpensAt: strOrNull(json.group_opens_at),
    tribe: {
      name: str(t.name), leaderFirst: str(t.leader_first), assistantFirst: strOrNull(t.assistant_first), meetingDay: int(t.meeting_day), meetingTime: str(t.meeting_time),
      mode: str(t.mode), placeNote: str(t.place_note), groupUrl: strOrNull(t.group_url), firstMeetingBy: strOrNull(t.first_meeting_by),
      season: str(t.season), startsOn: str(t.starts_on), god: str(t.god), others: str(t.others), life: str(t.life),
    },
  };
}
