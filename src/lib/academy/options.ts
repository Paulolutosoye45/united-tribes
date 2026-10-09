import { ZONES } from "@/lib/intake/options";
import type { CertState, CircleType, MyAcademy, SessionKind } from "./types";

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

export const CIRCLE_TYPES: { id: CircleType; label: string; description: string }[] = [
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
  name: "Name your Tribe",
  track: "Choose your life-stage track",
  tribe: "Choose your tribe",
  goal: "Choose your Season Goal",
  story: "Tell your story in a couple of sentences",
  time: "Choose a day and time",
  mode: "Online or in person",
  zone: "Choose your zone",
  god: "Write the Loving God line",
  others: "Write the Loving Others line",
  life: "Write the Loving Life line",
};

export type CheckRow = { id: "modules" | "declaration" | "practice" | "card"; label: string; detail: string; done: boolean; href: string };

/** The four things that make a leader certified (three for an assistant), and where each stands. */
export function checklist(my: Pick<MyAcademy, "state" | "practice" | "card">): CheckRow[] {
  const s: CertState = my.state;
  const rows: CheckRow[] = [
    {
      id: "modules",
      label: "Six modules, 80% or better on each quiz",
      detail: `${s.modules_passed} of ${s.modules_total} passed`,
      done: s.modules_done,
      href: "/lead/academy#modules",
    },
    {
      id: "declaration",
      label: "Safeguarding declaration signed",
      detail: s.declaration ? "Signed" : "Opens when you pass the care and safeguarding module",
      done: s.declaration,
      href: "/lead/academy/declaration",
    },
    {
      id: "practice",
      label: "Practice session marked ready by a coach",
      detail: my.practice ? (my.practice.ready ? "Ready" : "Not yet. See your coach’s note below") : "Your coach arranges this after the first workshop",
      done: s.practice,
      href: "/lead/academy#practice",
    },
  ];
  if (s.card_required) {
    rows.push({
      id: "card",
      label: "Tribe Card published and approved",
      detail: my.card ? (CARD_STATUS[my.card.status]?.label ?? "") : "Not started",
      done: s.card,
      href: "/lead/circle",
    });
  }
  return rows;
}

/** Four quarters of the shield: modules, declaration, practice, card. */
export function shieldFills(my: Pick<MyAcademy, "state">): [number, number, number, number] {
  const s = my.state;
  return [
    s.modules_total > 0 ? Math.min(1, s.modules_passed / s.modules_total) : 0,
    s.declaration ? 1 : 0,
    s.practice ? 1 : 0,
    !s.card_required || s.card ? 1 : 0,
  ];
}

/** The one thing to do next, in plain words. */
export function nextAction(my: MyAcademy): { title: string; body: string; cta: string; href: string } {
  const s = my.state;
  if (s.certified) {
    return my.state.card_required && my.card?.status !== "approved"
      ? { title: "You are certified.", body: "Your Tribe Card is the last thing members wait for.", cta: "Open my Tribe Card", href: "/lead/circle" }
      : { title: "You are certified.", body: "Thank you for the work. Your coach will be in touch about the season ahead.", cta: "See my training", href: "/lead/academy" };
  }
  const nextModule = my.modules.find((m) => !m.passed);
  if (nextModule) {
    const started = nextModule.opened;
    return {
      title: started ? `Carry on with module ${nextModule.number}` : `Start module ${nextModule.number}`,
      body: `${nextModule.title}. ${nextModule.minutes} minutes.`,
      cta: started ? "Carry on" : "Start",
      href: `/lead/academy/${nextModule.slug}`,
    };
  }
  if (!s.declaration) {
    return { title: "Sign the safeguarding declaration", body: "Eight promises, and it takes a minute.", cta: "Read and sign", href: "/lead/academy/declaration" };
  }
  if (!s.practice) {
    const booked = my.sessions.some((x) => x.booked);
    return booked
      ? { title: "Your workshop is booked", body: "After it, your coach arranges your practice session.", cta: "See my training", href: "/lead/academy" }
      : { title: "Book your workshops", body: "Two live workshops, then a practice session with a coach.", cta: "Choose a date", href: "/lead/academy#workshops" };
  }
  if (s.card_required && !s.card) {
    return { title: "Finish your Tribe Card", body: "It is the page members choose your Tribe from.", cta: "Open my Tribe Card", href: "/lead/circle" };
  }
  return { title: "Nearly there", body: "The pastorate will confirm your certification shortly.", cta: "See my training", href: "/lead/academy" };
}
