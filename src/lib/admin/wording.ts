import { formatDate, formatShortDate, plural } from "@/lib/dates";
import { ROLE_LABELS, isRole, type Role } from "@/lib/auth/roles";
import { ELIGIBILITY } from "@/lib/leaders/options";
import { ELIGIBILITY_KEYS, type EligibilityKey, type SwitchId } from "@/lib/leaders/pipeline";
import type { CheckItem, SeasonStatus } from "./types";

type Tone = "gold" | "neutral" | "flame" | "outline" | "charcoal";

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export const SEASON_STATUS: Record<SeasonStatus, { label: string; tone: Tone; line: string }> = {
  planning: { label: "Planning", tone: "outline", line: "Being prepared. Leaders draft their Tribe Cards and members can fill in the form." },
  open: { label: "Open", tone: "gold", line: "Registration is under way: members are choosing tribes." },
  running: { label: "Running", tone: "flame", line: "Tribes are meeting. The weekly messages and reports follow the dates." },
  closed: { label: "Closed", tone: "neutral", line: "Over. Its results stay exactly as they are." },
};

/** Where a season can go from each status. A season only moves forward, except that Open can step back to Planning. */
export const SEASON_MOVES: Record<SeasonStatus, { to: SeasonStatus; label: string; confirm: string | null }[]> = {
  planning: [{ to: "open", label: "Open registration", confirm: null }],
  open: [
    { to: "running", label: "Start the season", confirm: null },
    { to: "planning", label: "Back to planning", confirm: null },
  ],
  running: [{ to: "closed", label: "Close the season", confirm: "Close this season? It cannot be reopened, and the next season can then be prepared." }],
  closed: [],
};

/** "Week 4 of 12", "Starts in 3 weeks", "Ended". */
export function seasonWhen(week: number, weeks: number, startsOn: string, today: string): string {
  if (week === 0) {
    const days = Math.round((Date.parse(`${startsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    return days <= 13 ? `Starts in ${plural(days, "day")}` : `Starts in ${plural(Math.round(days / 7), "week")}`;
  }
  if (week > weeks) return "Ended";
  return `Week ${week} of ${weeks}`;
}

// ---------------------------------------------------------------------------
// The launch checklist
// ---------------------------------------------------------------------------

export type CheckLine = { title: string; detail: string; href: string; roles: readonly Role[] };

const roleName = (value: string) => (isRole(value) ? ROLE_LABELS[value].toLowerCase() : value);
const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** Sentences for what the database found. Each line points to the screen that fixes it. */
export function checkLine(item: CheckItem): CheckLine {
  const office = ["admin", "director", "pastor", "data_lead"] as const;
  switch (item.key) {
    case "season":
      return item.ok && item.name && item.starts_on
        ? { title: "A season is planned", detail: `${item.name}, starting ${formatDate(item.starts_on)}.`, href: "/admin/seasons", roles: office }
        : { title: "Plan the next season", detail: "No season is planned or running. Choose a start date and how many weeks.", href: "/admin/seasons", roles: office };
    case "team":
      return item.ok
        ? { title: "The team is in place", detail: "There is a pastor, a care lead, a data lead and at least one coach.", href: "/admin/people", roles: ["admin", "director"] }
        : { title: "Invite the rest of the team", detail: `Nobody holds the role of ${list(item.missing.map(roleName))} yet.`, href: "/admin/people", roles: ["admin", "director"] };
    case "words":
      return item.ok
        ? { title: "The church’s words are written", detail: "Leaders will read the vision and mission in the Academy.", href: "/admin/settings", roles: ["admin", "director", "pastor"] }
        : {
            title: "Write the vision and mission",
            detail: `${!item.vision && !item.mission ? "Neither is" : !item.vision ? "The vision is not" : "The mission is not"} written yet. Leaders read them in the Academy.`,
            href: "/admin/settings",
            roles: ["admin", "director", "pastor"],
          };
    case "guides":
      return item.ok
        ? { title: "All twelve weekly guides are approved", detail: "Each has been read by the pastorate or the office.", href: "/admin/guides", roles: office }
        : { title: "Read and approve the weekly guides", detail: `${item.reviewed} of ${item.of} have been read and approved. The wording is a draft until they are.`, href: "/admin/guides", roles: office };
    case "tribes":
      return item.ok
        ? { title: `${plural(item.approved, "tribe")} approved`, detail: "Members can be shown tribes that are approved.", href: "/review/cards", roles: ["pastor", "director", "coach"] }
        : { title: "Approve the first Tribe Cards", detail: "No tribe is approved yet, so there is nothing to show members.", href: "/review/cards", roles: ["pastor", "director", "coach"] };
    case "messages":
      return item.ok
        ? { title: "Messages are going out", detail: item.last_used_at ? `The sending service was last seen ${formatShortDate(item.last_used_at)}.` : "The sending service is connected.", href: "/admin/system", roles: ["admin", "director", "data_lead"] }
        : item.tokens === 0
          ? { title: "Connect the sending service", detail: "There is no sending token yet, so no WhatsApp, email or text will go out.", href: "/admin/system", roles: ["admin", "director", "data_lead"] }
          : {
            title: "The sending service is quiet",
            detail: item.last_used_at ? "It has not been seen for two days. Check that it is running." : "It has not reported in yet. Check that it is running with its token.",
            href: "/admin/system",
            roles: ["admin", "director", "data_lead"],
          };
    case "champions":
      return item.ok
        ? { title: "Every community has a champion", detail: "Each community has someone who can see how it is doing.", href: "/admin/champions", roles: office }
        : { title: "Appoint community champions", detail: `${item.covered} of ${plural(item.of, "community")} have a champion.`, href: "/admin/champions", roles: office };
    case "testimony_form":
      return item.ok
        ? { title: "Testimonies can be forwarded", detail: "The pastorate has the address of the testimony form.", href: "/admin/settings", roles: ["admin", "director", "pastor"] }
        : { title: "Add the testimony form address", detail: "Without it, the pastorate is told to ask the media team for the address each time.", href: "/admin/settings", roles: ["admin", "director", "pastor"] };
    case "bi":
      return item.ok && item.refreshed_at
        ? { title: "The reporting copy is set up", detail: `Last refreshed ${formatShortDate(item.refreshed_at)}.`, href: "/admin/system", roles: ["admin", "director", "data_lead"] }
        : { title: "Refresh the reporting copy", detail: "The copy that Power BI or Looker reads has never been filled.", href: "/admin/system", roles: ["admin", "director", "data_lead"] };
  }
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

type Unit = "percent" | "count" | "days" | "minutes" | "weeks" | "points" | "per_tribe";

export const TARGET_INFO: Record<string, { label: string; help: string; unit: Unit }> = {
  thriving_rate: { label: "Members thriving", help: "The share of members who should be thriving at the end of a season. This is the programme’s headline goal.", unit: "percent" },
  attend_share: { label: "Meetings a member comes to", help: "The share of meetings a member must come to, to count as thriving. Eight of twelve is 67%.", unit: "percent" },
  belonging_min: { label: "Feeling at home", help: "The lowest belonging answer, from 1 to 5, that counts as feeling at home in the tribe.", unit: "count" },
  gain_min: { label: "Gain on the Success Picture", help: "Points a member must gain on the 3 to 15 Success Picture score to count as gaining.", unit: "points" },
  effective_thriving: { label: "Tribe: members thriving", help: "A finished tribe is effective when at least this share of its members thrived.", unit: "percent" },
  effective_gain: { label: "Tribe: members gaining", help: "…and at least this share gained on the Success Picture.", unit: "percent" },
  min_weeks: { label: "Weeks before a rate shows", help: "No thriving rate is shown for a tribe before it has met this many weeks. Early weeks say little.", unit: "weeks" },
  min_cell: { label: "Smallest group shown", help: "A breakdown hides its rate when it covers fewer people than this, so nobody can be picked out.", unit: "count" },
  min_answers: { label: "Answers before an average", help: "An average is shown only after this many members have answered.", unit: "count" },
  retrain_after: { label: "Placements before the weights are retrained", help: "How many members must be placed before the matching weights can be retrained on real results.", unit: "count" },
  connect_days: { label: "Days from form to first meeting, at launch", help: "The median number of days from finishing the form to the first meeting, while the programme is new.", unit: "days" },
  connect_days_season: { label: "Days from form to first meeting, once established", help: "The same, once seasons are running smoothly.", unit: "days" },
  form_minutes: { label: "Minutes on the form", help: "The median time members should need to finish the form.", unit: "minutes" },
  form_completion: { label: "Forms finished", help: "The share of started forms that are finished.", unit: "percent" },
  ai_keep: { label: "Assistant suggestions kept", help: "The share of the assistant’s suggestions that members keep, for every field. Lower means the assistant is guessing badly.", unit: "percent" },
  word_habit: { label: "Members keeping the Word habit", help: "The share of members who read the week’s passage often enough to count.", unit: "percent" },
  word_days_min: { label: "Days that count as keeping it", help: "The days in a week a member must read the passage to count as keeping the habit.", unit: "days" },
  care_resolved: { label: "Care tasks resolved in time", help: "The share of care tasks that should be resolved within the days below.", unit: "percent" },
  care_days: { label: "Days to resolve a care task", help: "How long a care task may stay open before it counts as late.", unit: "days" },
  assistants: { label: "Certified assistants per tribe", help: "Every tribe should have this many certified assistant leaders.", unit: "per_tribe" },
  match_gap: { label: "Gap that shows matching works", help: "Members with an 85%+ match should thrive at least this much more often than members with a 60–69% match.", unit: "percent" },
  swap_weeks: { label: "Weeks to ask for a different tribe", help: "A member may ask to change tribe during the first weeks of a season.", unit: "weeks" },
};

export const TARGET_GROUPS: { title: string; keys: string[] }[] = [
  { title: "The goal", keys: ["thriving_rate", "attend_share", "belonging_min", "gain_min"] },
  { title: "When a tribe counts as effective", keys: ["effective_thriving", "effective_gain"] },
  { title: "When a number is shown", keys: ["min_weeks", "min_cell", "min_answers"] },
  { title: "Launch and the form", keys: ["connect_days", "connect_days_season", "form_minutes", "form_completion", "ai_keep"] },
  { title: "Habits and care", keys: ["word_habit", "word_days_min", "care_resolved", "care_days", "assistants"] },
  { title: "Learning and changes", keys: ["retrain_after", "match_gap", "swap_weeks"] },
];

const UNIT_WORDS: Record<Unit, string> = { percent: "%", count: "", days: "days", minutes: "minutes", weeks: "weeks", points: "points", per_tribe: "per tribe" };
const ONE_UNIT: Partial<Record<Unit, string>> = { days: "day", minutes: "minute", weeks: "week", points: "point" };

/** What goes in the box: percentages are typed as 85, not 0.85. */
export function targetToInput(key: string, value: number): string {
  const unit = TARGET_INFO[key]?.unit ?? "count";
  const shown = unit === "percent" ? value * 100 : value;
  return String(Math.round(shown * 100) / 100);
}

/** What the database stores for what was typed. Null when it is not a number. */
export function targetFromInput(key: string, input: string): number | null {
  const n = Number(input.trim().replace(",", "."));
  if (input.trim() === "" || !Number.isFinite(n)) return null;
  const unit = TARGET_INFO[key]?.unit ?? "count";
  return unit === "percent" ? Math.round(n * 100) / 10000 : n;
}

/** "85%", "3 weeks". */
export function targetText(key: string, value: number): string {
  const unit = TARGET_INFO[key]?.unit ?? "count";
  const n = targetToInput(key, value);
  const words = n === "1" ? (ONE_UNIT[unit] ?? UNIT_WORDS[unit]) : UNIT_WORDS[unit];
  return unit === "percent" ? `${n}%` : words ? `${n} ${words}` : n;
}

/** "50% to 100%", "1 to 12 points": the unit is said once. */
export function targetRange(key: string, min: number, max: number): string {
  const unit = TARGET_INFO[key]?.unit ?? "count";
  if (unit === "percent") return `${targetToInput(key, min)}% to ${targetToInput(key, max)}%`;
  const words = targetToInput(key, max) === "1" ? (ONE_UNIT[unit] ?? UNIT_WORDS[unit]) : UNIT_WORDS[unit];
  return `${targetToInput(key, min)} to ${targetToInput(key, max)}${words ? ` ${words}` : ""}`;
}

/** Whether what was typed says something different from what is stored, as the box would show it (66.67 is 2 in 3). */
export function targetChanged(key: string, input: string, stored: number): boolean {
  const typed = targetFromInput(key, input);
  return typed !== null && targetToInput(key, typed) !== targetToInput(key, stored);
}

export const targetUnit = (key: string): string => UNIT_WORDS[TARGET_INFO[key]?.unit ?? "count"];

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** "week_start" -> "Week start". */
export function templateName(template: string): string {
  const spaced = template.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const MESSAGE_STATUS_TONE: Record<string, Tone> = {
  queued: "outline",
  sending: "outline",
  sent: "neutral",
  delivered: "gold",
  read: "gold",
  failed: "flame",
  skipped: "neutral",
};

// ---------------------------------------------------------------------------
// The switchboard for becoming a leader
// ---------------------------------------------------------------------------

export type SwitchGroup = "questions" | "steps" | "fit" | "training";

export const SWITCH_GROUPS: { id: SwitchGroup; title: string; intro: string }[] = [
  {
    id: "questions",
    title: "The questions on the first screen",
    intro: "Each applicant is asked these before anything else. Required means the answer must be Yes. Optional means they are asked and a No does not stop them. Off means the question is not asked.",
  },
  {
    id: "steps",
    title: "The steps after they send",
    intro: "What the panel waits for before it can invite someone or decide.",
  },
  {
    id: "fit",
    title: "Find your tribe",
    intro: "The questions that help match a leader to the tribe cards they could lead, and the pastor’s fit panel.",
  },
  {
    id: "training",
    title: "Training after approval",
    intro: "What a new leader finishes before their tribe is shown to members. Turning training off never takes anything away from a leader who has already done it.",
  },
];

export const POSITION_WORDS: Record<string, string> = { required: "Required", optional: "Optional", off: "Off", on: "On" };
export const positionWord = (value: string): string => POSITION_WORDS[value] ?? value;

export type SwitchInfo = {
  id: SwitchId;
  group: SwitchGroup;
  title: string;
  /** The exact words the applicant sees, for a question. */
  ask: string | null;
  options: readonly string[];
  means: Record<string, string>;
};

const QUESTION_TITLE: Record<EligibilityKey, string> = {
  member6: "Six months as a member",
  foundation: "Foundation of Faith",
  serving: "Serving in a team",
  age21: "Age 21 or over",
  time: "Time each week",
  safeguarding: "Safeguarding and code of conduct",
  confidentiality: "Confidentiality",
};

const questionMeans = {
  required: "The answer must be Yes. Anyone who answers No is stopped kindly before they send, and is shown other ways to serve.",
  optional: "The applicant is asked. A No does not stop them, and the panel can see the answer.",
  off: "Not asked. The question does not appear on the form or on the tracker.",
};

export const SWITCHES: SwitchInfo[] = [
  ...ELIGIBILITY_KEYS.map(
    (key): SwitchInfo => ({
      id: `elig_${key}`,
      group: "questions",
      title: QUESTION_TITLE[key],
      ask: ELIGIBILITY.find((e) => e.id === key)?.label ?? null,
      options: ["required", "optional", "off"],
      means: questionMeans,
    }),
  ),
  {
    id: "references_mode",
    group: "steps",
    title: "References",
    ask: "Two people who know the applicant answer four short questions about them.",
    options: ["required", "optional", "off"],
    means: {
      required: "The applicant names two referees, one a pastor or unit head. Both must answer, with no open concern, before a leader can be approved.",
      optional: "The applicant may name up to two referees. Answers count when they come, and nothing waits for them. A concern a referee raises still has to be cleared by a pastor.",
      off: "Not asked. Nobody is contacted, and the panel decides without references.",
    },
  },
  {
    id: "interview_mode",
    group: "steps",
    title: "Interview",
    ask: "A short conversation with the panel, scored by two panel members.",
    options: ["required", "optional", "off"],
    means: {
      required: "A pastor can approve only after the interview has been held and scored.",
      optional: "The panel may invite someone to interview, or decide without one.",
      off: "No interview. The panel decides from the application, and no one is invited.",
    },
  },
  {
    id: "tribe_fit",
    group: "fit",
    title: "Find your tribe",
    ask: "A leader sees the tribes that suit their answers and chooses the one they would lead.",
    options: ["off", "on"],
    means: {
      off: "Not used. The application is the same as before.",
      on: "A new screen after “I lead best by”: the leader sees the tribes that suit their answers, chooses one and may name two backups. The pastor sees how well the leader fits the tribe they chose. A pastor still decides every application.",
    },
  },
  {
    id: "academy_mode",
    group: "training",
    title: "Leader Academy",
    ask: "The modules and quizzes, and the coach’s practice sign-off.",
    options: ["required", "optional", "off"],
    means: {
      required: "Every module passed and the practice session marked ready before a leader is certified.",
      optional: "The Academy stays open to leaders, but certification does not wait for it.",
      off: "The Academy is closed to leaders and certification does not need it. Everything already done is kept.",
    },
  },
  {
    id: "declaration_mode",
    group: "training",
    title: "Safeguarding declaration",
    ask: "The leader signs the safeguarding declaration with their full name.",
    options: ["required", "off"],
    means: {
      required: "The leader signs the declaration before they are certified.",
      off: "No declaration is asked for. Declarations already signed are kept.",
    },
  },
];

export const SWITCH_BY_ID: Record<string, SwitchInfo> = Object.fromEntries(SWITCHES.map((s) => [s.id, s]));

export const PRESET_INFO = {
  full: {
    title: "Full process",
    body: "Today’s process: every question, both referees and the interview. The Academy and declaration are set to Required.",
    confirm: "Set every switch back to the full process? Applications already sent keep the steps they were sent with.",
  },
  open_door: {
    title: "Open door",
    body: "Age 21, time each week, safeguarding and confidentiality only. No references, no interview. Find your tribe is turned on once it is ready. The Academy and declaration are set to Required.",
    confirm: "Switch to the open door? Fewer steps are asked of new applicants from now on. Applications already sent keep the steps they were sent with.",
  },
} as const;

export const PRESET_NAME: Record<string, string> = { full: "Full process", open_door: "Open door", empty: "Set by hand" };

/** Said once, when both training switches are Off. */
export const NO_TRAINING_WARNING =
  "With the Academy and the declaration both off, a leader is certified as soon as their tribe card is approved, and an assistant leader as soon as they are approved. Nothing is checked about their training or safeguarding. Switch both off only if the church has decided it.";
