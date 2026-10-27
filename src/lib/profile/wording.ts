import type { FactKey, ItemStatus, LeftOutReason, Outcome } from "./types";

// The words of My page, the private page and the Details Check console. Nothing here decides anything: the database does.

export const FACT_WORDS: Record<FactKey, { label: string; who: string; line: string }> = {
  life_stage: { label: "Stage of life", who: "Leaders", line: "The stage a leader’s Tribe Card is built for. It shapes which members are offered to that tribe." },
  age_range: { label: "Age range", who: "Members", line: "A member’s age range. It shapes which tribes are suggested to them." },
};

export const AUDIENCE_WORDS: Record<string, { name: string; line: string }> = {
  appointed: { name: "Leaders I appointed", line: "Everyone with an active appointment from the office." },
  leaders: { name: "All leaders", line: "Everyone who holds the tribe leader role." },
  tribe: { name: "One tribe’s leader", line: "The leader of the tribe you choose." },
  list: { name: "People I choose", line: "People you pick by name. Under-18s are always left out." },
  unconfirmed: { name: "Everyone with an unconfirmed fact", line: "Everyone the chosen fact applies to whom nobody has yet confirmed." },
};

/** Why people were left out of a run. Counted, never named. */
export const LEFT_OUT_WORDS: Record<LeftOutReason, string> = {
  no_fact: "have nothing recorded to confirm",
  already_confirmed: "have already confirmed it",
  under_18: "are under 18 (never asked this way)",
  switch_off: "are not covered by the Details Check switch",
  already_asked: "were already asked in the last 14 days",
  messages_off: "have turned messages off",
  no_channel: "have no way for us to reach them",
};

export const STATUS_WORDS: Record<ItemStatus, string> = {
  rehearsal: "Rehearsal: nothing sent",
  queued: "Waiting for an answer",
  confirmed: "Confirmed",
  changed: "Changed",
  pending_review: "Waiting for a pastor",
  not_me: "Not the right person",
  later: "Asked to be asked later",
  no_reply: "No answer yet",
  closed: "Stopped",
};

export const CHANNEL_WORDS: Record<string, string> = { whatsapp: "WhatsApp", email: "Email", sms: "Text message" };

/** What a person is told after answering. */
export const OUTCOME_WORDS: Record<Outcome, { title: string; body: string }> = {
  confirmed: { title: "Thank you. That is noted.", body: "Nothing about your tribe changes." },
  applied_now: { title: "Done. It has been changed.", body: "Your Tribe Card had not been approved and nobody had joined, so it changed at once." },
  recorded: { title: "Thank you. We have kept your answer.", body: "You do not have a tribe started yet. The pastor will see your answer beside the card when you start one." },
  pending_review: { title: "Thank you. A pastor will look at this.", body: "It usually takes under five days. Until then everything stays as it is, and nobody is moved." },
  not_me: { title: "Thank you. We have changed nothing.", body: "We will not ask this person again from this message." },
  later: { title: "Of course. We will ask again in a few days.", body: "Nothing has changed." },
};

/** Why a code could not be sent or checked, in words a person can act on. */
export const CODE_WORDS = {
  invalid: "This link isn’t valid. It may have expired. Ask the church office to send a fresh one.",
  locked: (minutes: number | null) => `Too many tries. Please wait ${minutes ?? 30} minutes and ask for a new code.`,
  too_many: "A few codes have been sent already. Please wait an hour, or use the newest one.",
  no_way: "We could not send a code. Please ask the church office for help.",
  expired: "That code has run out. Ask for a new one.",
  format: "The code is six numbers.",
  wrong: (triesLeft: number | null) => `That is not the code${triesLeft !== null ? `. ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left` : ""}.`,
};

export const WAITING_LINE = "A change is already waiting for a pastor to look at it.";

/** On My page: where a fact stands. */
export function standing(by: string, confirmed: boolean): string {
  if (confirmed) return by === "person" ? "You told us this." : "You confirmed this.";
  return by === "office" ? "The church office suggested this. Please check it." : "We have this on record. Please check it.";
}

export const SPECIAL_ROUTE = "A change for someone under 18 goes through the young people’s rules. Ask the church office.";
