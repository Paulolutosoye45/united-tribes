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
  withhold: "My leader will see my name, but will not be given my email or my WhatsApp number. They will be told to expect me instead.",
} as const;

/** The group link, said to a member who has not yet answered about sharing. Joining a WhatsApp group shows your number to everyone in it. */
export const PLACED_CONTACT_WORDS = {
  groupWhen: (when: string) => `The tribe’s WhatsApp group link will appear here on ${when}, or as soon as you press “Yes, I’m in”. Joining a WhatsApp group shows your number to everyone in it.`,
  groupWaiting: "The tribe’s WhatsApp group link will appear here as soon as you press “Yes, I’m in”, or a day after we have emailed you. Joining a WhatsApp group shows your number to everyone in it.",
  groupWarning: "Joining a WhatsApp group shows your number to everyone in it.",
} as const;

/** The marks a leader sees beside a church-placed member's name. */
export const LEADER_MARKS = {
  yetToAnswer: "Placed by the church, yet to answer",
  saidYes: "Said yes",
  details: "Details open",
  withheld: "Details withheld",
  notReached: "Not yet reached",
  opensOn: (date: string) => `Details open ${date}`,
} as const;

/** The empty page for a leader whose tribe has no one in it yet. */
export const LEADER_EMPTY =
  "No one has been placed in your tribe yet. Members who choose your tribe appear here the moment they join. Members the church places appear here by name as soon as they are placed; their email and WhatsApp number follow when each has said yes, or a day after they are told.";

/** What each state on the God Mode board means, in the words of Check 4 in the blueprint. */
export const TEAM_STATE_TEXT: Record<string, { label: string; line: string }> = {
  rehearsal: { label: "Rehearsal", line: "A rehearsal. Nobody was seated." },
  placing: { label: "Still placing", line: "Some members of this tribe are still to be placed." },
  waiting: { label: "Waiting for emails", line: "At least one member’s email has not gone out yet." },
  holding: { label: "In the hold", line: "Every email has gone. Some members’ details open when their day has passed." },
  none_sent: { label: "No email has gone", line: "Every member email failed or was skipped. Fix sending, then ask for a re-send." },
  due: { label: "Due now", line: "Ready. The leader is told on the next heartbeat." },
  told: { label: "Leader told", line: "The leader has their team." },
  opened: { label: "Opened by you", line: "You opened this tribe’s details for the leader." },
  cancelled: { label: "Cancelled", line: "This tribe’s placement was cancelled." },
};

/** The line under the consent box on the form. Shown once, before the form is sent. */
export const TEAM_CONTACT_LINE =
  "If the church places me in a tribe, my leader will see my name at once, and may be given my email and my WhatsApp number (if I gave one) a day after I am told. I can say no at any time before then.";

/** Where the season stands for placing, in one or two sentences. Written here so the page, the run board and the tests say the same thing. */
export function windowLine(
  w: { name: string; started: boolean; week: number | null; weeks: number; open: boolean } | null,
  startsOn: string | null,
  closesOn: string | null,
  day: (iso: string) => string,
): string {
  if (!w) return "No season is open. ";
  if (!w.started) return `${w.name}, starting ${startsOn ? day(startsOn) : "soon"}. `;
  const week = `${w.name} is running, in week ${w.week ?? 1} of ${w.weeks}.`;
  if (w.open) return `${week} Joining is open until ${closesOn ? day(closesOn) : "the end of week 2"}, so people can still be placed. `;
  return `${week} Joining closed on ${closesOn ? day(closesOn) : "the end of week 2"}. Tick “place after the cut-off” to place people now anyway. `;
}

/** What is different about a run in a season that has already started. Shown beside the Plan a run button. */
export const IN_SEASON_PROMISES = [
  "A tribe that has started is never held back for being small: a new member is welcome in any tribe that is already meeting.",
  "A member who changed their answers or ran the matching in the last two days is left to choose for themselves.",
  "The first meeting is asked for within a week of being placed. A member can still look at other tribes until joining closes.",
  "A leader hears about new members at most once a day.",
] as const;

export const PLAN_PROMISES = [
  "Members are told their tribe by email, a hundred or so at a time through the day, not all at once.",
  "A leader sees everyone the church places in their tribe, by name, as soon as they are placed. Each member’s email and WhatsApp number open a day after that member was emailed, or at once if they say yes. A member who says “don’t share my details” stays withheld. The tribe’s WhatsApp group link follows the same rule. You can open a tribe early on the run board.",
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

/** The heartbeat line on the God Mode pages: when it last ran, in a form that reads the same on the server and in the browser. */
export const HEARTBEAT_HINT =
  "The heartbeat sends the waiting emails and tells leaders their team. It should run every few minutes; if the time above is more than an hour old, it is not running.";
