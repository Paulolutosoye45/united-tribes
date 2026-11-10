import { ZONES } from "@/lib/intake/options";
import { andList, needsOf, parseAcademyModes } from "./modes";
import type { CertState, TribeType, MyAcademy, SessionKind } from "./types";

export const SESSION_KINDS: Record<SessionKind, { label: string; short: string; blurb: string; order: number }> = {
  practice_workshop: {
    label: "Practice workshop",
    short: "Workshop 1",
    blurb: "Lead a simulated meeting and get feedback from a coach.",
    order: 1,
  },
  commissioning_workshop: {
    label: "Commissioning workshop",
    short: "Workshop 2",
    blurb: "Finalise your Tribe Card, meet your assistant leader and coach, and be prayed for.",
    order: 2,
  },
};

export const PRACTICE_FORMATS = [
  { id: "co_lead", label: "Co-led a Starter Tribe session" },
  { id: "recorded", label: "Recorded simulation" },
] as const;

export const TRIBE_TYPES: { id: TribeType; label: string; description: string }[] = [
  { id: "mixed", label: "Mixed", description: "Women and men together" },
  { id: "women", label: "Women only", description: "Only women are matched to it" },
  { id: "men", label: "Men only", description: "Only men are matched to it" },
];

export const ZONE_LABELS: Record<string, string> = Object.fromEntries(ZONES.map((z) => [z.id, z.label]));
export { ZONES };

/** Day numbers count from Sunday = 0, the same as the database. */
export const DAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
] as const;

export function dayName(day: number | null | undefined): string {
  return DAYS.find((d) => d.value === day)?.long ?? "";
}

/** “8:00 pm”, from a 24-hour “20:00”. Written by hand so server and browser agree. */
export function clockLabel(time: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

function steps(from: string, to: string): string[] {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  const out: string[] = [];
  for (let t = fh * 60 + fm; t <= th * 60 + tm; t += 30) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}

/**
 * The start times members can make on each day, the same windows the database
 * accepts: weeknights from 7:30pm, Saturday morning, and Sunday afternoon or evening.
 */
export function timesFor(day: number | null | undefined): string[] {
  if (day === 0) return steps("13:00", "21:30");
  if (day === 6) return steps("07:00", "11:30");
  if (day !== null && day !== undefined && day >= 1 && day <= 5) return steps("19:30", "21:30");
  return [];
}

/** Which of the four slots a day and time fall in, the same windows the database uses (circle_slot_for). Null when the time is not one members can make. */
export function slotOf(day: number | null | undefined, time: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (day === null || day === undefined || !m) return null;
  const t = Number(m[1]) * 60 + Number(m[2]);
  if (day === 0 && t >= 13 * 60 && t < 18 * 60) return "sunday-afternoon";
  if (day === 0 && t >= 18 * 60 && t <= 21 * 60 + 30) return "sunday-evening";
  if (day >= 1 && day <= 5 && t >= 19 * 60 + 30 && t <= 21 * 60 + 30) return "weeknight-evening";
  if (day === 6 && t >= 7 * 60 && t < 12 * 60) return "saturday-morning";
  return null;
}

/** The days of the week a slot can be held on. A tribe formed for one slot keeps to it. */
export function daysForSlot(slot: string | null | undefined): number[] {
  if (slot === "weeknight-evening") return [1, 2, 3, 4, 5];
  if (slot === "saturday-morning") return [6];
  if (slot === "sunday-afternoon" || slot === "sunday-evening") return [0];
  return [0, 1, 2, 3, 4, 5, 6];
}

/** The start times on a day that fall inside one slot. With no slot, every time members can make that day. */
export function timesForSlot(day: number | null | undefined, slot: string | null | undefined): string[] {
  const all = timesFor(day);
  return slot ? all.filter((t) => slotOf(day, t) === slot) : all;
}

export const SLOT_LABELS: Record<string, string> = {
  "weeknight-evening": "Weeknight evening",
  "saturday-morning": "Saturday morning",
  "sunday-afternoon": "Sunday afternoon",
  "sunday-evening": "Sunday evening",
};

/** “Wednesdays at 8:00 pm”. */
export function meetingLine(day: number | null, time: string | null): string | null {
  if (day === null || !time) return null;
  return `${dayName(day)}s at ${clockLabel(time)}`;
}

export const CARD_STATUS: Record<string, { label: string; tone: "neutral" | "flame" | "gold" | "charcoal" | "outline" }> = {
  draft: { label: "Draft", tone: "outline" },
  submitted: { label: "With the pastorate", tone: "gold" },
  changes_requested: { label: "Changes asked for", tone: "flame" },
  approved: { label: "Published", tone: "charcoal" },
  closed: { label: "Closed", tone: "outline" },
};

export const CARD_MISSING: Record<string, string> = {
  name: "Name your tribe",
  track: "Choose your life-stage track",
  community: "Choose your community",
  goal: "Choose your Season Goal",
  story: "Tell your story in a couple of sentences",
  time: "Choose a day and time",
  mode: "Online or in person",
  zone: "Choose your zone",
  god: "Write the Loving God line",
  others: "Write the Loving Others line",
  life: "Write the Loving Life line",
};

export type CheckRow = {
  id: "modules" | "declaration" | "practice" | "card";
  label: string;
  detail: string;
  /** What has actually been done. */
  done: boolean;
  /** Whether certification waits for it. A row that is not needed is shown as such, and one that is switched off is left out. */
  needed: boolean;
  href: string;
};

/**
 * What certification needs, and where each part stands. With the Academy and the declaration both required these are the four things
 * (three for an assistant) it has always been. When the Academy is optional its two rows stay, marked "Not needed"; when it is off
 * they are left out; when the declaration is off its row is left out.
 */
export function checklist(my: Pick<MyAcademy, "state" | "practice" | "card"> & { modes?: MyAcademy["modes"] }): CheckRow[] {
  const s: CertState = my.state;
  const need = needsOf(s);
  const modes = parseAcademyModes(my.modes);
  const rows: CheckRow[] = [];
  if (modes.academy !== "off") {
    rows.push({
      id: "modules",
      label: need.modules ? "Six modules, 80% or better on each quiz" : "Six modules",
      detail: need.modules ? `${s.modules_passed} of ${s.modules_total} passed` : `Not needed. ${s.modules_passed} of ${s.modules_total} passed`,
      done: s.modules_done,
      needed: need.modules,
      href: "/lead/academy#modules",
    });
  }
  if (modes.declaration === "required" && need.declaration) {
    rows.push({
      id: "declaration",
      label: "Safeguarding declaration signed",
      detail: s.declaration ? "Signed" : need.modules ? "Opens when you pass the care and safeguarding module" : "Ready for you to read and sign",
      done: s.declaration,
      needed: true,
      href: "/lead/academy/declaration",
    });
  }
  if (modes.academy !== "off") {
    rows.push({
      id: "practice",
      label: "Practice session marked ready by a coach",
      detail: need.practice
        ? my.practice
          ? my.practice.ready
            ? "Ready"
            : "Not yet. See your coach’s note below"
          : "Your coach arranges this after the first workshop"
        : my.practice?.ready
          ? "Not needed. Your coach has marked you ready"
          : "Not needed. Your coach can still arrange one with you",
      done: s.practice,
      needed: need.practice,
      href: "/lead/academy#practice",
    });
  }
  if (s.card_required) {
    rows.push({
      id: "card",
      label: "Tribe Card published and approved",
      detail: my.card ? (CARD_STATUS[my.card.status]?.label ?? "") : "Not started",
      done: s.card,
      needed: true,
      href: "/lead/tribe",
    });
  }
  return rows;
}

/** The sentence under the heading on the training page, and the count of what is needed against what is done. */
export function certificationSummary(my: Pick<MyAcademy, "state" | "is_leader">): { total: number; done: number; sentence: string } {
  const s = my.state;
  const need = needsOf(s);
  const asked: { text: string; done: boolean }[] = [];
  if (need.modules) asked.push({ text: "your modules", done: s.modules_done });
  if (need.declaration) asked.push({ text: "the safeguarding declaration", done: s.declaration });
  if (need.practice) asked.push({ text: "a practice session", done: s.practice });
  if (my.is_leader) asked.push({ text: "an approved Tribe Card", done: s.card });
  return {
    total: asked.length,
    done: asked.filter((a) => a.done).length,
    sentence: asked.length === 0 ? "Nothing more is needed to be certified." : `Certification needs ${andList(asked.map((a) => a.text))}.`,
  };
}

/** Four quarters of the shield: modules, declaration, practice, card. A part that is not needed is full: nothing stands in the way there. */
export function shieldFills(my: Pick<MyAcademy, "state">): [number, number, number, number] {
  const s = my.state;
  const need = needsOf(s);
  return [
    need.modules ? (s.modules_total > 0 ? Math.min(1, s.modules_passed / s.modules_total) : 0) : 1,
    need.declaration ? (s.declaration ? 1 : 0) : 1,
    need.practice ? (s.practice ? 1 : 0) : 1,
    !s.card_required || s.card ? 1 : 0,
  ];
}

/** The one thing to do next, in plain words. */
export function nextAction(my: MyAcademy): { title: string; body: string; cta: string; href: string } {
  const s = my.state;
  if (s.certified) {
    return my.state.card_required && my.card?.status !== "approved"
      ? { title: "You are certified.", body: "Your Tribe Card is the last thing members wait for.", cta: "Open my Tribe Card", href: "/lead/tribe" }
      : { title: "You are certified.", body: "Thank you for the work. Your coach will be in touch about the season ahead.", cta: "See my training", href: "/lead/academy" };
  }
  const need = needsOf(s);
  // A module that is not needed is never what a leader is sent to next. The Academy stays open to them, but it is not the way forward.
  const nextModule = need.modules ? my.modules.find((m) => !m.passed) : undefined;
  if (nextModule) {
    const started = nextModule.opened;
    return {
      title: started ? `Carry on with module ${nextModule.number}` : `Start module ${nextModule.number}`,
      body: `${nextModule.title}. ${nextModule.minutes} minutes.`,
      cta: started ? "Carry on" : "Start",
      href: `/lead/academy/${nextModule.slug}`,
    };
  }
  if (need.declaration && !s.declaration) {
    return { title: "Sign the safeguarding declaration", body: "Eight promises, and it takes a minute.", cta: "Read and sign", href: "/lead/academy/declaration" };
  }
  if (need.practice && !s.practice) {
    const booked = my.sessions.some((x) => x.booked);
    return booked
      ? { title: "Your workshop is booked", body: "After it, your coach arranges your practice session.", cta: "See my training", href: "/lead/academy" }
      : { title: "Book your workshops", body: "Two live workshops, then a practice session with a coach.", cta: "Choose a date", href: "/lead/academy#workshops" };
  }
  if (s.card_required && !s.card) {
    return { title: "Finish your Tribe Card", body: "It is the page members choose your tribe from.", cta: "Open my Tribe Card", href: "/lead/tribe" };
  }
  return { title: "Nearly there", body: "The pastorate will confirm your certification shortly.", cta: "See my training", href: "/lead/academy" };
}
