import { DESK_EMAIL_SAMPLES, DESK_SUBJECT_MAX, DESK_WORDS as W, becauseLine, groupWhen, seatsLine } from "@/lib/desk/wording";
import { DESK_ZONES } from "@/lib/desk/wording";
import { flat, meetsText, smsLine, str } from "./format";
import type { Context, EmailContent, Params, TemplateDef } from "./types";

/**
 * The two emails the Leader Desk can send a member who is waiting for a tribe (Phase 2a). Both are email only: they are never put to Meta for approval, and the
 * database only ever queues them as email. They come from the church office.
 *
 *   desk_proposal   "A tribe that could suit you": one open tribe the member passes every matching rule for, with the fit and up to three reasons
 *   desk_interest   "Would this group suit you?": a group still being put together, no leader named, one question
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
/** A link to the private page with one answer ready (the page asks the member to press the button; opening it changes nothing). */
function pageLink(c: Context, action: Action, fallback: string): string {
  const secret = secretOf(c);
  return secret ? `${c.site}/d/${secret}?a=${action}` : c.link(fallback);
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

const lineOf = (def: "proposal" | "interest", p: Params) =>
  def === "proposal" ? `${clean(p.tribe, "A tribe")} could suit you. Nothing is decided for you.` : "A new group is being put together. Would it suit you?";

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

export const DESK_TEMPLATES: TemplateDef[] = [deskProposal, deskInterest];

/** Believable fields as the database supplies them (desk_tribe_params and desk_interest_params). Used by the tests and the template list. */
export const DESK_SAMPLES: Record<string, Params> = { ...DESK_EMAIL_SAMPLES } as unknown as Record<string, Params>;
