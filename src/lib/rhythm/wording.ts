import { formatDate } from "@/lib/dates";
import type { Attendance, CallOutcome, FlagKind, NudgeKind, Outcome, ReportStatus, Theme } from "./types";

export const THEME_LABELS: Record<Theme, string> = {
  begin: "Beginning",
  loving_god: "Loving God",
  loving_others: "Loving Others",
  loving_life: "Loving Life",
  review: "Halfway",
  finish: "Finishing",
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  done: "Done",
  partly: "Partly",
  not_yet: "Not yet",
};

export const OUTCOME_HINTS: Record<Outcome, string> = {
  done: "I did what I said.",
  partly: "I did some of it.",
  not_yet: "I have not started. That is okay.",
};

export const ATTENDANCE_LABELS: Record<Attendance, string> = {
  present: "Here",
  absent: "Away",
  excused: "Excused",
};

/** One line for each thing the app asks a member to do. */
export function nudgeLine(kind: NudgeKind, week: number, weeks: number): { title: string; action: string } {
  switch (kind) {
    case "set_step":
      return { title: `Choose your step for week ${week}.`, action: "Choose my step" };
    case "check_in":
      return { title: `How did your step go in week ${week}?`, action: "Check in" };
    case "pulse":
      return {
        title: week === 1 ? "Tell us where you are starting." : week === weeks ? "Tell us how the season ended." : "Take the halfway check-in.",
        action: "Answer three questions",
      };
    case "testimony":
      return { title: "Share what God has done this season.", action: "Write a testimony" };
  }
}

export const PULSE_QUESTIONS = {
  belonging: "I belong in this circle.",
  intro: "Five quick questions. Your answers help your leader care for the circle. Nothing you write here is shown to the circle.",
} as const;

export const SCALE_LABELS = ["Not at all", "A little", "Somewhat", "Mostly", "Completely"] as const;
export const PROGRESS_LABELS = ["Not yet", "A little", "Halfway", "Nearly", "Fully there"] as const;

export const PULSE_PRIVACY = "If you answer 1 or 2 on belonging, your leader will check in with you. Nothing else you answer here is shared.";

export const FLAG_LABELS: Record<FlagKind, string> = {
  missed_twice: "Missed two meetings in a row",
  not_yet_twice: "Two weeks without a step",
  low_belonging: "Does not feel they belong yet",
  leader_concern: "A concern you raised",
};

export const FLAG_ADVICE: Record<FlagKind, string> = {
  missed_twice: "Nobody misses twice without a call. A short, warm call or voice note is best.",
  not_yet_twice: "Ask what is getting in the way and whether the step can be smaller.",
  low_belonging: "Listen first. Ask what would help them feel part of the circle.",
  leader_concern: "Follow up the way you planned, and tell your coach if you need support.",
};

export const CALL_LABELS: Record<CallOutcome, string> = {
  reached: "I spoke with them",
  not_reached: "I could not reach them",
  needs_care_lead: "They need more help than I can give",
};

export const STATUS_LABELS: Record<ReportStatus, { text: string; tone: "gold" | "neutral" | "flame" | "outline" | "charcoal" }> = {
  on_track: { text: "On track", tone: "gold" },
  watch: { text: "Keep an eye", tone: "neutral" },
  needs_attention: { text: "Needs attention", tone: "flame" },
  no_log: { text: "Not logged yet", tone: "charcoal" },
  upcoming: { text: "Upcoming", tone: "outline" },
};

export const SHARE_OPTIONS = [
  { value: "circle", title: "My circle", description: "After your leader has read it." },
  { value: "church", title: "The whole church", description: "After your leader and a pastor have read it." },
] as const;

export const CREDIT_OPTIONS = [
  { value: "first_name", title: "My first name" },
  { value: "full_name", title: "My full name" },
  { value: "anonymous", title: "No name" },
] as const;

export const TESTIMONY_STATUS: Record<string, string> = {
  submitted: "Waiting for your leader",
  circle_approved: "Shared with your circle",
  church_approved: "Shared with the church",
  declined: "Not shared",
};

export function celebrationLine(c: { kind: string; first_name: string; on?: string }): string {
  switch (c.kind) {
    case "birthday":
      return `${c.first_name}’s birthday is ${c.on ? `on ${formatDate(c.on)}` : "this week"}. Send a blessing.`;
    case "every_meeting":
      return `${c.first_name} has been to every meeting so far. Thank them.`;
    case "steps_streak":
      return `${c.first_name} has finished their step three weeks running. Say so in the circle.`;
    default:
      return "";
  }
}

/** What a leader sends someone they are following up. */
export function followUpMessage(opts: { memberFirst: string; leaderFirst: string; circle: string; kind: FlagKind }): string {
  const { memberFirst, leaderFirst, circle } = opts;
  switch (opts.kind) {
    case "missed_twice":
      return `Hello ${memberFirst}, it is ${leaderFirst} from ${circle}. We have missed you these past two weeks and wanted to check that you are okay. Is there anything we can do to help? No pressure to reply quickly.`;
    case "not_yet_twice":
      return `Hello ${memberFirst}, it is ${leaderFirst} from ${circle}. I wanted to ask how your week has been and whether this week’s step feels too big. We can make it smaller together.`;
    case "low_belonging":
      return `Hello ${memberFirst}, it is ${leaderFirst} from ${circle}. I would love to hear how you are finding the circle and what would make it feel more like home. Could we talk this week?`;
    default:
      return `Hello ${memberFirst}, it is ${leaderFirst} from ${circle}. I was thinking of you and wanted to check how you are doing.`;
  }
}

/** “14 – 20 February” for the week that starts on the given date. */
export function weekRange(startIso: string): string {
  const [y, m, d] = startIso.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 6));
  const start = formatDate(startIso);
  const endIso = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
  const [sd, ...sRest] = start.split(" ");
  const endText = formatDate(endIso);
  const [ed, ...eRest] = endText.split(" ");
  return sRest[0] === eRest[0] ? `${sd} – ${ed} ${eRest[0]}` : `${sd} ${sRest[0]} – ${ed} ${eRest[0]}`;
}

/** “Wednesday 17 February” for a meeting date. */
export function meetingDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const day = names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const full = formatDate(iso).split(" ");
  return `${day} ${full[0]} ${full[1]}`;
}

export function percent(rate: number | null): string {
  return rate === null || rate === undefined ? "–" : `${Math.round(rate * 100)}%`;
}

/** Tidies what someone typed so “When I wake up” and “I wake up” both read well. */
export function tidyWhen(value: string): string {
  return value.trim().replace(/^when\s+/i, "").replace(/[\s,.;:]+$/, "");
}

export function tidyWill(value: string): string {
  return value.trim().replace(/^i\s+will\s+/i, "").replace(/[\s,.;:]+$/, "");
}

/** “When I wake up, I will pray for ten minutes.” */
export function stepSentence(when: string, will: string): string {
  return `When ${tidyWhen(when)}, I will ${tidyWill(will)}.`;
}
