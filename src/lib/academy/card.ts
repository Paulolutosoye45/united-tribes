import { timesFor } from "./options";
import type { TribeCard, TribeMode, TribeType } from "./types";

/** What a leader types on the Tribe Card. Strings are empty, not null, so inputs stay controlled. */
export type CardValues = {
  name: string;
  tribe_type: TribeType;
  track: string;
  community: string;
  goal: string;
  story: string;
  meeting_day: number | null;
  meeting_time: string;
  mode: TribeMode | "";
  zone: string;
  place_note: string;
  capacity: number;
  god: string;
  others: string;
  life: string;
};

export const LIMITS = {
  name: { min: 3, max: 48 },
  story: { min: 40, max: 300 },
  line: { min: 15, max: 200 },
  place: { max: 120 },
} as const;

export function valuesFromCard(card: TribeCard): CardValues {
  return {
    name: card.name ?? "",
    tribe_type: card.tribe_type,
    track: card.track?.slug ?? "",
    community: card.community?.slug ?? "",
    goal: card.goal?.slug ?? "",
    story: card.story ?? "",
    meeting_day: card.meeting_day,
    meeting_time: card.meeting_time ?? "",
    mode: card.mode ?? "",
    zone: card.zone ?? "",
    place_note: card.place_note ?? "",
    capacity: card.capacity,
    god: card.god ?? "",
    others: card.others ?? "",
    life: card.life ?? "",
  };
}

/** The same rules as the database, so the screen can say what is missing before the leader sends the card. */
export function missingFields(v: CardValues): string[] {
  const out: string[] = [];
  const len = (s: string) => s.trim().length;
  if (len(v.name) < LIMITS.name.min) out.push("name");
  if (!v.track) out.push("track");
  if (!v.community) out.push("community");
  if (!v.goal) out.push("goal");
  if (len(v.story) < LIMITS.story.min) out.push("story");
  if (v.meeting_day === null || !timesFor(v.meeting_day).includes(v.meeting_time)) out.push("time");
  if (!v.mode) out.push("mode");
  if (!v.zone) out.push("zone");
  if (len(v.god) < LIMITS.line.min) out.push("god");
  if (len(v.others) < LIMITS.line.min) out.push("others");
  if (len(v.life) < LIMITS.line.min) out.push("life");
  return out;
}

export function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

/** The part of a longer story that fits the card, cut at a full stop so it does not end mid-sentence. */
export function storyForCard(text: string | null | undefined, max: number = LIMITS.story.max): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop >= 80) return cut.slice(0, stop + 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 0 ? space : max).replace(/[,;:\s]+$/, "")}…`;
}
