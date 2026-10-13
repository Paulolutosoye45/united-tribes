import type { AssistantState, ModelKey, Plan, SwapReason, SwapStatus } from "./types";

/** The words for what a matching weight measures. Shown beside the number so nobody has to guess. */
export const MODEL_PARTS: Record<ModelKey, { label: string; blurb: string }> = {
  goal: { label: "Goal", blurb: "Working on the same Season Goal" },
  stage: { label: "Stage of life", blurb: "Being in a similar season of life" },
  community: { label: "Community", blurb: "Sharing a community" },
  place: { label: "Place", blurb: "Meeting where and how they prefer" },
  style: { label: "Style", blurb: "Talking and learning in a similar way" },
  rhythm: { label: "Rhythm", blurb: "Meeting at a time that works" },
  faith: { label: "Faith journey", blurb: "Being at a similar point in their walk with God" },
};

export const SWAP_REASON_LABELS: Record<SwapReason, { label: string; hint: string }> = {
  time: { label: "The time doesn’t work", hint: "The day or hour clashes with work, school or family" },
  place: { label: "Too far, or the wrong format", hint: "Travel, or I would rather meet online or in person" },
  fit: { label: "It isn’t the right fit", hint: "I don’t feel I belong with this group" },
  conflict: { label: "A difficulty in the group", hint: "Something has happened that makes it hard to stay" },
  other: { label: "Something else", hint: "You can tell your coach more in the note" },
};

export const SWAP_STATUS: Record<SwapStatus, { label: string; tone: "neutral" | "flame" | "gold" | "charcoal" | "outline" }> = {
  requested: { label: "Waiting for your coach", tone: "gold" },
  offered: { label: "A tribe is offered", tone: "flame" },
  moved: { label: "Moved", tone: "charcoal" },
  declined: { label: "Not this time", tone: "outline" },
  withdrawn: { label: "Withdrawn", tone: "outline" },
  member_declined: { label: "Stayed in the tribe", tone: "outline" },
};

export const PLAN_LABELS: Record<Plan, { label: string; blurb: string }> = {
  assistant_leads: { label: "Assistant leads a new tribe", blurb: "The certified assistant starts a new tribe next season, in a community you choose." },
  leader_continues: { label: "Leader continues", blurb: "The same leader runs a tribe again next season." },
  leader_rests: { label: "Leader rests a season", blurb: "A season off, with care. They are still part of the community." },
  closes: { label: "Tribe closes", blurb: "This tribe does not run next season." },
};

export const ASSISTANT_STATE: Record<AssistantState, { label: string; tone: "neutral" | "flame" | "gold" | "charcoal" | "outline" }> = {
  none: { label: "No assistant", tone: "outline" },
  in_training: { label: "Assistant in training", tone: "neutral" },
  certified: { label: "Assistant is certified", tone: "gold" },
};

export const KIND_LABELS: Record<string, string> = { mixed: "Mixed tribe", women: "Women’s tribe", men: "Men’s tribe" };

/** "0.412" → "0.41"; null → "not enough results". */
export function correlation(value: number | null | undefined): string {
  return value === null || value === undefined ? "Not enough results" : Number(value).toFixed(2);
}

/** "+0.12" or "−0.04" for how much higher thriving members scored on a part than the others. */
export function liftText(lift: number | null | undefined): string {
  if (lift === null || lift === undefined) return "n/a";
  const n = Number(lift);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}`;
}

/** The change from the weights in use to the proposed ones, as "+3" / "−2" / "no change". */
export function weightChange(from: number, to: number): string {
  const d = Math.round(to - from);
  if (d === 0) return "no change";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)}`;
}
