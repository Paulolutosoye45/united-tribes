import { CLASS_WORDS, type MessageClass } from "./classes";

// What the WhatsApp mode pages read (whatsapp_mode_overview, whatsapp_cost_report) and what the hand-sent pages read (hand_context, hand_staff_list), and every
// sentence they say about it. The database builds the data and checks who may see it; this reads the answer defensively, and anything that is not the shape
// expected becomes "nothing", which is how the pages look while the function is Off.

export type ModeName = "full" | "saver" | "free";
export type FunctionState = "off" | "rehearsal" | "on";

export const MODE_WORDS: Record<ModeName, { name: string; line: string; costs: string }> = {
  full: {
    name: "Full",
    line: "Every message goes by WhatsApp first, as it does today, then by email or text.",
    costs: "Meta charges for each message it delivers, so this is the most expensive way.",
  },
  saver: {
    name: "Saver",
    line: "Only the messages that must reach go by WhatsApp. The weekly rhythm and the office messages go by email.",
    costs: "A good part of the cost goes away, and the messages that matter still arrive on WhatsApp.",
  },
  free: {
    name: "Free",
    line: "Nothing is sent through Meta at all. The website makes no request to Meta, so there is nothing to pay. Messages go by email. Leaders send WhatsApp themselves, from their own phone, with the tools on their Lead page.",
    costs: "Nothing is paid to Meta.",
  },
};

export const LOG_KIND_WORDS: Record<string, string> = {
  mode: "mode chosen",
  settings: "numbers changed",
  class: "message class changed",
  rate: "rate entered",
  ceiling_warn: "warned: the month is near the ceiling",
  ceiling_drop: "dropped from Full to Saver: the ceiling was reached",
  quality_drop: "dropped from Full to Saver: Meta rates the number Medium",
  quality_pause: "WhatsApp paused itself: Meta rates the number Low",
};

export type ModeView = {
  state: FunctionState;
  guard: FunctionState;
  paused: boolean;
  chosen: ModeName;
  effective: ModeName;
  changedAt: string | null;
  changedBy: string | null;
  auto: boolean;
  reason: string | null;
  canChange: boolean;
  settings: { ceilingUsd: number | null; warnPct: number; pacePerHour: number; reachPct: number; weeklyCap: number; windowFrom: number; windowTo: number; qualityGuard: boolean };
  month: { sent: number; usd: number; from: string | null };
  week: { a: number; b: number; c: number; total: number; usd: number; usdBC: number };
  classes: { template: string; class: MessageClass }[];
  marketing: string[];
  rates: { category: string; usd: number; effectiveOn: string; source: string | null }[];
  hand: { opened: number; sent: number; skipped: number };
  log: { at: string; kind: string; by: string | null; from: string | null; to: string | null; reason: string | null }[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const stateOf = (v: unknown): FunctionState | null => (v === "off" || v === "rehearsal" || v === "on" ? v : null);
const modeOf = (v: unknown): ModeName | null => (v === "full" || v === "saver" || v === "free" ? v : null);
const classOf = (v: unknown): MessageClass | null => (v === "A" || v === "B" || v === "C" ? v : null);

export function parseModeView(v: unknown): ModeView | null {
  if (!isObj(v)) return null;
  const state = stateOf(v.state);
  const chosen = modeOf(v.chosen);
  const effective = modeOf(v.effective);
  if (!state || !chosen || !effective) return null;
  const s = isObj(v.settings) ? v.settings : {};
  const m = isObj(v.month) ? v.month : {};
  const w = isObj(v.week) ? v.week : {};
  const h = isObj(v.hand) ? v.hand : {};
  return {
    state,
    guard: stateOf(v.guard) ?? "off",
    paused: v.paused === true,
    chosen,
    effective,
    changedAt: str(v.changedAt),
    changedBy: str(v.changedBy),
    auto: v.auto === true,
    reason: str(v.reason),
    canChange: v.canChange === true,
    settings: {
      ceilingUsd: s.ceilingUsd === null || s.ceilingUsd === undefined ? null : num(s.ceilingUsd, 0) || null,
      warnPct: num(s.warnPct, 80),
      pacePerHour: num(s.pacePerHour, 300),
      reachPct: num(s.reachPct, 80),
      weeklyCap: num(s.weeklyCap, 2),
      windowFrom: num(s.windowFrom, 0),
      windowTo: num(s.windowTo, 24),
      qualityGuard: s.qualityGuard !== false,
    },
    month: { sent: num(m.sent), usd: num(m.usd), from: str(m.from) },
    week: { a: num(w.a), b: num(w.b), c: num(w.c), total: num(w.total), usd: num(w.usd), usdBC: num(w.usdBC) },
    classes: arr(v.classes).flatMap((x) => (isObj(x) && typeof x.template === "string" && classOf(x.class) ? [{ template: x.template, class: classOf(x.class) as MessageClass }] : [])),
    marketing: arr(v.marketing).flatMap((x) => (typeof x === "string" ? [x] : [])),
    rates: arr(v.rates).flatMap((x) => (isObj(x) && typeof x.category === "string" ? [{ category: x.category, usd: num(x.usd), effectiveOn: str(x.effectiveOn) ?? "", source: str(x.source) }] : [])),
    hand: { opened: num(h.opened), sent: num(h.sent), skipped: num(h.skipped) },
    log: arr(v.log).flatMap((x) => (isObj(x) && typeof x.at === "string" && typeof x.kind === "string" ? [{ at: x.at, kind: x.kind, by: str(x.by), from: str(x.from), to: str(x.to), reason: str(x.reason) }] : [])),
  };
}

export type CostView = {
  state: FunctionState;
  effective: ModeName;
  rates: { utility: number; marketing: number };
  sum: { n7: number; n30: number; usd7: number; usd30: number; marketing30: number; saver30: number; saverN30: number };
  templates: { template: string; class: MessageClass; marketing: boolean; n7: number; n30: number; usd30: number }[];
  month: { sent: number; usd: number; from: string | null };
  ceilingUsd: number | null;
  canChange: boolean;
};

export function parseCostView(v: unknown): CostView | null {
  if (!isObj(v)) return null;
  const state = stateOf(v.state);
  const effective = modeOf(v.effective);
  if (!state || !effective) return null;
  const r = isObj(v.rates) ? v.rates : {};
  const s = isObj(v.sum) ? v.sum : {};
  const m = isObj(v.month) ? v.month : {};
  return {
    state,
    effective,
    rates: { utility: num(r.utility), marketing: num(r.marketing) },
    sum: { n7: num(s.n7), n30: num(s.n30), usd7: num(s.usd7), usd30: num(s.usd30), marketing30: num(s.marketing30), saver30: num(s.saver30), saverN30: num(s.saverN30) },
    templates: arr(v.templates).flatMap((x) =>
      isObj(x) && typeof x.template === "string" && classOf(x.class)
        ? [{ template: x.template, class: classOf(x.class) as MessageClass, marketing: x.marketing === true, n7: num(x.n7), n30: num(x.n30), usd30: num(x.usd30) }]
        : [],
    ),
    month: { sent: num(m.sent), usd: num(m.usd), from: str(m.from) },
    ceilingUsd: v.ceilingUsd === null || v.ceilingUsd === undefined ? null : num(v.ceilingUsd, 0) || null,
    canChange: v.canChange === true,
  };
}

export type HandMember = { person: string; name: string; first: string; wa: boolean; open: boolean; onlyWa: boolean };
export type HandLine = { id: number; at: string; scope?: string; kind: string; outcome: string; by: string | null; person: string | null };
export type HandContext = {
  state: FunctionState;
  mode: ModeName;
  free: boolean;
  tribe: { id: string; name: string; groupUrl: string | null };
  members: HandMember[];
  unsent: string[];
  recent: HandLine[];
};

const handLine = (x: unknown): HandLine[] =>
  isObj(x) && typeof x.at === "string" && typeof x.kind === "string" && typeof x.outcome === "string"
    ? [{ id: num(x.id), at: x.at, scope: str(x.scope) ?? undefined, kind: x.kind, outcome: x.outcome, by: str(x.by), person: str(x.person) }]
    : [];

export function parseHandContext(v: unknown): HandContext | null {
  if (!isObj(v)) return null;
  const state = stateOf(v.state);
  const mode = modeOf(v.mode);
  const t = isObj(v.tribe) ? v.tribe : null;
  if (!state || !mode || !t || typeof t.id !== "string" || typeof t.name !== "string") return null;
  return {
    state,
    mode,
    free: v.free === true,
    tribe: { id: t.id, name: t.name, groupUrl: str(t.groupUrl) },
    members: arr(v.members).flatMap((x) =>
      isObj(x) && typeof x.person === "string" ? [{ person: x.person, name: str(x.name) ?? "A member", first: str(x.first) ?? "there", wa: x.wa === true, open: x.open !== false, onlyWa: x.onlyWa === true }] : [],
    ),
    unsent: arr(v.unsent).flatMap((x) => (typeof x === "string" ? [x] : [])),
    recent: arr(v.recent).flatMap(handLine),
  };
}

export type StaffList = { state: FunctionState; free: boolean; people: { person: string; name: string; first: string; role: string; tribe: string | null }[]; recent: HandLine[] };

export function parseStaffList(v: unknown): StaffList | null {
  if (!isObj(v)) return null;
  const state = stateOf(v.state);
  if (!state) return null;
  return {
    state,
    free: v.free === true,
    people: arr(v.people).flatMap((x) =>
      isObj(x) && typeof x.person === "string" ? [{ person: x.person, name: str(x.name) ?? "Someone", first: str(x.first) ?? "there", role: str(x.role) ?? "leader", tribe: str(x.tribe) }] : [],
    ),
    recent: arr(v.recent).flatMap(handLine),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export const usd = (n: number) => `US$${n.toFixed(2)}`;
export const usdSmall = (n: number) => `US$${n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;

/** The one line at the top of the mode page: what is in force, and why, in words. */
export function modeHeadline(v: ModeView): { word: string; tone: "good" | "warn" | "quiet"; line: string } {
  if (v.state === "off") return { word: "Off", tone: "quiet", line: "WhatsApp mode is Off in God Mode, so WhatsApp goes out exactly as it did before. Nothing on this page changes anything yet." };
  if (v.state === "rehearsal") {
    return { word: "Rehearsal", tone: "quiet", line: `WhatsApp mode is in Rehearsal. Nothing changes: WhatsApp goes out as before. Below is what each mode would have done to the last seven days.` };
  }
  if (v.guard !== "on") return { word: "Waiting", tone: "quiet", line: "WhatsApp mode needs the WhatsApp safety net to be On first. Until then WhatsApp goes out as before." };
  const m = MODE_WORDS[v.effective];
  return { word: m.name, tone: v.effective === "full" ? "good" : "warn", line: m.line };
}

/** Who chose the mode and when, in words. */
export function changedWords(v: ModeView, when: (iso: string) => string): string | null {
  if (!v.changedAt) return null;
  return v.auto ? `Changed by the rule on ${when(v.changedAt)}${v.reason ? `: ${v.reason.replace(/^Automatic: /, "")}` : ""}` : `Chosen by ${v.changedBy ?? "someone in the office"} on ${when(v.changedAt)}${v.reason ? `: ${v.reason}` : ""}`;
}

export function classLine(c: MessageClass): string {
  return `${CLASS_WORDS[c].name} (${CLASS_WORDS[c].short}): ${CLASS_WORDS[c].saver} in Saver`;
}

export const HOUR_WORDS = (h: number): string => (h === 0 || h === 24 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} am` : `${h - 12} pm`);

/** The month so far against the ceiling, in a sentence. */
export function monthWords(month: ModeView["month"], ceiling: number | null, when: (iso: string) => string): string {
  const base = `${month.sent} WhatsApp ${month.sent === 1 ? "message" : "messages"} since ${month.from ? when(month.from) : "the start of the month"}, about ${usd(month.usd)} at the rates entered.`;
  if (!ceiling) return `${base} No ceiling is set.`;
  return `${base} The ceiling is ${usd(ceiling)} (${Math.min(100, Math.round((month.usd / ceiling) * 100))}% used).`;
}

/** What the leader sends to the group each week: the texts they can copy. */
export const GROUP_KINDS = [
  { key: "week_start", label: "This week's passage and step" },
  { key: "meeting_reminder", label: "Reminder for the meeting" },
  { key: "meeting_recap", label: "Thank you after the meeting" },
  { key: "custom", label: "Something else" },
] as const;
export type GroupKind = (typeof GROUP_KINDS)[number]["key"];

/** What a leader may send to one person, each a kind the log knows. */
export const PERSON_KINDS = [
  { key: "welcome", label: "Welcome them" },
  { key: "missed_two", label: "Check on them after two missed weeks" },
  { key: "step", label: "Ask about their step this week" },
  { key: "thanks", label: "Thank them" },
  { key: "other", label: "Something else" },
] as const;
export type PersonKind = (typeof PERSON_KINDS)[number]["key"];

/** A wa.me address for a number: digits only, as WhatsApp wants, with the text ready to send. */
export function chatLink(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
