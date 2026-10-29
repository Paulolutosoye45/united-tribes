import { AUDIENCES, DETAIL_KEYS, FACT_KEYS, ITEM_STATUSES, LEFT_OUT_REASONS, STORY_KEYS, type Answered, type Audience, type CheckPerson, type CheckStatus, type CheckSummary, type CodeChecked, type CodeSent, type DetailKey, type FactKey, type FactOption, type FactState, type ItemStatus, type LeftOutReason, type LinkState, type OfficeAsk, type OfficeAsked, type OfficeStatus, type Outcome, type PageChange, type PageDetail, type PageFact, type PagePanel, type PageState, type Plan, type Saved, type Sent, type StageReview, type StageReviews, type StageStatus, type StillRight, type StoryKey } from "./types";
import { APPLICANT_WORDS } from "./wording";

// What the database answers is data, not a promise. Each answer is read defensively: anything that is not the shape expected becomes
// "nothing", so a screen says "not available" rather than breaking.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const isFactKey = (v: unknown): v is FactKey => typeof v === "string" && (FACT_KEYS as readonly string[]).includes(v);
const factKeys = (v: unknown): FactKey[] => arr(v).filter(isFactKey);
export const isAudienceKind = (v: unknown): boolean => typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
const factState = (v: unknown): FactState => (v === "confirmed" ? "confirmed" : "unconfirmed");
const itemStatus = (v: unknown): ItemStatus => (typeof v === "string" && (ITEM_STATUSES as readonly string[]).includes(v) ? (v as ItemStatus) : "queued");
const OUTCOMES: readonly Outcome[] = ["confirmed", "recorded", "applied_now", "pending_review", "not_me", "later"];

function options(v: unknown): FactOption[] {
  return arr(v).flatMap((o) => (isObj(o) && typeof o.value === "string" && typeof o.label === "string" ? [{ value: o.value, label: o.label, detail: strOrNull(o.detail) }] : []));
}

function leftOut(v: unknown): Partial<Record<LeftOutReason, number>> {
  const out: Partial<Record<LeftOutReason, number>> = {};
  if (!isObj(v)) return out;
  for (const k of LEFT_OUT_REASONS) if (typeof v[k] === "number" && v[k] > 0) out[k] = v[k] as number;
  return out;
}

function counts(v: unknown): Partial<Record<ItemStatus, number>> {
  const out: Partial<Record<ItemStatus, number>> = {};
  if (!isObj(v)) return out;
  for (const k of ITEM_STATUSES) if (typeof v[k] === "number" && v[k] > 0) out[k] = v[k] as number;
  return out;
}

// ---- My page ----
export function parsePage(v: unknown): PageState {
  if (!isObj(v) || v.enabled !== true) return { enabled: false };
  const facts: PageFact[] = [];
  for (const raw of arr(v.facts)) {
    if (!isObj(raw) || !isFactKey(raw.key) || typeof raw.value !== "string") continue;
    const c = isObj(raw.change) ? raw.change : null;
    const change: PageChange | null =
      c && (c.status === "pending" || c.status === "approved" || c.status === "declined")
        ? { status: c.status, newLabel: str(c.newLabel), note: strOrNull(c.note), dueOn: strOrNull(c.dueOn), at: str(c.at) }
        : null;
    const l = isObj(raw.last) ? raw.last : null;
    facts.push({
      key: raw.key,
      label: str(raw.label, raw.key),
      // The database puts the value into the question; a question that still holds the placeholder (an older answer) is filled in here, so a raw {value} is never shown
      question: str(raw.question, "We have you down as {value}. Is that right?").replace("{value}", str(raw.valueLabel, raw.value)),
      state: factState(raw.state),
      value: raw.value,
      valueLabel: str(raw.valueLabel, raw.value),
      by: str(raw.by, "office"),
      at: strOrNull(raw.at),
      options: options(raw.options),
      change,
      last: l && typeof l.event === "string" ? { event: l.event, at: str(l.at) } : null,
    });
  }
  return {
    enabled: true,
    first: str(v.first),
    facts,
    details: details(v.details, DETAIL_KEYS),
    story: details(v.story, STORY_KEYS),
    panels: panels(v.panels),
    canAsk: v.canAsk === true,
    office: officeStatus(v.office),
  };
}

const KINDS = ["text", "choice", "monthday", "gifts"] as const;

/** The typed facts and the story fields. A field the website does not know is left out, so a newer database never breaks an older page. */
function details<K extends DetailKey | StoryKey>(v: unknown, known: readonly K[]): PageDetail[] {
  const out: PageDetail[] = [];
  for (const raw of arr(v)) {
    if (!isObj(raw) || typeof raw.key !== "string" || !(known as readonly string[]).includes(raw.key)) continue;
    const kind = KINDS.find((k) => k === raw.kind);
    if (!kind) continue;
    out.push({
      key: raw.key as K,
      label: str(raw.label, raw.key),
      question: str(raw.question),
      kind,
      changeClass: raw.class === "B" ? "B" : "A",
      value: str(raw.value),
      valueLabel: str(raw.valueLabel, str(raw.value)),
      at: strOrNull(raw.at),
      options: options(raw.options),
      max: numOrNull(raw.max),
      limit: numOrNull(raw.limit),
    });
  }
  return out;
}

function panels(v: unknown): PagePanel[] {
  const out: PagePanel[] = [];
  for (const raw of arr(v)) {
    if (!isObj(raw) || typeof raw.key !== "string") continue;
    const lines = arr(raw.lines).flatMap((l) => {
      if (!isObj(l) || typeof l.label !== "string") return [];
      // An applicant's line carries a status code; the website puts the words on it
      const value = typeof l.value === "string" ? l.value : typeof l.code === "string" ? (APPLICANT_WORDS[l.code] ?? "Being looked at") : null;
      return value === null ? [] : [{ label: l.label, value }];
    });
    const link = isObj(raw.link) && typeof raw.link.label === "string" && typeof raw.link.path === "string" && /^\/(?!\/)[a-z0-9/_-]*$/i.test(raw.link.path) ? { label: raw.link.label, path: raw.link.path } : null;
    if (lines.length > 0) out.push({ key: raw.key, title: str(raw.title, raw.key), lines, link });
  }
  return out;
}

function officeStatus(v: unknown): OfficeStatus | null {
  if (!isObj(v) || (v.status !== "open" && v.status !== "done")) return null;
  return { status: v.status, askedAt: str(v.askedAt), closedAt: strOrNull(v.closedAt), note: strOrNull(v.note) };
}

export function parseSaved(v: unknown): Saved {
  if (isObj(v) && v.ok === true && (v.outcome === "saved" || v.outcome === "cleared")) return { ok: true, outcome: v.outcome };
  return { ok: false, reason: isObj(v) ? str(v.reason, "unknown") : "unknown", message: isObj(v) ? strOrNull(v.message) : null };
}

export function parseOfficeAsked(v: unknown): OfficeAsked {
  if (isObj(v) && v.ok === true) return { ok: true };
  return { ok: false, reason: isObj(v) ? str(v.reason, "unknown") : "unknown", message: isObj(v) ? strOrNull(v.message) : null };
}

/** The Home strip. Anything unreadable is "not due": a person who is not sure is simply not asked. */
export function parseStillRight(v: unknown): StillRight {
  if (!isObj(v) || v.due !== true) return { due: false };
  const items = arr(v.items).flatMap((raw) =>
    isObj(raw) && isFactKey(raw.key) ? [{ key: raw.key, label: str(raw.label, raw.key), valueLabel: str(raw.valueLabel), options: options(raw.options) }] : [],
  );
  return items.length > 0 ? { due: true, season: str(v.season), items } : { due: false };
}

export function parseOfficeAsks(v: unknown): OfficeAsk[] | null {
  if (!isObj(v)) return null;
  return arr(v.asks).flatMap((raw) => {
    if (!isObj(raw) || typeof raw.id !== "string") return [];
    return [
      {
        id: raw.id,
        status: raw.status === "done" ? ("done" as const) : ("open" as const),
        person: str(raw.person, "Someone"),
        held: str(raw.held),
        note: strOrNull(raw.note),
        askedAt: str(raw.askedAt),
        closedAt: strOrNull(raw.closedAt),
        closingNote: strOrNull(raw.closingNote),
      },
    ];
  });
}

export function parseAnswered(v: unknown): Answered {
  if (!isObj(v)) return { ok: false, reason: "unknown", message: null };
  if (v.ok === true && typeof v.outcome === "string" && (OUTCOMES as readonly string[]).includes(v.outcome)) return { ok: true, outcome: v.outcome as Outcome };
  return { ok: false, reason: str(v.reason, "unknown"), message: strOrNull(v.message) };
}

// ---- stage reviews ----
export function parseReviews(v: unknown): StageReviews | null {
  if (!isObj(v)) return null;
  const reviews: StageReview[] = [];
  for (const raw of arr(v.reviews)) {
    if (!isObj(raw) || typeof raw.id !== "string") continue;
    const status = raw.status === "approved" || raw.status === "declined" ? raw.status : "pending";
    reviews.push({
      id: raw.id,
      status,
      person: str(raw.person, "Someone"),
      first: str(raw.first, "They"),
      fact: str(raw.fact, "Detail"),
      key: str(raw.key),
      oldLabel: strOrNull(raw.oldLabel),
      newLabel: strOrNull(raw.newLabel),
      tribe: strOrNull(raw.tribe),
      members: num(raw.members),
      requestedAt: str(raw.requestedAt),
      dueOn: str(raw.dueOn),
      overdue: raw.overdue === true,
      decidedAt: strOrNull(raw.decidedAt),
      note: strOrNull(raw.note),
    });
  }
  return { canDecide: v.canDecide === true, reviews };
}

export function parseStageStatus(v: unknown): StageStatus | null {
  if (!isObj(v) || typeof v.state !== "string") return null;
  const hold = v.hold === "optional" || v.hold === "required" || v.hold === "rehearsal" || v.hold === "on" ? v.hold : "off";
  return { state: factState(v.state), leader: strOrNull(v.leader), card: strOrNull(v.card), differs: v.differs === true, hold, pending: strOrNull(v.pending) };
}

// ---- the console ----
export function parsePlan(v: unknown): Plan | null {
  if (!isObj(v) || typeof v.asked !== "number") return null;
  return { asked: v.asked, leftOut: leftOut(v.leftOut), facts: factKeys(v.facts) };
}

export function parseSent(v: unknown): Sent | null {
  if (!isObj(v) || v.ok !== true || typeof v.check !== "string") return null;
  return { check: v.check, asked: num(v.asked), mode: v.mode === "live" ? "live" : "rehearsal", leftOut: leftOut(v.leftOut) };
}

function summaryOf(raw: Record<string, unknown>): Omit<CheckSummary, "counts"> | null {
  if (typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    at: str(raw.at),
    mode: raw.mode === "live" ? "live" : "rehearsal",
    facts: factKeys(raw.facts),
    audience: str(raw.audience),
    asked: num(raw.asked),
    leftOut: leftOut(raw.leftOut),
    closed: raw.closed === true,
  };
}

export function parseChecks(v: unknown): CheckSummary[] {
  return arr(v).flatMap((raw) => {
    if (!isObj(raw)) return [];
    const s = summaryOf(raw);
    return s ? [{ ...s, counts: counts(raw.counts) }] : [];
  });
}

export function parseCheckStatus(v: unknown): CheckStatus | null {
  if (!isObj(v)) return null;
  const s = summaryOf(v);
  if (!s) return null;
  const people: CheckPerson[] = [];
  for (const raw of arr(v.people)) {
    if (!isObj(raw) || typeof raw.id !== "string") continue;
    people.push({
      id: raw.id,
      name: str(raw.name, "Someone"),
      status: itemStatus(raw.status),
      sent: raw.sent === true,
      channel: strOrNull(raw.channel),
      opened: raw.opened === true,
      reminded: raw.reminded === true,
      asked: raw.asked === true,
      at: str(raw.at),
      wouldSend: strOrNull(raw.wouldSend),
    });
  }
  return { ...s, corrected: num(v.corrected), people };
}

// ---- the private page ----
export function parseLink(v: unknown): LinkState {
  if (!isObj(v) || v.found !== true) {
    const reason = isObj(v) && (v.reason === "signed_out" || v.reason === "other_account") ? v.reason : null;
    return { found: false, reason };
  }
  if (v.needsCode === true) return { found: true, needsCode: true };
  if (v.done === true) return { found: true, done: true, first: str(v.first), waiting: v.waiting === true };
  if (isFactKey(v.key)) {
    return {
      found: true,
      done: false,
      first: str(v.first),
      key: v.key,
      label: str(v.label),
      question: str(v.question),
      valueLabel: str(v.valueLabel),
      options: options(v.options),
      left: num(v.left, 1),
    };
  }
  return { found: false, reason: null };
}

export function parseCodeSent(v: unknown): CodeSent {
  if (isObj(v) && v.ok === true && (v.via === "email" || v.via === "sms")) return { ok: true, via: v.via, to: str(v.to) };
  const reason = isObj(v) && (v.reason === "locked" || v.reason === "too_many" || v.reason === "no_way") ? v.reason : "invalid";
  return { ok: false, reason, minutes: isObj(v) ? numOrNull(v.minutes) : null };
}

export function parseCodeChecked(v: unknown): CodeChecked {
  if (isObj(v) && v.ok === true && typeof v.session === "string" && /^[a-f0-9]{64}$/.test(v.session)) return { ok: true, session: v.session };
  const r = isObj(v) ? v.reason : null;
  const reason = r === "locked" || r === "expired" || r === "format" || r === "wrong" ? r : "invalid";
  return { ok: false, reason, minutes: isObj(v) ? numOrNull(v.minutes) : null, triesLeft: isObj(v) ? numOrNull(v.triesLeft) : null };
}

/** Reads the audience the console sends back to the database, refusing anything that is not one of the five kinds. */
export function cleanAudience(v: unknown, isUuid: (x: unknown) => boolean): Audience | null {
  if (!isObj(v) || typeof v.kind !== "string") return null;
  switch (v.kind) {
    case "appointed":
    case "leaders":
    case "unconfirmed":
      return { kind: v.kind };
    case "tribe":
      return isUuid(v.tribe) ? { kind: "tribe", tribe: v.tribe as string } : null;
    case "list":
      return Array.isArray(v.people) && v.people.length >= 1 && v.people.length <= 400 && v.people.every(isUuid) ? { kind: "list", people: v.people as string[] } : null;
    default:
      return null;
  }
}
