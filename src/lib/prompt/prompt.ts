// The sign-in prompt, as the website reads it. The database decides what a person owes (my_prompt_queue); this file reads that answer defensively, says what each
// task is in plain first-name words, and draws no conclusion of its own: a task the database did not send does not exist, and a link the database sent is ignored
// in favour of the one page each kind of task is allowed to open.

export const PROMPT_KINDS = ["placement", "interview", "leader_offer", "guardian", "ai_consent", "number", "whatsapp", "joining_form", "application", "tribe_card", "care"] as const;
export type PromptKind = (typeof PROMPT_KINDS)[number];
export const isPromptKind = (v: unknown): v is PromptKind => typeof v === "string" && (PROMPT_KINDS as readonly string[]).includes(v);

/** The tasks that open their own page instead of fitting on the screen (a long form), and the one page each may open. */
export const LINK_TASKS = {
  guardian: "/tribe",
  ai_consent: "/lead",
  joining_form: "/join",
  application: "/lead",
  tribe_card: "/lead/tribe",
  care: "/care",
} as const satisfies Partial<Record<PromptKind, string>>;
export type LinkKind = keyof typeof LINK_TASKS;
export const isLinkKind = (k: PromptKind): k is LinkKind => k in LINK_TASKS;

/** Pages the screen never covers: the owner's console, and anything the shell treats as a focused screen. */
export const PROMPT_HIDDEN_ON = ["/god"] as const;
export const hiddenOn = (path: string | null): boolean => Boolean(path) && PROMPT_HIDDEN_ON.some((p) => path === p || path?.startsWith(`${p}/`));

export type PromptTask =
  | {
      kind: "placement";
      tribe: string;
      leaderFirst: string;
      meets: string;
      season: string;
      /** When the church is holding the place until, in words; null when no clock is running */
      until: string | null;
      canSkip: boolean;
      /** "Not this season" and "Call me" are offered only where the placed answers are On and for an adult */
      moreAnswers: boolean;
      hasNumber: boolean;
    }
  | { kind: "interview"; canSkip: boolean; options: { id: string; when: string }[] }
  | { kind: "leader_offer"; canSkip: boolean; offerId: string; goal: string; community: string; until: string | null }
  | { kind: "number"; canSkip: boolean; signinMask: string | null }
  | { kind: "whatsapp"; canSkip: boolean; numberMask: string | null }
  | { kind: LinkKind; canSkip: boolean; href: string; count: number; changesAsked: boolean };

export type PromptQueue = { state: "off" | "rehearsal" | "on"; tasks: PromptTask[]; total: number };
export const NO_PROMPT: PromptQueue = { state: "off", tasks: [], total: 0 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** A moment in words, in Lagos time: "Wednesday 18 November, 4:00 pm". Null for anything that is not a time. */
export function whenText(v: unknown): string | null {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  if (!Number.isFinite(t)) return null;
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long" }).format(t);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit", hour12: true }).format(t).replace(/\s/g, " ").toLowerCase();
  return `${date}, ${time}`;
}

/** "Wednesdays at 8:00 pm, in person". */
export function meetsText(day: unknown, time: unknown, mode: unknown): string {
  const d = typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6 ? DAYS[day] : null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(typeof time === "string" ? time : "");
  let at: string | null = null;
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) {
    const h = Number(m[1]);
    at = `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
  }
  const how = mode === "online" ? "online" : mode === "in_person" ? "in person" : null;
  return [d && at ? `${d} at ${at}` : (d ?? at), how].filter(Boolean).join(", ");
}

function parseTask(raw: unknown): PromptTask | null {
  const t = obj(raw);
  if (!t || !(typeof t.kind === "string" && isPromptKind(t.kind))) return null;
  const canSkip = t.can_skip !== false;
  switch (t.kind) {
    case "placement":
      return {
        kind: "placement",
        tribe: str(t.tribe, 60) || "your tribe",
        leaderFirst: str(t.leader_first, 40),
        meets: meetsText(t.meeting_day, t.meeting_time, t.mode),
        season: str(t.season, 60),
        until: whenText(t.deadline_at),
        canSkip,
        moreAnswers: t.more_answers === true,
        hasNumber: t.has_number === true,
      };
    case "interview": {
      const options = (Array.isArray(t.options) ? t.options : []).flatMap((o) => {
        const x = obj(o);
        const when = x ? whenText(x.starts_at) : null;
        if (!x || !when || typeof x.id !== "string" || !UUID.test(x.id)) return [];
        const how = x.mode === "online" ? "online" : x.mode === "in_person" ? "in person" : "";
        const mins = typeof x.minutes === "number" ? `${x.minutes} minutes` : "";
        return [{ id: x.id, when: [when, [mins, how].filter(Boolean).join(", ")].filter(Boolean).join(" · ") }];
      });
      return options.length ? { kind: "interview", canSkip, options: options.slice(0, 6) } : null;
    }
    case "leader_offer":
      return typeof t.offer_id === "string" && UUID.test(t.offer_id)
        ? { kind: "leader_offer", canSkip, offerId: t.offer_id, goal: str(t.goal, 120), community: str(t.community, 80), until: whenText(t.expires_at) }
        : null;
    case "number":
      return { kind: "number", canSkip, signinMask: str(t.signin_mask, 24) || null };
    case "whatsapp":
      return { kind: "whatsapp", canSkip, numberMask: str(t.number_mask, 24) || null };
    default: {
      const kind = t.kind;
      if (!isLinkKind(kind)) return null;
      return { kind, canSkip, href: LINK_TASKS[kind], count: typeof t.count === "number" && t.count > 0 ? Math.min(t.count, 99) : 0, changesAsked: t.changes_asked === true };
    }
  }
}

/** Reads the database's answer. Anything unreadable is "no screen". */
export function parsePromptQueue(v: unknown): PromptQueue {
  const q = obj(v);
  if (!q || (q.state !== "on" && q.state !== "rehearsal")) return NO_PROMPT;
  // Rehearsal shows nobody anything, whatever else it carries
  if (q.state === "rehearsal") return { state: "rehearsal", tasks: [], total: 0 };
  const tasks = (Array.isArray(q.tasks) ? q.tasks : []).flatMap((x) => {
    const t = parseTask(x);
    return t ? [t] : [];
  });
  return { state: "on", tasks: tasks.slice(0, 5), total: typeof q.total === "number" && q.total >= tasks.length ? Math.min(q.total, 5) : tasks.length };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------
export const PROMPT_WORDS = {
  site: "United Tribes",
  // "1 of 3", counted over the tasks picked for this visit
  step: (n: number, of: number) => `${n} of ${of}`,
  later: "Not now",
  laterNote: "This closes it for today. It comes back the next time you sign in.",
  noLater: (until: string | null) =>
    until ? `Your place is held until ${until}. You can still choose any of the answers above, and nothing is decided for you.` : "You can still choose any of the answers above, and nothing is decided for you.",
  saved: "Thank you. That is saved.",
  already: "That was already recorded, so nothing has changed. Thank you.",
  problem: "We couldn’t save that. Check your connection and try again.",
  leaving: "Taking you there",
  open: "Open it",
  placement: {
    title: (tribe: string) => `Your place in ${tribe}`,
    body: (leader: string) => (leader ? `The church has placed you in this tribe. It is led by ${leader}.` : "The church has placed you in this tribe."),
    meets: (m: string) => (m ? `It meets ${m}.` : ""),
    held: (until: string) => `Your place is held for you until ${until}.`,
    holdOpen: "Your place is held for you while you decide.",
    yes: "Yes, I’m in",
    notSeason: "Not this season",
    notSeasonNote: "You give up this place, and the church leaves you alone until the season is over.",
    call: "Call me",
    callNote: "Someone from the church phones you to talk it through. Nothing is decided by the call.",
    callWindow: "A good time to call",
    windows: [
      { id: "", label: "Any time in calling hours" },
      { id: "morning", label: "Morning" },
      { id: "afternoon", label: "Afternoon" },
      { id: "evening", label: "Evening" },
    ],
    callNumber: "The number to call (with its country code)",
    sendCall: "Ask for a call",
    needNumber: "Write your number with its country code, like +2348031234567.",
    changeTribe: "See my tribe page",
    choice: "Saying yes is your choice. You can also look at other tribes from your tribe page.",
  },
  number: {
    title: "Add your WhatsApp number",
    body: "It lets your leader and the church reach you where you will see it. You decide what it is used for, and you can change it any time on your profile.",
    label: "Your number, with its country code",
    placeholder: "+234 803 123 4567",
    signin: (mask: string) => `Use the number I sign in with (${mask})`,
    whatsapp: "You may message me on WhatsApp",
    whatsappNote: "Optional. If you leave this unticked, we keep your number and message you by email.",
    save: "Save my number",
    needNumber: "Write your number with its country code, like +2348031234567, or use the one you sign in with.",
  },
  whatsapp: {
    title: "May we message you on WhatsApp?",
    body: (mask: string | null) =>
      `${mask ? `We have your number (${mask}). ` : ""}Say yes if you are happy to get your tribe’s messages there. Email stays as it is, whatever you choose.`,
    yes: "Yes, message me on WhatsApp",
    no: "No thanks",
    noNote: "Saying no is final: we will not ask again, and you can change your mind any time on your profile.",
  },
  interview: {
    title: "Choose your interview time",
    body: "The times below are free. Pick the one that suits you, and it is booked.",
    book: "Book this time",
  },
  leader_offer: {
    title: "You have been asked to lead a group",
    body: (goal: string, community: string) => [goal, community].filter(Boolean).join(" · "),
    until: (u: string) => `Please answer by ${u}.`,
    yes: "Yes, I’ll lead",
    no: "No, not this time",
    note: "Saying yes starts your Tribe Card. A pastor still approves it, and nothing is final until then.",
  },
  links: {
    guardian: { title: "Your parent or guardian needs to say yes", body: "Before you can take a place in a tribe, a parent or guardian has to agree. Open your tribe page to send them the request." },
    ai_consent: { title: "One step on your application", body: "Your application is waiting for you to read and agree to how its first check is done. It takes a minute." },
    joining_form: { title: "Finish your joining form", body: "You started the joining form and have not sent it yet. It saves where you stopped, so you can carry on from there." },
    application: { title: "Finish your application", body: "Your leader application is still a draft. It saves where you stopped." },
    tribe_card: { title: "Send your Tribe Card", body: "Your Tribe Card is how members find your tribe. It has not been sent to the pastorate yet." },
    care: { title: "Care tasks are due", body: "" },
  },
  tribeCardChanges: "The pastorate has asked for a change to your Tribe Card.",
  care: (n: number) => (n === 1 ? "You have one care task that is due." : `You have ${n} care tasks that are due.`),
} as const;
