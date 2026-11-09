import { longDay, SEQ_SUBJECT_MAX, SEQ_WORDS, isSeqStep, type SeqStep } from "@/lib/placement/answers";
import { flat, meetsText, shortDay, smsLine, str } from "./format";
import type { Context, EmailContent, Params, TemplateDef } from "./types";

/**
 * The emails of the placed answer sequence (Package 6b), sent after the placement email to a member who has not answered. All are email only: they are
 * never put to Meta for approval, and the database only ever queues them as email. They come from the church office.
 *
 *   2a  "Did this reach you?"                  the page has not been opened: we are not sure the first email arrived
 *   2b  "Anything stopping you from joining?"  the page has been opened: we ask what is in the way, and say that no is a fine answer
 *   3   "Still held"                           every few days while there is time: the seat is held, and how many seats in the tribe are answered
 *   4   "Last call"                            the day before joining closes; nothing follows it
 *   remind                                     the one email a member asked for with "Remind me tonight", at 6 pm
 *
 * Rules the wording keeps, and the tests check:
 *   - it never says the person did something wrong, never says whether they opened a page (a mail scanner can open a link), and never names another member
 *   - it carries no phone number, not even with its middle hidden, and no faith journey, support need, score or age; the reasons for the placement are only
 *     about the tribe's time and place
 *   - the leader's one line (written by the leader, one plain sentence, no links) is shown as theirs, and only when there is one
 *   - the progress line (how many seats of the tribe are answered) appears only when at least three have answered and the tribe has at least five seats
 *   - it says in one plain sentence that the church office may call, and gives Don't call me; "Stop these reminders" and "Not this season" are in every email
 *   - Last call is plain: it says it is the last and it never threatens. Remind me tonight is not offered in it, because there is no tonight left
 *   - one main button and a subject that fits a phone's lock screen (60 characters)
 */

const clean = (v: unknown, fallback = "") => str(v).replace(/\s+/g, " ").trim() || fallback;
const leaderOf = (p: Params) => clean(p.leader_first, "your leader").slice(0, 30).trim();
const tribeOf = (p: Params) => clean(p.tribe, "your tribe");
const stepOf = (p: Params): SeqStep => (isSeqStep(p.step) ? p.step : "2a");

/** The secret in the private link: the message's own, else the one in its reply link. Null when there is none. */
function secretOf(c: Context): string | null {
  if (c.token && /^[a-f0-9]{64}$/.test(c.token)) return c.token;
  const m = /\/r\/([a-f0-9]{64})/.exec(c.reply("done") ?? "");
  return m ? m[1] : null;
}

type Action = "confirm" | "change" | "notnow" | "call" | "remind" | "stop";
/** A link to the private page with one answer ready (the page asks the member to press the button; opening it changes nothing). */
function pageLink(c: Context, action: Action): string {
  const secret = secretOf(c);
  return secret ? `${c.site}/placed/${secret}?a=${action}` : c.link("/tribe");
}

const WHY: Record<string, string> = {
  rhythm_fit: "it meets at a time that fits the rhythm you told us about",
  place_same: "it meets in your area",
  place_near: "it meets near you",
  place_online: "it meets online, so you can join from wherever you are",
};
/** Why this tribe, in one sentence, from the reasons about its time and place only. Nothing when there are none. */
function whyLine(p: Params): string[] {
  const keys = Array.isArray(p.why) ? p.why.filter((k): k is string => typeof k === "string" && k in WHY).slice(0, 2) : [];
  if (keys.length === 0) return [];
  return [`We placed you here because ${keys.map((k) => WHY[k]).join(" and ")}.`];
}

/** The line about the seat and the day: held, and until when a member can switch. */
function heldLine(p: Params): string {
  const day = clean(p.deadline);
  if (!day) return "Your seat is held for you.";
  return p.can_change === false ? `Your seat is held for you. Joining closes on ${longDay(day)}.` : `Your seat is held for you. You can switch tribes until ${longDay(day)}.`;
}

/** How many seats of the tribe are answered: only when it is a true and encouraging thing to say. */
function progress(p: Params): { answered: number; seats: number } | null {
  const answered = typeof p.answered === "number" ? Math.floor(p.answered) : 0;
  const seats = typeof p.seats === "number" ? Math.floor(p.seats) : 0;
  return answered >= 3 && seats >= 5 && answered <= seats ? { answered, seats } : null;
}

/** A subject that fits a lock screen: the wording asked for, else its shorter form. */
function fit(...choices: string[]): string {
  return choices.find((s) => s.length <= SEQ_SUBJECT_MAX) ?? choices[choices.length - 1].slice(0, SEQ_SUBJECT_MAX).trim();
}

function subjectFor(p: Params, first: string): string {
  const tribe = tribeOf(p);
  const day = clean(p.deadline) ? shortDay(clean(p.deadline)) : "";
  const pr = progress(p);
  switch (stepOf(p)) {
    case "2a":
      return fit(`Did this reach you, ${first}?`, "Did this reach you?");
    case "2b":
      return fit(`Anything stopping you from joining ${tribe}?`, "Anything stopping you from joining?");
    case "3":
      return pr ? fit(`${pr.answered} of ${pr.seats} seats in ${tribe} are answered`, `${pr.answered} of ${pr.seats} seats are answered`) : fit(`${tribe} is still holding your seat`, "Your seat is still held");
    case "4":
      return day ? fit(`Last call: ${tribe} is held until ${day}`, `Last call: your seat is held until ${day}`, "Last call for your seat") : fit(`Last call for your seat in ${tribe}`, "Last call for your seat");
    default:
      return fit(`Your reminder: ${tribe} is holding your seat`, "Your reminder about your seat");
  }
}

/** The leader's own line, as a paragraph that says whose it is. It is written by the leader (one plain sentence, no links), so it is shown in quotation marks and never as the church's. */
function leaderLine(p: Params): string[] {
  const line = clean(p.leader_line).slice(0, 200);
  return line ? [`${leaderOf(p)} adds: “${line}”`] : [];
}

function emailFor(p: Params, c: Context): EmailContent {
  const step = stepOf(p);
  const tribe = tribeOf(p);
  const leader = leaderOf(p);
  const meets = `It meets ${meetsText(p)}.`;
  const canChange = p.can_change === true;

  const options: { label: string; url: string }[] = [];
  if (canChange) options.push({ label: SEQ_WORDS.buttons.other, url: pageLink(c, "change") });
  options.push({ label: SEQ_WORDS.buttons.notNow, url: pageLink(c, "notnow") });
  options.push({ label: SEQ_WORDS.buttons.call, url: pageLink(c, "call") });
  if (step !== "4" && step !== "remind") options.push({ label: SEQ_WORDS.buttons.remind, url: pageLink(c, "remind") });
  options.push({ label: SEQ_WORDS.stop, url: pageLink(c, "stop") });

  const tail = [SEQ_WORDS.mayCall, SEQ_WORDS.why];
  const body: string[] = [];
  const pr = progress(p);

  if (step === "2a") {
    body.push(
      `The church placed you in ${tribe}, led by ${leader}. We are not sure our first email reached you, so we are writing once more.`,
      meets,
      ...whyLine(p),
      heldLine(p),
    );
  } else if (step === "2b") {
    body.push(
      `If something is in the way of joining ${tribe}, we would like to know. Saying no is a fine answer too.`,
      `${tribe} is led by ${leader}. ${meets}`,
      ...whyLine(p),
      canChange
        ? "If the time or the place does not suit you, you can look at other tribes. If this is not your season, tell us, and we will not place you in a tribe again this season. If you would like to talk it over, press Call me."
        : "If this is not your season, tell us, and we will not place you in a tribe again this season. If you would like to talk it over, press Call me.",
      heldLine(p),
    );
  } else if (step === "3") {
    body.push(
      `${tribe} is still holding your seat.`,
      ...(pr ? [`${pr.answered} of the ${pr.seats} seats are already answered, and the tribe is taking shape.`] : []),
      `${leader} leads it. ${meets}`,
      heldLine(p),
    );
  } else if (step === "4") {
    body.push(
      `This is the last of these emails. ${tribe} is holding your seat until ${longDay(clean(p.deadline))}.`,
      `After that day you can no longer switch tribes on your own, though you can still ask the church office. We will not send you another reminder about this seat.`,
      `${leader} leads ${tribe}. ${meets}`,
    );
  } else {
    body.push(
      `You asked us to remind you tonight. ${tribe} is holding your seat.`,
      `${leader} leads it. ${meets}`,
      heldLine(p),
    );
  }

  return {
    subject: subjectFor(p, c.first),
    greeting: `Hi ${c.first},`,
    paragraphs: [...body, ...leaderLine(p), ...tail],
    cta: { label: SEQ_WORDS.buttons.yes, url: pageLink(c, "confirm") },
    options,
    signoff: ["The church office", "United Tribes"],
  };
}

const lineOf = (p: Params) => `${tribeOf(p)} is holding your seat. ${stepOf(p) === "4" ? "This is the last reminder." : "One tap answers."}`;

const placedSeq: TemplateDef = {
  key: "placed_seq",
  audience: "member",
  title: "A placed member who has not answered is asked, by email, to say yes, no or call me (the answer sequence)",
  emailOnly: true,
  email: (p, c) => emailFor(p, c),
  sms: (p, c) => smsLine(`United Tribes: ${lineOf(p)}`, pageLink(c, "confirm")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
    example: ["Ada", "Builders Tribe is holding your seat. One tap answers.", pageLink(c, "confirm")],
    vars: [flat(c.first), flat(lineOf(p)), flat(pageLink(c, "confirm"))],
  }),
};

export const PLACED_SEQ_TEMPLATES: TemplateDef[] = [placedSeq];

/** Believable fields as the database supplies them (placement_member_params plus the sequence's own). Used by the tests and the template list. */
export const PLACED_SEQ_SAMPLES: Record<string, Params> = {
  placed_seq: {
    step: "2a",
    tribe: "Builders Tribe",
    leader_first: "Ngozi",
    assistant_first: "Dayo",
    meeting_day: 3,
    meeting_time: "20:00",
    mode: "online",
    place_note: "",
    starts_on: "2027-02-14",
    season: "Season 1",
    deadline: "2026-11-22",
    can_change: true,
    leader_line: "I’m praying for this tribe, and I can’t wait to meet you.",
    why: ["rhythm_fit", "place_online"],
    answered: 7,
    seats: 12,
  },
};
