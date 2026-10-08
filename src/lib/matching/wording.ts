import { ZONE_LABELS, dayName, clockLabel } from "@/lib/academy/options";
import type { CircleCardForMember, DegreeLabel } from "./types";

/** The wording a member agrees to. Bump the version whenever the meaning changes; it is stored with each agreement. */
export const AGREEMENT_VERSION = "2026-11-c1";

export const COVENANT_PROMISES = [
  "I will come to my circle each week, on time, or tell my leader early if I cannot.",
  "I will keep what is shared in my circle private.",
  "I will pray for the people in my circle and take one small step toward my goal each week.",
  "I will help my circle refine its Success Picture in week 1, and I will say honestly in week 12 whether we got there.",
] as const;

export const AGREEMENT_SENTENCE =
  "I agree to this Success Picture and to the Circle Covenant. I understand my leader will see my name and, if I said yes to WhatsApp, my number.";

export const LABELS: Record<DegreeLabel, { text: string; blurb: string }> = {
  excellent: { text: "Excellent fit", blurb: "Very close to what you asked for" },
  strong: { text: "Strong fit", blurb: "Close on most of what you asked for" },
  good: { text: "Good fit", blurb: "A fair match with some differences" },
};

export function labelFor(degree: number): DegreeLabel {
  return degree >= 85 ? "excellent" : degree >= 70 ? "strong" : "good";
}

const MODE = { online: "Online", in_person: "In person" } as const;

/** “Wednesdays at 8:00 pm” */
export function whenLine(c: Pick<CircleCardForMember, "meeting_day" | "meeting_time">): string {
  return `${dayName(c.meeting_day)}s at ${clockLabel(c.meeting_time)}`;
}

/** “Online · 75 minutes” or “In person · Iganmu, Surulere and nearby · 75 minutes” */
export function whereLine(c: Pick<CircleCardForMember, "mode" | "zone" | "duration_minutes">): string {
  const parts: string[] = [MODE[c.mode] ?? ""];
  if (c.mode === "in_person") parts.push(ZONE_LABELS[c.zone] ?? "");
  parts.push(`${c.duration_minutes} minutes`);
  return parts.filter(Boolean).join(" · ");
}

export function seatsLine(seatsLeft: number): string {
  if (seatsLeft <= 0) return "Full";
  return seatsLeft === 1 ? "1 seat left" : `${seatsLeft} seats left`;
}

/** One plain sentence for each reason key the engine stores. Unknown keys are dropped rather than shown raw. */
export function reasonText(key: string, c: CircleCardForMember): string | null {
  switch (key) {
    case "goal_same":
      return `Everyone here is working on the same goal as you: ${c.goal ? `“${c.goal}”` : "your Season Goal"}.`;
    case "goal_family":
      return `Its goal${c.goal ? `, “${c.goal}”,` : ""} is close to yours.`;
    case "stage_same":
      return c.track ? `Everyone is at your stage of life: ${c.track}.` : "Everyone is at your stage of life.";
    case "tribe_same":
      return c.tribe ? `It is built on your tribe, ${c.tribe}.` : "It is built on your tribe.";
    case "tribe_related":
      return c.tribe ? `Its tribe, ${c.tribe}, shares ground with yours.` : "Its tribe shares ground with yours.";
    case "place_same":
      return `It meets in your part of Lagos.`;
    case "place_near":
      return `It meets close to you, in ${ZONE_LABELS[c.zone] ?? "Lagos"}.`;
    case "place_online":
      return "It meets online, so distance is no problem.";
    case "rhythm_fit":
      return `It meets on ${whenLine(c)}, a time that works for you.`;
    case "style_leader":
      return `Its leader, ${c.leader_first_name}, leads in a way that suits how you like to work.`;
    case "style_balance":
      return "You would add balance to the mix of voices in the group.";
    case "faith_needed":
      return "Your stage of faith is one this circle will gain from.";
    case "seats_open":
      return `It has room for you, and ${c.leader_first_name} is ready to walk with you.`;
    default:
      return null;
  }
}

export function reasonsFor(keys: string[], c: CircleCardForMember): string[] {
  return keys.map((k) => reasonText(k, c)).filter((s): s is string => Boolean(s)).slice(0, 3);
}

export const CIRCLE_TYPE_LINE: Record<string, string> = {
  mixed: "Women and men together",
  women: "Women only",
  men: "Men only",
};

/** The message a leader sends a new member on WhatsApp. */
export function welcomeMessage(opts: { memberFirst: string; leaderFirst: string; circle: string; when: string | null }): string {
  const start = opts.when ? ` We meet for the first time on ${opts.when}.` : "";
  return `Hello ${opts.memberFirst}, welcome to ${opts.circle}! This is ${opts.leaderFirst}, your circle leader.${start} I will add you to our WhatsApp group soon. If you have any questions before then, just reply here.`;
}
