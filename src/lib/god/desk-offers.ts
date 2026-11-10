// The Leader Desk's leader offers (Phase 2b-1), as the God Mode screens read them. Every parser takes whatever the database sent and gives back something safe to
// show: anything it does not understand becomes nothing, never a guess. Reasons a member gave for "Not this season" are only ever counted, never shown by name.

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

export const OFFER_STATUSES = ["would_send", "queued", "open", "review", "accepted", "declined", "expired", "cancelled", "skipped"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
const ANSWERS = ["lead", "not_season", "never", "stop", "owner"] as const;
export type OfferAnswer = (typeof ANSWERS)[number];

export const OWNER_OFFER_WORDS = {
  title: "Leader offers",
  intro:
    "A leader is offered one draft group at a time: one member now, and up to two backups who are asked in turn if the first says no or does not answer in time. Each offer is answered on a private page, and the person is only appointed if they say yes.",
  button: "Recommend a leader",
  looking: "Looking for members who could lead it…",
  none: "No waiting member can be offered this group right now.",
  pick: "Choose one to ask now. Choose up to two more, and they will be asked in the order you pick them if the first says no or does not answer.",
  limit: (n: number) => `You can choose up to ${n + 1}: one now and ${n} backup${n === 1 ? "" : "s"}.`,
  order: (n: number) => (n === 1 ? "Asked first" : n === 2 ? "First backup" : "Second backup"),
  on: "This sends one email now, to the first person only. The backups are asked only if they are needed.",
  rehearsal: "This is Rehearsal: it is only written down, and nothing is sent.",
  confirm: "Ask them",
  confirmRehearsal: "Write it down",
  cancel: "Not now",
  sent: "The first person has been emailed. The backups wait their turn.",
  written: "Written down. Nothing was sent.",
  withdraw: "Withdraw",
  withdrawAll: "Withdraw all",
  appoint: "Appoint them",
  decline: "Decline for them",
  pause: "Pause backups",
  resume: "Resume backups",
  paused: "Backups are paused for this group. Nobody else will be asked until you resume.",
  needsDecision: "Nobody is being asked about this group now, and it has no leader. Recommend someone else.",
  callMe: "Asked for a call",
  review: "Said yes, below the usual fit. Your decision.",
  noLeader: "This group has no leader yet.",
  listTitle: "Every offer",
  listEmpty: "No leader has been offered a group yet.",
  reasonsTitle: "Reasons given for “Not this season”",
  reasonsHelp: "Counted only. Nobody sees which reason is whose.",
  reasonLabels: { busy: "Too busy", family: "Family or home first", not_ready: "Not ready yet", other_goal: "A different goal", other: "Something else" } as Record<string, string>,
  status: {
    would_send: "Written down in Rehearsal",
    queued: "Waiting its turn",
    open: "Asked, waiting for an answer",
    review: "Said yes, waiting for you",
    accepted: "Said yes, now the leader",
    declined: "Said no",
    expired: "Did not answer in time",
    cancelled: "Withdrawn",
    skipped: "Skipped, no longer fits",
  } as Record<OfferStatus, string>,
  answer: { lead: "said yes", not_season: "not this season", never: "never ask me to lead", stop: "stopped all Desk email", owner: "declined by you" } as Record<OfferAnswer, string>,
  tribe: {
    draft: "The tribe card has been started. The leader is filling it in.",
    changes_requested: "The pastors asked for changes to the tribe card.",
    submitted: "The tribe card is with the pastors.",
    approved: "The tribe card is approved.",
    closed: "The tribe is closed.",
  } as Record<string, string>,
  certified: "Certified.",
  notCertified: "Not yet certified by the Academy.",
} as const;

export type Candidate = { personId: string; name: string; score: number; pool: string; notes: string[]; inGroup: boolean; phone: string | null; hasNumber: boolean };
export type Candidates = { problem: string | null; rows: Candidate[] };
export const EMPTY_CANDIDATES: Candidates = { problem: null, rows: [] };

export function parseCandidates(v: unknown): Candidates | null {
  if (!isObj(v)) return null;
  const rows: Candidate[] = [];
  for (const r of list(v.rows)) {
    if (!isObj(r)) continue;
    const pid = id(r.person_id);
    if (!pid) continue;
    rows.push({
      personId: pid,
      name: text(r.name) ?? "A member",
      score: int(r.score),
      pool: text(r.pool) ?? "members",
      notes: list(r.notes).filter((n): n is string => typeof n === "string"),
      inGroup: r.in_group === true,
      phone: text(r.phone),
      hasNumber: r.has_number === true,
    });
  }
  return { problem: text(v.problem), rows };
}

export type OfferRow = {
  id: string;
  round: number;
  seq: number;
  personId: string;
  name: string;
  status: OfferStatus;
  rehearsal: boolean;
  openedAt: string | null;
  windowEndsAt: string | null;
  callMe: boolean;
  answer: OfferAnswer | null;
  fit: number | null;
  phone: string | null;
  hasNumber: boolean;
};

export type GroupLeader = {
  problem: string | null;
  paused: boolean;
  leader: { personId: string; name: string; foundAt: string | null; tribeId: string | null; tribeStatus: string | null; certified: boolean } | null;
  needsDecision: boolean;
  offers: OfferRow[];
};
export const EMPTY_LEADER: GroupLeader = { problem: null, paused: false, leader: null, needsDecision: false, offers: [] };

function parseOffer(r: unknown): OfferRow | null {
  if (!isObj(r)) return null;
  const oid = id(r.id);
  const pid = id(r.person_id);
  const status = OFFER_STATUSES.find((s) => s === r.status);
  if (!oid || !pid || !status) return null;
  return {
    id: oid,
    round: int(r.round),
    seq: int(r.seq),
    personId: pid,
    name: text(r.name) ?? "A member",
    status,
    rehearsal: r.rehearsal === true,
    openedAt: text(r.opened_at),
    windowEndsAt: text(r.window_ends_at),
    callMe: r.call_me === true,
    answer: ANSWERS.find((a) => a === r.answer) ?? null,
    fit: typeof r.fit === "number" ? Math.round(r.fit) : null,
    phone: text(r.phone),
    hasNumber: r.has_number === true,
  };
}

export function parseGroupLeader(v: unknown): GroupLeader {
  if (!isObj(v)) return EMPTY_LEADER;
  const l = isObj(v.leader) ? v.leader : null;
  const lid = l ? id(l.person_id) : null;
  return {
    problem: text(v.problem),
    paused: v.paused === true,
    leader:
      l && lid
        ? { personId: lid, name: text(l.name) ?? "The leader", foundAt: text(l.found_at), tribeId: id(l.tribe_id), tribeStatus: text(l.tribe_status), certified: l.certified === true }
        : null,
    needsDecision: v.needs_decision === true,
    offers: list(v.offers).map(parseOffer).filter((o): o is OfferRow => o !== null),
  };
}

export type OfferListRow = OfferRow & { groupId: string; group: string; at: string | null };
export type OffersPage = {
  total: number;
  counts: { open: number; review: number; accepted: number; declined: number; expired: number; wouldSend: number; callMe: number };
  reasons: Record<string, number>;
  rows: OfferListRow[];
};
export const EMPTY_OFFERS: OffersPage = { total: 0, counts: { open: 0, review: 0, accepted: 0, declined: 0, expired: 0, wouldSend: 0, callMe: 0 }, reasons: {}, rows: [] };

export function parseOffersList(v: unknown): OffersPage {
  if (!isObj(v)) return EMPTY_OFFERS;
  const c = isObj(v.counts) ? v.counts : {};
  const reasons: Record<string, number> = {};
  if (isObj(v.reasons)) for (const [k, n] of Object.entries(v.reasons)) if (k in OWNER_OFFER_WORDS.reasonLabels) reasons[k] = int(n);
  const rows: OfferListRow[] = [];
  for (const r of list(v.rows)) {
    const o = parseOffer(r);
    if (!o || !isObj(r)) continue;
    const gid = id(r.group_id);
    if (!gid) continue;
    rows.push({ ...o, groupId: gid, group: text(r.group) ?? "A group", at: text(r.at) });
  }
  return {
    total: int(v.total),
    counts: {
      open: int(c.open),
      review: int(c.review),
      accepted: int(c.accepted),
      declined: int(c.declined),
      expired: int(c.expired),
      wouldSend: int(c.would_send),
      callMe: int(c.call_me),
    },
    reasons,
    rows,
  };
}

/** What the screen says about one offer: who, in what order, and where it stands. */
export function offerLine(o: Pick<OfferRow, "status" | "answer" | "seq" | "callMe">): string {
  const base = OWNER_OFFER_WORDS.status[o.status];
  const answered = o.status === "declined" && o.answer ? `, ${OWNER_OFFER_WORDS.answer[o.answer]}` : "";
  return `${base}${answered}${o.callMe && o.status === "open" ? `. ${OWNER_OFFER_WORDS.callMe}` : ""}`;
}

/** Whether an offer can still be withdrawn. */
export const canWithdrawOffer = (o: Pick<OfferRow, "status">): boolean => o.status === "would_send" || o.status === "queued" || o.status === "open";

/** Where a group's leader stands, in words: the tribe card's state and whether the Academy has certified them. */
export function leaderStage(l: NonNullable<GroupLeader["leader"]>): string {
  const card = OWNER_OFFER_WORDS.tribe[l.tribeStatus ?? ""] ?? OWNER_OFFER_WORDS.tribe.draft;
  return `${card} ${l.certified ? OWNER_OFFER_WORDS.certified : OWNER_OFFER_WORDS.notCertified}`;
}

/** The latest round's offers for a group, first to last. */
export function latestRound(offers: OfferRow[]): OfferRow[] {
  if (offers.length === 0) return [];
  const last = Math.max(...offers.map((o) => o.round));
  return offers.filter((o) => o.round === last).sort((a, b) => a.seq - b.seq);
}
