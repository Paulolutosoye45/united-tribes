import { PROMPT_KINDS, isPromptKind, type PromptKind } from "./prompt";

// What the office and the owner see about the sign-in prompt: counts only, read defensively. No name, number, address or answer ever passes through here.

export const KIND_LABELS: Record<PromptKind, string> = {
  placement: "Say yes to a placed tribe",
  interview: "Pick an interview time",
  leader_offer: "Answer an offer to lead a group",
  guardian: "Parent or guardian’s yes",
  ai_consent: "Agree to the application’s first check",
  number: "Add a WhatsApp number",
  whatsapp: "Allow WhatsApp messages",
  joining_form: "Finish the joining form",
  application: "Finish the leader application",
  tribe_card: "Send the Tribe Card",
  care: "Care tasks due",
};

export type KindCounts = { kind: PromptKind; shown: number; wouldShow: number; answered: number; notNow: number; opened: number; people: number };
export type PromptOverview = {
  state: "off" | "rehearsal" | "on";
  days: number;
  visitHours: number;
  maxTasks: number;
  lastHours: number;
  worthCallAfter: number;
  kindsOff: PromptKind[];
  peopleSeen: number;
  peopleWould: number;
  worthACall: number;
  kinds: KindCounts[];
};

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const kindList = (v: unknown): PromptKind[] => (Array.isArray(v) ? v.filter(isPromptKind) : []);

export function parsePromptOverview(v: unknown): PromptOverview | null {
  const o = obj(v);
  if (!o || (o.state !== "off" && o.state !== "rehearsal" && o.state !== "on")) return null;
  const kinds = (Array.isArray(o.kinds) ? o.kinds : []).flatMap((x): KindCounts[] => {
    const k = obj(x);
    if (!k || !isPromptKind(k.kind)) return [];
    return [{ kind: k.kind, shown: num(k.shown), wouldShow: num(k.would_show), answered: num(k.answered), notNow: num(k.not_now), opened: num(k.opened), people: num(k.people) }];
  });
  return {
    state: o.state,
    days: num(o.days) || 7,
    visitHours: num(o.visit_hours),
    maxTasks: num(o.max_tasks),
    lastHours: num(o.last_hours),
    worthCallAfter: num(o.worth_call_after),
    kindsOff: kindList(o.kinds_off),
    peopleSeen: num(o.people_seen),
    peopleWould: num(o.people_would),
    worthACall: num(o.worth_a_call),
    kinds,
  };
}

export const OVERVIEW_WORDS = {
  title: "Sign-in prompt",
  off: "Off. Nobody sees a screen when they sign in.",
  rehearsal: "Rehearsal. Nobody sees a screen. The counts below are who would have seen which task.",
  on: "On. Members and leaders who owe something see one screen when they sign in.",
  lead: (days: number) => `The last ${days} days.`,
  seen: (n: number) => `${n} ${n === 1 ? "person has" : "people have"} seen it.`,
  would: (n: number) => `${n} ${n === 1 ? "person would" : "people would"} have seen it.`,
  worth: (n: number, after: number) =>
    n === 0
      ? `Nobody has put the same task off ${after} times in a row.`
      : `${n} ${n === 1 ? "person has" : "people have"} put the same task off ${after} or more times in a row. Worth a call (a count only: the board names no one here).`,
  empty: "Nothing has been shown yet.",
  columns: { task: "Task", shown: "Shown", would: "Would show", answered: "Answered", notNow: "Not now", opened: "Opened the page" },
  unavailable: "The sign-in prompt’s numbers are not available. If the database has not had the sign-in prompt file applied yet, there is nothing to show.",
} as const;

// ---- the owner's numbers
export type PromptSettings = { visitHours: number; maxTasks: number; lastHours: number; worthCallAfter: number; kindsOff: PromptKind[] };
export const PROMPT_RANGES = { visit: [1, 48], tasks: [1, 5], last: [0, 48], worth: [3, 20] } as const;

export function parsePromptSettings(v: unknown): PromptSettings | null {
  const o = obj(v);
  if (!o || typeof o.visit_hours !== "number" || typeof o.max_tasks !== "number" || typeof o.last_hours !== "number" || typeof o.worth_call_after !== "number") return null;
  return { visitHours: o.visit_hours, maxTasks: o.max_tasks, lastHours: o.last_hours, worthCallAfter: o.worth_call_after, kindsOff: kindList(o.kinds_off) };
}

export type PromptSettingsInput = { visit: string; tasks: string; last: string; worth: string; kindsOff: readonly string[]; reason: string };
export function checkPromptSettings(i: PromptSettingsInput): { ok: true; value: { visit: number; tasks: number; last: number; worth: number; kindsOff: PromptKind[]; reason: string } } | { ok: false; message: string } {
  const one = (raw: string, key: keyof typeof PROMPT_RANGES, label: string): number | string => {
    const t = raw.trim();
    if (!/^\d{1,2}$/.test(t)) return `${label}: use a whole number.`;
    const n = Number(t);
    const [lo, hi] = PROMPT_RANGES[key];
    return n < lo || n > hi ? `${label}: between ${lo} and ${hi}.` : n;
  };
  const visit = one(i.visit, "visit", "Hours away that start a new visit");
  const tasks = one(i.tasks, "tasks", "Tasks in one visit");
  const last = one(i.last, "last", "Hours before release with no Not now");
  const worth = one(i.worth, "worth", "Not nows in a row before a call is worth it");
  for (const n of [visit, tasks, last, worth]) if (typeof n === "string") return { ok: false, message: n };
  const kindsOff = i.kindsOff.filter(isPromptKind);
  if (kindsOff.length !== i.kindsOff.length || kindsOff.length > PROMPT_KINDS.length) return { ok: false, message: "One of the tasks is not one of ours." };
  const reason = i.reason.trim();
  if (reason.length < 5 || reason.length > 300) return { ok: false, message: "Say why you are changing this, in 5 to 300 characters." };
  return { ok: true, value: { visit: visit as number, tasks: tasks as number, last: last as number, worth: worth as number, kindsOff, reason } };
}
