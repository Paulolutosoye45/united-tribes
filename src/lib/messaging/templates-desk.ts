import { DESK_EMAIL_SAMPLES, DESK_SUBJECT_MAX, DESK_WORDS as W, OFFER_EMAIL_SAMPLES, OFFER_WORDS as OW, becauseLine, groupWhen, offerCountLine, seatsLine } from "@/lib/desk/wording";
import { DESK_ZONES } from "@/lib/desk/wording";
import { flat, meetsText, smsLine, str } from "./format";
import type { Context, EmailContent, Params, TemplateDef } from "./types";

/**
 * The emails the Leader Desk can send a member (Phase 2a and 2b). All are email only: they are never put to Meta for approval, and the database only ever queues
 * them as email. They come from the church office.
 *
 *   desk_proposal   "A tribe that could suit you": one open tribe the member passes every matching rule for, with the fit and up to three reasons
 *   desk_interest   "Would this group suit you?": a group still being put together, no leader named, one question
 *   desk_found      "Your group has a leader": the leader's first name, no seat promised, one question (Phase 2b)
 *   desk_offer      "Would you lead this group?": asked of one member at a time, on a page of its own, with reminders 24 and 12 hours before it closes (Phase 2b)
 *
 * Rules the wording keeps, and the tests check:
 *   - it promises no seat: choosing a tribe is still the member's, the usual way, and a yes to an interest check is only interest
 *   - it never names another member, never carries a phone number, and says nothing about faith, stage, support or age; the reasons are only about the goal,
 *     the place and the time
 *   - every email has "Not for me" and "Stop these emails"; the button opens a private page and saves nothing until a button there is pressed
 *   - one main button and a subject that fits a phone's lock screen (60 characters)
 */

const clean = (v: unknown, fallback = "") => str(v).replace(/\s+/g, " ").trim() || fallback;

/** The secret in the private link: the message's own, else the one in its reply link. Null when there is none. */
function secretOf(c: Context): string | null {
  if (c.token && /^[a-f0-9]{64}$/.test(c.token)) return c.token;
  const m = /\/r\/([a-f0-9]{64})/.exec(c.reply("done") ?? "");
  return m ? m[1] : null;
}

type Action = "look" | "yes" | "no" | "time" | "stop";
type OfferAction = "lead" | "not_season" | "call" | "tomorrow" | "never" | "stop";
/** A link to the private page with one answer ready (the page asks the member to press the button; opening it changes nothing). */
function pageLink(c: Context, action: Action, fallback: string): string {
  const secret = secretOf(c);
  return secret ? `${c.site}/d/${secret}?a=${action}` : c.link(fallback);
}
/** The same, for the leader offer's page of its own. */
function offerLink(c: Context, action: OfferAction, fallback: string): string {
  const secret = secretOf(c);
  return secret ? `${c.site}/o/${secret}?a=${action}` : c.link(fallback);
}

const fit = (...choices: string[]): string => choices.find((s) => s.length <= DESK_SUBJECT_MAX) ?? choices[choices.length - 1].slice(0, DESK_SUBJECT_MAX).trim();

function tribeMeets(p: Params): string {
  const zone = clean(p.zone);
  const place = clean(p.mode) === "online" ? "" : DESK_ZONES[zone] ?? "";
  return meetsText({ ...p, place_note: place });
}

function proposalEmail(p: Params, c: Context): EmailContent {
  const tribe = clean(p.tribe, "this tribe");
  const leader = clean(p.leader_first, "its leader").slice(0, 30);
  const degree = typeof p.degree === "number" ? Math.floor(p.degree) : null;
  const because = becauseLine(Array.isArray(p.reasons) ? p.reasons.filter((k): k is string => typeof k === "string") : []);
  const seats = seatsLine(typeof p.seats_left === "number" ? Math.floor(p.seats_left) : null);
  return {
    subject: fit(`A tribe that could suit you, ${c.first}`, "A tribe that could suit you"),
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "You told us you would like to join a tribe, and we have not found you a place yet. We think this one could suit you.",
      `${tribe} is led by ${leader}. It meets ${tribeMeets(p)}.`,
      ...(degree !== null ? [`It is a ${degree}% fit with what you told us.${because ? ` ${because}` : ""}`] : because ? [because] : []),
      ...(seats ? [seats] : []),
      W.notice.nothingDecided,
      W.notice.noIsFine,
    ],
    cta: { label: W.buttons.look, url: pageLink(c, "look", "/tribe") },
    options: [
      { label: W.buttons.no, url: pageLink(c, "no", "/tribe") },
      { label: W.stop, url: pageLink(c, "stop", "/tribe") },
    ],
    signoff: ["The church office", "United Tribes"],
  };
}

function interestEmail(p: Params, c: Context): EmailContent {
  const community = clean(p.community);
  const goal = clean(p.goal);
  const about = [community, goal].filter(Boolean).join(": ");
  const capacity = typeof p.capacity === "number" ? Math.floor(p.capacity) : null;
  const hours = typeof p.hours === "number" ? Math.floor(p.hours) : 48;
  return {
    subject: fit(`Would this group suit you, ${c.first}?`, "Would this group suit you?"),
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "We are putting together a new group, and we think you might like to be in it. Before we go further, we would like to know if you are interested.",
      `${about ? `${about}. ` : ""}It would meet ${groupWhen(clean(p.slot), clean(p.mode), clean(p.zone) || null).toLowerCase()}${capacity ? `, with up to ${capacity} people` : ""}. We are still finding its leader.`,
      W.notice.nothingYet,
      `Please answer within ${hours} hours. ${W.notice.silence}`,
    ],
    cta: { label: W.buttons.yes, url: pageLink(c, "yes", "/tribe") },
    options: [
      { label: W.buttons.no, url: pageLink(c, "no", "/tribe") },
      { label: W.buttons.time, url: pageLink(c, "time", "/tribe") },
      { label: W.stop, url: pageLink(c, "stop", "/tribe") },
    ],
    signoff: ["The church office", "United Tribes"],
  };
}

function aboutGroup(p: Params): string {
  return [clean(p.community), clean(p.goal)].filter(Boolean).join(": ");
}

function foundEmail(p: Params, c: Context): EmailContent {
  const about = aboutGroup(p);
  const leader = clean(p.leader_first).slice(0, 30);
  const capacity = typeof p.capacity === "number" ? Math.floor(p.capacity) : null;
  return {
    subject: fit(`Your group has a leader, ${c.first}`, "Your group has a leader"),
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "You told us you were interested in a new group. We have good news about it.",
      `${about ? `${about}. ` : ""}${W.found.about(leader)} It would meet ${groupWhen(clean(p.slot), clean(p.mode), clean(p.zone) || null).toLowerCase()}${capacity ? `, with up to ${capacity} people` : ""}.`,
      W.notice.foundNothingDecided,
      W.notice.foundNoIsFine,
    ],
    cta: { label: W.found.button, url: pageLink(c, "yes", "/tribe") },
    options: [
      { label: W.buttons.no, url: pageLink(c, "no", "/tribe") },
      { label: W.stop, url: pageLink(c, "stop", "/tribe") },
    ],
    signoff: ["The church office", "United Tribes"],
  };
}

function offerEmail(p: Params, c: Context): EmailContent {
  const about = aboutGroup(p);
  const capacity = typeof p.capacity === "number" ? Math.floor(p.capacity) : null;
  const reminder = typeof p.reminder === "string" && p.reminder in OW.reminder ? p.reminder : null;
  const members = typeof p.members === "number" ? Math.floor(p.members) : 0;
  const yes = typeof p.yes === "number" ? Math.floor(p.yes) : 0;
  const counts = offerCountLine(members, p.asked === true, yes);
  const ends = clean(p.ends);
  return {
    subject: reminder
      ? fit(`Reminder: would you lead this group, ${c.first}?`, "Reminder: would you lead this group?")
      : fit(`Would you lead this group, ${c.first}?`, "Would you lead this group?"),
    greeting: `Hi ${c.first},`,
    paragraphs: [
      ...(reminder ? [OW.reminder[reminder]] : []),
      "We are putting together a new group, and we would like to ask you to lead it.",
      `${about ? `${about}. ` : ""}It would meet ${groupWhen(clean(p.slot), clean(p.mode), clean(p.zone) || null).toLowerCase()}${capacity ? `, with up to ${capacity} people` : ""}.${counts ? ` ${counts}` : ""}`,
      `${OW.notice.ask} ${OW.notice.support}`,
      `${OW.notice.nothingYet} If you say yes, you will be asked to confirm that you are 21 or older and to answer two short questions.`,
      `${ends ? `Please answer by ${ends}. ` : ""}${OW.notice.silence}`,
    ],
    cta: { label: OW.buttons.lead, url: offerLink(c, "lead", "/tribe") },
    options: [
      { label: OW.buttons.notSeason, url: offerLink(c, "not_season", "/tribe") },
      { label: OW.buttons.call, url: offerLink(c, "call", "/tribe") },
      { label: OW.buttons.tomorrow, url: offerLink(c, "tomorrow", "/tribe") },
      { label: OW.buttons.never, url: offerLink(c, "never", "/tribe") },
      { label: OW.buttons.stop, url: offerLink(c, "stop", "/tribe") },
    ],
    signoff: ["The church office", "United Tribes"],
  };
}

const lineOf = (def: "proposal" | "interest" | "found" | "offer", p: Params) =>
  def === "proposal"
    ? `${clean(p.tribe, "A tribe")} could suit you. Nothing is decided for you.`
    : def === "interest"
      ? "A new group is being put together. Would it suit you?"
      : def === "found"
        ? "The group you showed interest in has a leader. Nothing is decided for you."
        : "We would like to ask you something about a new group.";

const deskProposal: TemplateDef = {
  key: "desk_proposal",
  audience: "member",
  title: "A member waiting for a tribe is shown one open tribe that fits them, by email, from the Leader Desk",
  emailOnly: true,
  email: (p, c) => proposalEmail(p, c),
  sms: (p, c) => smsLine(`United Tribes: ${lineOf("proposal", p)}`, pageLink(c, "look", "/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
    example: ["Ada", "Builders Tribe could suit you. Nothing is decided for you.", pageLink(c, "look", "/tribe")],
    vars: [flat(c.first), flat(lineOf("proposal", p)), flat(pageLink(c, "look", "/tribe"))],
  }),
};

const deskInterest: TemplateDef = {
  key: "desk_interest",
  audience: "member",
  title: "A member waiting for a tribe is asked, by email, whether a group still being put together would suit them (the Leader Desk's interest check)",
  emailOnly: true,
  email: (p, c) => interestEmail(p, c),
  sms: (p, c) => smsLine(`United Tribes: ${lineOf("interest", p)}`, pageLink(c, "yes", "/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
    example: ["Ada", "A new group is being put together. Would it suit you?", pageLink(c, "yes", "/tribe")],
    vars: [flat(c.first), flat(lineOf("interest", p)), flat(pageLink(c, "yes", "/tribe"))],
  }),
};

const deskFound: TemplateDef = {
  key: "desk_found",
  audience: "member",
  title: "A member who showed interest in a draft group is told, by email, that it has found a leader (the Leader Desk, no seat promised)",
  emailOnly: true,
  email: (p, c) => foundEmail(p, c),
  sms: (p, c) => smsLine(`United Tribes: ${lineOf("found", p)}`, pageLink(c, "yes", "/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
    example: ["Ada", "The group you showed interest in has a leader. Nothing is decided for you.", pageLink(c, "yes", "/tribe")],
    vars: [flat(c.first), flat(lineOf("found", p)), flat(pageLink(c, "yes", "/tribe"))],
  }),
};

const deskOffer: TemplateDef = {
  key: "desk_offer",
  audience: "member",
  title: "A member is asked, by email, whether they would lead a draft group (the Leader Desk's leader offer, with reminders 24 and 12 hours before it closes)",
  emailOnly: true,
  email: (p, c) => offerEmail(p, c),
  sms: (p, c) => smsLine(`United Tribes: ${lineOf("offer", p)}`, offerLink(c, "lead", "/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
    example: ["Ada", "We would like to ask you something about a new group.", offerLink(c, "lead", "/tribe")],
    vars: [flat(c.first), flat(lineOf("offer", p)), flat(offerLink(c, "lead", "/tribe"))],
  }),
};

export const DESK_TEMPLATES: TemplateDef[] = [deskProposal, deskInterest, deskFound, deskOffer];

/** Believable fields as the database supplies them (desk_tribe_params and desk_interest_params). Used by the tests and the template list. */
export const DESK_SAMPLES: Record<string, Params> = { ...DESK_EMAIL_SAMPLES, ...OFFER_EMAIL_SAMPLES } as unknown as Record<string, Params>;
