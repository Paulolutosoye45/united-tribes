import { SECTIONS as MEMBER_SECTIONS, SECONDS_PER_STEP, isStepId as isMemberStep, sectionOf as memberSection, shieldFills as memberFills, stepsLeft, type StepId as MemberStep } from "@/lib/intake/steps";
import { STEP_IDS as LEADER_STEPS, SECTIONS as LEADER_SECTIONS, isStepId as isLeaderStep, minutesLeft as leaderMinutes, sectionOf as leaderSection, shieldFills as leaderFills, type StepId as LeaderStep } from "@/lib/leaders/steps";
import { clock, dayName, num, str } from "@/lib/messaging/format";
import type { Params } from "@/lib/messaging/types";
import { designedHtml, type DesignSpec } from "./email-design";
import { ALL_FIELDS, NAME_FIELDS } from "./labels";

/** A person's own details, as the database hands them over for an email. */
export type Data = Record<string, unknown>;

/**
 * Where someone has got to in a form, as something an email can show: four quarters of the shield, a label for the
 * quarter they are in, and an honest time left.
 */
export type Progress = { fills: [number, number, number, number]; percent: number; section: string; minutes: number; partsLeft: number };

export function memberProgress(step: unknown): Progress | null {
  if (!isMemberStep(step) && step !== "extras") return null;
  const id = (step === "extras" ? "care" : step) as MemberStep;
  const fills = memberFills(id);
  const at = memberSection(id);
  const left = stepsLeft(id) + 1;
  return {
    fills,
    percent: Math.round(((fills[0] + fills[1] + fills[2] + fills[3]) / 4) * 100),
    section: at >= 0 ? MEMBER_SECTIONS[at].label : "Last look",
    minutes: Math.max(1, Math.ceil((left * SECONDS_PER_STEP) / 60)),
    partsLeft: left,
  };
}

export function leaderProgress(step: unknown): Progress | null {
  if (!isLeaderStep(step)) return null;
  const id = step as LeaderStep;
  const fills = leaderFills(id);
  const at = leaderSection(id);
  return {
    fills,
    percent: Math.round(((fills[0] + fills[1] + fills[2] + fills[3]) / 4) * 100),
    section: at >= 0 ? LEADER_SECTIONS[at].label : "Last look",
    minutes: leaderMinutes(id),
    partsLeft: LEADER_STEPS.length - LEADER_STEPS.indexOf(id),
  };
}

export function progressFor(journey: string, step: unknown): Progress | null {
  return journey === "leader_application" ? leaderProgress(step) : journey === "member_form" ? memberProgress(step) : null;
}

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const small = (n: number) => (n >= 1 && n <= 12 ? WORDS[n] : String(n));

/** The values a person's email can use, worked out from the facts the database gave (and nothing else). */
export function fieldValues(data: Data, journey: string | null, site: string): Record<string, string> {
  const progress = journey ? progressFor(journey, data.step) : null;
  const tribe = str(data.tribe);
  const meets =
    data.meeting_day == null || data.meeting_time == null
      ? "at the time your leader shared"
      : `${dayName(num(data.meeting_day))}s at ${clock(str(data.meeting_time))}, ${str(data.mode) === "online" ? "online" : `in person${str(data.place_note) ? ` (${str(data.place_note)})` : ""}`}`;
  const seats = num(data.seats_left, 0);
  return {
    first_name: str(data.first_name) || "friend",
    tribe: tribe || "your tribe",
    tribe_1: str(data.tribe_1) || "your best match",
    leader_first: str(data.leader_first) || "your leader",
    seats_left: String(seats),
    season_starts: str(data.season_starts) || "soon",
    joining_closes: str(data.joining_closes) || "the end of week 2",
    meets,
    next_meeting: str(data.next_meeting) || "your next gathering",
    erase_date: str(data.erase_date) || "in 30 days",
    parts_left: progress ? small(progress.partsLeft) : "a few",
    minutes_left: progress ? small(progress.minutes) : "a few",
    close_line: str(data.close_date) ? `Applications close on ${str(data.close_date)}.` : "",
    my_page: `${site.replace(/\/+$/, "")}${str(data.my_page) || "/home"}`,
  };
}

/** Fills {name} fields. A field we do not know is removed rather than shown as braces. */
export function fill(text: string, values: Record<string, string>): string {
  return text
    .replace(/\{([a-z_0-9]+)\}/g, (_m, key: string) => values[key] ?? "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,!?])/g, "$1")
    .replace(/\s+$/g, "")
    .trim();
}

/** "The Covenant Nation" and its address, as the footer of every email shows them. */
export type Church = { name: string; address: string };
export const churchOf = (p: Params): Church => {
  const c = (p.church ?? {}) as Record<string, unknown>;
  return { name: str(c.name) || "The Covenant Nation", address: str(c.address) };
};

/** A short line that sits unseen behind the subject in the inbox list. */
export function preheaderFor(kind: "reminder" | "announcement", paragraphs: string[], progress: Progress | null): string {
  if (progress) return `Your answers are saved. About ${small(progress.minutes)} minute${progress.minutes === 1 ? "" : "s"} left.`;
  const first = paragraphs.find((p) => p.trim()) ?? "";
  return kind === "announcement" ? first.slice(0, 110) : first.slice(0, 110);
}

// ---------------------------------------------------------------------------
// What the office sees while writing: the same words, the same design, filled for one person
// ---------------------------------------------------------------------------

/** The fields an announcement may use (the database checks the same list). */
export const ANNOUNCE_FIELDS: readonly string[] = NAME_FIELDS.map((f) => f.key);

/** What is wrong with a piece of wording, in a sentence, or null. The database says the same thing when it is saved. */
export function wordingProblem(text: string, allowed: readonly string[] = ANNOUNCE_FIELDS): string | null {
  if (/https?:\/\/|www\./i.test(text)) return "Links can’t go in the words. Use the button to point people to a page inside United Tribes.";
  for (const m of text.matchAll(/\{([^}]*)\}/g)) {
    if (!allowed.includes(m[1]) && !ALL_FIELDS.includes(m[1])) return `“{${m[1]}}” isn’t a name field we know. Use the buttons to add one.`;
    if (!allowed.includes(m[1])) return `“{${m[1]}}” can only be used in the automatic reminders.`;
  }
  const open = (text.match(/\{/g) ?? []).length;
  const close = (text.match(/\}/g) ?? []).length;
  if (open !== close) return "A name field is missing its curly bracket.";
  return null;
}

export type PreviewInput = { subject: string; paragraphs: string[]; button_label: string | null; button_target: string | null };

/** Builds the design an announcement would have, for one person's values. Links point nowhere real. */
export function announcementSpec(input: PreviewInput, vars: Record<string, string>, site: string, church: Church): DesignSpec {
  const values = fieldValues({ first_name: vars.first_name, tribe: vars.tribe === "your tribe" ? "" : vars.tribe, season_starts: vars.season_starts, my_page: vars.my_page }, null, site);
  const subject = fill(input.subject, values) || "Your subject line";
  const paragraphs = input.paragraphs.map((p) => fill(p, values)).filter(Boolean);
  const dummy = `${site.replace(/\/+$/, "")}/e/preview`;
  return {
    subject,
    preheader: preheaderFor("announcement", paragraphs, null),
    greeting: `Hi ${values.first_name},`,
    paragraphs: paragraphs.length ? paragraphs : ["Your words will appear here."],
    button: input.button_label && input.button_target ? { label: fill(input.button_label, values), url: dummy } : undefined,
    church,
    why: "You are getting this as a member of United Tribes at The Covenant Nation.",
    stopLabel: "Stop announcements",
    stopUrl: dummy,
    prefsUrl: dummy,
  };
}

/** The page to show in a preview frame: the real email, with its links switched off so a tap does nothing. */
export function previewDocument(spec: DesignSpec, dark = false): string {
  const html = designedHtml(spec);
  const extra = `<style>a{pointer-events:none}${dark ? "html,body{color-scheme:dark}" : ""}</style>`;
  return html.replace("</head>", `${extra}</head>`);
}
