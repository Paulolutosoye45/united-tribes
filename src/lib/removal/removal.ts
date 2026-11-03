// Leader removal requests (stage 4 of "WhatsApp that cannot fail quietly"): what the screens read from the database (removal_mine, removal_board,
// my_removal), the reasons a leader can give, the limits on the note, and every sentence the screens say. Off, the database answers "off" and every screen
// is as it was. A leader never removes anyone: they ask, and a person with the right to decides.

export type RemovalState = "off" | "rehearsal" | "on";

export const REASONS = [
  { id: "safety_or_conduct", label: "Safety or conduct", hint: "Someone may be hurt, or behaviour is putting the group at risk. Only the Care Team, a director or an admin decides these." },
  { id: "repeated_absence", label: "Repeated absence", hint: "They have been away for weeks and have not answered." },
  { id: "conflict", label: "Conflict in the tribe", hint: "A disagreement that you and the tribe could not settle." },
  { id: "not_a_fit", label: "Not a fit for this tribe", hint: "The tribe is not right for them, or they are not right for it." },
  { id: "other", label: "Something else", hint: "Tell the person who decides what has happened." },
] as const;
export type ReasonId = (typeof REASONS)[number]["id"];
export const reasonLabel = (id: string) => REASONS.find((r) => r.id === id)?.label ?? "Something else";
const isReason = (v: unknown): v is ReasonId => REASONS.some((r) => r.id === v);

export const NOTE_MIN = 20;
export const NOTE_MAX = 500;
export const DECISION_NOTE_MIN = 10;
export const DECISION_NOTE_MAX = 500;
export const MAX_OPEN = 2;
export const APPEAL_DAYS = 14;

export type Status = "open" | "approved" | "declined" | "withdrawn";
export type Waiting = "approver" | "leader";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback);
const state = (v: unknown): RemovalState => (v === "on" || v === "rehearsal" ? v : "off");
const status = (v: unknown): Status => (v === "approved" || v === "declined" || v === "withdrawn" ? v : "open");

// ---------------------------------------------------------------------------
// The leader's view of their own tribe
// ---------------------------------------------------------------------------
export type MineRequest = {
  id: string;
  member_id: string;
  member_first: string;
  status: Status;
  waiting_on: Waiting;
  rehearsal: boolean;
  created_at: string;
  decided_at: string | null;
  /** The question put to the leader, while the request waits for their answer. */
  question: string | null;
  /** What the person who declined it wrote, so the leader reads it from the church and not from a stranger. */
  decision_note: string | null;
};
export type Mine = { state: RemovalState; can_ask: boolean; open: number; max: number; requests: MineRequest[] };
export const MINE_OFF: Mine = { state: "off", can_ask: false, open: 0, max: MAX_OPEN, requests: [] };

/** Reads the database's answer defensively: anything not clearly in the shape means Off. */
export function parseMine(data: unknown): Mine {
  if (!isObj(data) || state(data.state) === "off" || data.can_ask !== true) return MINE_OFF;
  const requests = (Array.isArray(data.requests) ? data.requests : []).flatMap((r): MineRequest[] => {
    if (!isObj(r)) return [];
    const id = str(r.id);
    const member_id = str(r.member_id);
    if (!id || !member_id) return [];
    return [
      {
        id,
        member_id,
        member_first: str(r.member_first) ?? "Your member",
        status: status(r.status),
        waiting_on: r.waiting_on === "leader" ? "leader" : "approver",
        rehearsal: r.rehearsal === true,
        created_at: str(r.created_at) ?? "",
        decided_at: str(r.decided_at),
        question: str(r.question),
        decision_note: str(r.decision_note),
      },
    ];
  });
  return { state: state(data.state), can_ask: true, open: int(data.open), max: int(data.max, MAX_OPEN) || MAX_OPEN, requests };
}

// ---------------------------------------------------------------------------
// The board for the people who decide
// ---------------------------------------------------------------------------
export type ThreadLine = { side: "approver" | "leader"; body: string | null; at: string };
/** What the coach of the tribe suggested, for the person deciding to read first. The leader who asked never receives it. */
export type Recommendation = { decision: "approve" | "decline" | "ask"; note: string | null; by: string | null; at: string };
export type BoardRequest = {
  id: string;
  tribe: string;
  member: string;
  member_first: string;
  under_18: boolean;
  leader: string;
  reason: ReasonId;
  note: string | null;
  note_cleared: boolean;
  urgent: boolean;
  restricted: boolean;
  rehearsal: boolean;
  status: Status;
  waiting_on: Waiting;
  created_at: string;
  days: number;
  reminded: boolean;
  escalated: boolean;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  can_decide: boolean;
  /** The coach of the tribe may recommend an ordinary request; they cannot close it. */
  can_recommend: boolean;
  recommendation: Recommendation | null;
  can_reinstate: boolean;
  can_judge_appeal: boolean;
  reinstated_at: string | null;
  appeal: { status: "open" | "upheld" | "reinstated"; note: string | null; at: string; decision_note: string | null } | null;
  attendance: { present: number; absent: number; excused: number };
  thread: ThreadLine[];
};
export type Board = { state: RemovalState; requests: BoardRequest[] };
export const BOARD_OFF: Board = { state: "off", requests: [] };

export function parseBoard(data: unknown): Board {
  if (!isObj(data) || state(data.state) === "off") return BOARD_OFF;
  const requests = (Array.isArray(data.requests) ? data.requests : []).flatMap((r): BoardRequest[] => {
    if (!isObj(r)) return [];
    const id = str(r.id);
    if (!id) return [];
    const a = isObj(r.attendance) ? r.attendance : {};
    const ap = isObj(r.appeal) ? r.appeal : null;
    const rec = isObj(r.recommendation) ? r.recommendation : null;
    return [
      {
        id,
        tribe: str(r.tribe) ?? "A tribe",
        member: str(r.member) ?? "A member",
        member_first: str(r.member_first) ?? "The member",
        under_18: r.under_18 === true,
        leader: str(r.leader) ?? "A leader",
        reason: isReason(r.reason) ? r.reason : "other",
        note: str(r.note),
        note_cleared: r.note_cleared === true,
        urgent: r.urgent === true,
        restricted: r.restricted === true,
        rehearsal: r.rehearsal === true,
        status: status(r.status),
        waiting_on: r.waiting_on === "leader" ? "leader" : "approver",
        created_at: str(r.created_at) ?? "",
        days: int(r.days),
        reminded: r.reminded === true,
        escalated: r.escalated === true,
        decided_at: str(r.decided_at),
        decided_by: str(r.decided_by),
        decision_note: str(r.decision_note),
        can_decide: r.can_decide === true,
        can_recommend: r.can_recommend === true,
        recommendation:
          rec && (rec.decision === "approve" || rec.decision === "decline" || rec.decision === "ask")
            ? { decision: rec.decision, note: str(rec.note), by: str(rec.by), at: str(rec.at) ?? "" }
            : null,
        can_reinstate: r.can_reinstate === true,
        can_judge_appeal: r.can_judge_appeal === true,
        reinstated_at: str(r.reinstated_at),
        appeal: ap
          ? { status: ap.status === "upheld" || ap.status === "reinstated" ? ap.status : "open", note: str(ap.note), at: str(ap.at) ?? "", decision_note: str(ap.decision_note) }
          : null,
        attendance: { present: int(a.present), absent: int(a.absent), excused: int(a.excused) },
        thread: (Array.isArray(r.thread) ? r.thread : []).flatMap((t): ThreadLine[] =>
          isObj(t) && (t.side === "approver" || t.side === "leader") ? [{ side: t.side, body: str(t.body), at: str(t.at) ?? "" }] : [],
        ),
      },
    ];
  });
  return { state: state(data.state), requests };
}

/** The requests that need a person now: waiting for a decision (or, for a coach, for their recommendation), or an appeal waiting to be looked at. */
export const needsAction = (r: BoardRequest) =>
  (r.status === "open" && r.can_decide) || (r.status === "open" && r.can_recommend && r.recommendation === null) || (r.appeal?.status === "open" && r.can_judge_appeal);

// ---------------------------------------------------------------------------
// The member's own notice
// ---------------------------------------------------------------------------
export type MyRemoval = {
  id: string;
  tribe: string;
  decided_on: string;
  contact_first: string;
  reinstated: boolean;
  appeal: { status: "open" | "upheld" | "reinstated"; at: string } | null;
  can_appeal: boolean;
  appeal_until: string;
};

export function parseMyRemoval(data: unknown): MyRemoval | null {
  if (!isObj(data)) return null;
  const id = str(data.id);
  const tribe = str(data.tribe);
  if (!id || !tribe) return null;
  const ap = isObj(data.appeal) ? data.appeal : null;
  return {
    id,
    tribe,
    decided_on: str(data.decided_on) ?? "",
    contact_first: str(data.contact_first) ?? "the Care Team",
    reinstated: data.reinstated === true,
    appeal: ap ? { status: ap.status === "upheld" || ap.status === "reinstated" ? ap.status : "open", at: str(ap.at) ?? "" } : null,
    can_appeal: data.can_appeal === true,
    appeal_until: str(data.appeal_until) ?? "",
  };
}

/** The note a leader writes: trimmed, and whether it is long enough and not too long. */
export function noteProblem(note: string, min = NOTE_MIN, max = NOTE_MAX): string | null {
  const n = note.trim().length;
  if (n < min) return `Write at least ${min} characters (${n} so far), so the person deciding understands.`;
  if (n > max) return `Keep it to ${max} characters (it is ${n}).`;
  return null;
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------
export const REMOVAL_WORDS = {
  // The leader
  askButton: (first: string) => `Ask the church about ${first}’s place`,
  askTitle: (first: string) => `Ask the church about ${first}’s place in your tribe`,
  askIntro: "You are not removing anyone. You are asking the church to look at it, and a person who can decide will. Nothing happens to them until someone does, and they are told kindly if it does.",
  reasonLabel: "What is the main reason?",
  noteLabel: "What has happened?",
  noteHint: `Between ${NOTE_MIN} and ${NOTE_MAX} characters. The person deciding reads this and the member never does.`,
  spokenLabel: "I have spoken to this person about this.",
  spokenHint: "The church asks that you speak to someone before you ask about their place.",
  urgentLabel: "This is urgent: someone may be at risk.",
  urgentHint: "This also sends an urgent alert to the Care Team now.",
  submit: "Send to the church",
  sent: "Sent. The church will look at it, and you will be told what is decided.",
  sentPractice: "Sent as practice. Nothing was changed and no one was told.",
  limit: (open: number, max: number) => `You have ${open} of ${max} requests waiting. Wait for an answer to one before you ask about another.`,
  practice: "Practice: this is a rehearsal. Nothing will change for the member and no one is written to.",
  mineTitle: "Requests about a member’s place",
  mineIntro: "What you have asked the church, and the answer. Only you, your coach and the church’s team (the Care Team, directors, admins and pastors) can read what you wrote.",
  waitingApprover: "Waiting for the church to look at it.",
  waitingLeader: "The church has a question for you.",
  answerLabel: "Your answer",
  answerSubmit: "Send my answer",
  answerSent: "Sent. The church will look at it again.",
  withdraw: "Withdraw this request",
  withdrawn: "Withdrawn.",
  statusApproved: "Approved. Their place has been released.",
  statusDeclined: "Not approved. They stay in the tribe.",
  statusWithdrawn: "Withdrawn.",
  statusReinstated: "Their place was put back.",
  removeFromGroup: "If you keep a WhatsApp group for the tribe outside this site, please take them out of it yourself.",
  // The people who decide
  boardTitle: "Requests about a member’s place",
  boardIntro:
    "A leader never removes anyone: they ask, and a person with the right to decide does. Silence never removes anyone either. An admin, a director or the Care Lead decides. The coach of the tribe can say what they would do, and the person deciding reads that first. Anything about safety or conduct, a young person, or someone the Care Team is already caring for is the Care Team’s to handle: the coach does not advise on it.",
  boardOff: "Leader removal requests are not open yet. The owner turns them on from God Mode → Features.",
  boardEmpty: "No requests right now.",
  practiceBanner: "Practice mode: requests here are rehearsals. Deciding one changes nothing and tells no one.",
  restricted: "Only the Care Team, a director or an admin can decide this.",
  restrictedRead: "You can read this, but it is for the Care Team to decide.",
  coachReadOnly: "You can read this and say what you would do. An admin, a director or the Care Lead decides.",
  recommendHeading: "What would you do?",
  recommendHint: `Your recommendation goes to the person deciding, who reads it first. It decides nothing. At least ${DECISION_NOTE_MIN} characters.`,
  recommendApprove: "I would approve it",
  recommendDecline: "I would decline it",
  recommendAsk: "I would ask the leader a question first",
  recommendSubmit: "Send my recommendation",
  recommendUpdate: "Change my recommendation",
  recommendSent: "Sent. The person deciding will read it first.",
  recommendationBy: (by: string | null) => `${by ?? "The coach"} recommends`,
  recommendationWord: { approve: "approving it", decline: "declining it", ask: "asking the leader a question first" },
  decideFirst: "The coach’s recommendation is above. It is advice: the decision is yours.",
  under18: "Under 18: the Care Lead speaks to their parent or guardian. They are not emailed.",
  urgent: "Marked urgent",
  decideLabel: "Your decision",
  noteForDecision: "Your note",
  noteForDecisionHint: `At least ${DECISION_NOTE_MIN} characters. The leader reads it. The member never does.`,
  approve: "Approve: release their place",
  decline: "Decline: they stay",
  ask: "Ask the leader a question",
  approveSure: "They will be told kindly that their place has changed, and offered other tribes. Their attendance and everything they wrote stays.",
  declineSure: "The leader is told. The member is told nothing.",
  askSure: "Nothing is decided. The leader is asked to answer.",
  decided: (what: string) => `Done. ${what}`,
  reinstate: "Put their place back",
  reinstateHint: "If the tribe has room and they have not joined another tribe, they return to their seat and are told.",
  uphold: "Keep the decision",
  appealHeading: "They have asked for it to be looked at again",
  appealOpen: "Waiting for the Care Team to look again.",
  appealUpheld: "Looked at again: the decision stands.",
  appealReinstated: "Looked at again: their place was put back.",
  cleared: "The leader’s words were cleared after twelve months. The date and the decision are kept.",
  // The member
  memberTitle: (tribe: string) => `Your place in ${tribe} has changed`,
  memberBody:
    "The church’s leaders looked at this carefully, and you are still very much part of this church family. Everything you have shared and taken part in is just as you left it. Other tribes are open to you.",
  memberSeeTribes: "See other tribes",
  memberSpeak: (first: string) => `If you would like to talk about it, ${first} is the person to speak to.`,
  memberAppealIntro: (first: string, until: string) => `If you feel a mistake has been made, you can ask ${first} to look at it again. You can ask until ${until}.`,
  memberAppealLabel: "What would you like them to know? (optional)",
  memberAppealSubmit: "Ask them to look again",
  memberAppealSent: "Sent. We will let you know.",
  memberAppealWaiting: "You have asked for this to be looked at again. We will let you know.",
  memberAppealUpheld: "It was looked at again and the decision stands. We are sorry. Other tribes are still open to you.",
  memberBack: (tribe: string) => `Your place in ${tribe} has been put back. You are welcome there.`,
} as const;

export const STATUS_LINE = (r: MineRequest): string =>
  r.status === "open" ? (r.waiting_on === "leader" ? REMOVAL_WORDS.waitingLeader : REMOVAL_WORDS.waitingApprover)
  : r.status === "approved" ? REMOVAL_WORDS.statusApproved
  : r.status === "declined" ? REMOVAL_WORDS.statusDeclined
  : REMOVAL_WORDS.statusWithdrawn;
