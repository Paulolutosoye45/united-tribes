/**
 * The words on the Placement screens. Every reason a member was left out has one plain sentence, so a person reading a run never has
 * to guess what a code means, and none of the sentences names anything a member said about their private life.
 */

export const MODE_WORDS: Record<"off" | "rehearsal" | "on", { name: string; line: string }> = {
  off: { name: "Off", line: "Nothing is placed and no email is sent. This is how it starts." },
  rehearsal: { name: "Rehearsal", line: "Plans are made and walked through, but no seat is taken and no email goes out. What each leader would have received is kept in the message log." },
  on: { name: "On", line: "Approved plans seat members and send their emails." },
};

/** Why someone was left out of a run, in the order a person would want to read them. */
export const REASON_TEXT: Record<string, string> = {
  leader: "Leads a tribe, so is not placed as a member",
  held: "On hold: you set them aside",
  needs_form: "Has not finished the form yet",
  no_consent: "Has not agreed to be matched",
  under18: "Under 18: a young person is never placed automatically",
  deletion_open: "Has asked for their data to be erased",
  cannot_email: "Has no email we may use",
  other_season: "Their form is for another season",
  in_grace: "Changed their answers or looked for a tribe in the last few days, so is given time to choose",
  no_tribe: "No tribe fits their stage, time or format",
  below_bar: "The best tribe is below the compatibility bar",
  full: "Every tribe that fits is full",
  too_small: "Their tribe would have been too small, so they were held back",
  removed: "You took them out of the plan",
  chose_own: "Chose a tribe themselves while the plan was waiting",
  tribe_closed: "Their tribe was closed before they were placed",
  tribe_changed: "Their tribe changed before they were placed",
  tribe_full: "Their tribe filled before they were placed",
  run_undone: "The run was undone before they were placed",
  other: "Left out for another reason",
};

export function reasonText(code: string | null): string {
  return (code && REASON_TEXT[code]) || REASON_TEXT.other;
}

export const STATUS_TEXT: Record<string, string> = {
  pooled: "Waiting to be looked at",
  counted: "Counted",
  proposed: "In the plan",
  placed: "Placed",
  rehearsed: "Rehearsed",
  unplaced: "Not placed",
  skipped: "Left out",
  held: "On hold",
  removed: "Taken out",
  undone: "Undone",
};

export const RUN_STATUS_TEXT: Record<string, string> = {
  planning: "Planning",
  planned: "Waiting for you",
  approved: "Approved",
  placing: "Placing",
  placed: "Placed",
  closed: "Finished",
  undone: "Undone",
  cancelled: "Cancelled",
};

export const PHASE_TEXT: Record<string, string> = {
  count: "Counting who can be placed",
  assign: "Choosing a tribe for each member",
  check: "Checking every tribe",
  ready: "Ready to read",
};

export const ZONE_TEXT: Record<string, string> = {
  "iganmu-surulere": "Iganmu, Surulere and nearby",
  mainland: "Lagos Mainland",
  "island-lekki": "Lagos Island and Lekki",
  "other-nigeria": "Elsewhere in Nigeria",
  abroad: "Abroad",
};

/** What the three buttons on the member's page promise, said before they are pressed. */
export const PLACED_PROMISES = {
  confirm: "Your place is confirmed.",
  change: "I will look at other tribes. My place in this one is given up.",
  withhold: "My leader will not be given my email or my WhatsApp number. They will be told to expect me instead.",
} as const;

/** The line under the consent box on the form. Shown once, before the form is sent. */
export const TEAM_CONTACT_LINE =
  "If the church places me in a tribe, my leader may be given my name, my email and my WhatsApp number (if I gave one) a day after I am told. I can say no at any time before then.";

export const PLAN_PROMISES = [
  "Members are told their tribe by email, a hundred or so at a time through the day, not all at once.",
  "Each leader is told who is on their team a day after the last of their members was told. A member who says “don’t share my details” is listed as withheld.",
  "You can undo the whole run until a tribe’s leader has been told. After that, that tribe stays as it is.",
  "Nobody under 18 is placed. Nobody who has not agreed to be matched is placed.",
] as const;

export const BULK_PROMISES = [
  "Each person is given the leader role and their Tribe Card is started, with the community and the goal already chosen.",
  "A pastor still reviews every card and the Academy still certifies every leader. Members see no tribe until both are done.",
  "Each leader is emailed that they have been appointed. Nothing is sent until you apply the plan.",
] as const;

/** 12345 as "12,345", written by hand: the browser and the server do not always agree on number formats. */
export const count = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export const pluralise = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** "9am" to "7pm" */
export function hourText(h: number): string {
  const n = ((Math.round(h) % 24) + 24) % 24;
  const suffix = n < 12 ? "am" : "pm";
  const twelve = n % 12 === 0 ? 12 : n % 12;
  return `${twelve}${suffix}`;
}
