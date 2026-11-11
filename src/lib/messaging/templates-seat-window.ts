import { SEAT_SUBJECT_MAX, lagosWhen } from "@/lib/seat/seat";
import { flat, meetsText, smsLine, str } from "./format";
import type { Context, EmailContent, Params, TemplateDef } from "./types";

/**
 * The three emails of the seat window (Package 6), sent to a member the church placed who has not answered. All are email only: they are never put to Meta for
 * approval, and the database only ever queues them as email. They come from the church office.
 *
 *   seat_reminder    hour 24: "Your seat is held until …", one tap to say yes
 *   seat_last_call   hour 40: the last email before the seat is offered to someone else, plain, no threat
 *   seat_released    after the deadline: kind, "you did nothing wrong", and the way back while the seat is still free
 *
 * Package 7 adds two more, on the same rules:
 *   reach_released   the end of the six-day contact series, for a member who did nothing: the same kindness and the same way back
 *   leader_seat_note the leader's one note a day, at 5 pm, and only on a day something changed: counts, and the first names of those who said yes. Never the
 *                    name of anyone who was released or who left, and never a reason.
 *
 * Rules the wording keeps, and the tests check:
 *   - it never says the person did something wrong, never says whether they opened a page (a mail scanner can open a link), and never names another member
 *   - it carries no phone number, no faith journey, support need, score or age
 *   - the reminder and the last call ask the member to look in Promotions or Spam, because a seat is only released when the email had every chance to arrive
 *   - the deadline is written in Lagos time, with the day and the hour, and is the real one: the database sends it, the wording never works it out
 *   - one main button and a subject that fits a phone's lock screen (60 characters)
 *   - an email the office sends to itself to test ("sample") says so in the subject, and is addressed to nobody else
 */

const clean = (v: unknown, fallback = "") => str(v).replace(/\s+/g, " ").trim() || fallback;
const leaderOf = (p: Params) => clean(p.leader_first, "your leader").slice(0, 30).trim();
const tribeOf = (p: Params) => clean(p.tribe, "your tribe");
const tagged = (p: Params, subject: string) => (p.sample === true ? `[Test] ${subject}`.slice(0, SEAT_SUBJECT_MAX + 7) : subject);
const fit = (...choices: string[]): string => choices.find((s) => s.length <= SEAT_SUBJECT_MAX) ?? choices[choices.length - 1].slice(0, SEAT_SUBJECT_MAX).trim();

/** The secret in the private link: the message's own, else the one in its reply link. Null when there is none. */
function secretOf(c: Context): string | null {
  if (c.token && /^[a-f0-9]{64}$/.test(c.token)) return c.token;
  const m = /\/r\/([a-f0-9]{64})/.exec(c.reply("done") ?? "");
  return m ? m[1] : null;
}
/** A link to the member's private page about the seat they hold, with one answer ready (opening it changes nothing). */
function placedLink(c: Context, action: "confirm" | "change"): string {
  const secret = secretOf(c);
  return secret ? `${c.site}/placed/${secret}?a=${action}` : c.link("/tribe");
}
const seatLink = (c: Context): string => {
  const secret = secretOf(c);
  return secret ? `${c.site}/seat/${secret}` : c.link("/tribe");
};
const when = (p: Params): string => lagosWhen(p.deadline_at) || "the end of the day after tomorrow";
const SPAM = "If this landed in Promotions or Spam, please move it to your inbox, so the next one reaches you.";

function reminderEmail(p: Params, c: Context): EmailContent {
  const tribe = tribeOf(p);
  return {
    subject: tagged(p, fit(`${c.first}, your seat in ${tribe} is held`, "Your seat is held for you")),
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `The church placed you in ${tribe}, led by ${leaderOf(p)}. We have not heard from you yet, and your seat is held until ${when(p)}.`,
      `It meets ${meetsText(p)}.`,
      "If you want it, one tap tells us you are in. If the time or the place does not suit you, you can look at other tribes instead.",
      SPAM,
    ],
    cta: { label: "Yes, I’m in", url: placedLink(c, "confirm") },
    options: [{ label: "Show me other tribes", url: placedLink(c, "change") }],
    signoff: ["The church office", "United Tribes"],
  };
}

function lastCallEmail(p: Params, c: Context): EmailContent {
  const tribe = tribeOf(p);
  const days = typeof p.take_back_days === "number" ? Math.floor(p.take_back_days) : 0;
  return {
    subject: tagged(p, fit(`Last call: your seat in ${tribe}`, "Last call for your seat")),
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `This is the last email about your seat in ${tribe}. It is held until ${when(p)}.`,
      "After that, we offer the seat to someone else, so that every tribe keeps moving. If you want it, press the button now. If you cannot join this season, that is fine too, and you do not need to do anything.",
      days > 0 ? `If the seat is released and is still free, you can take it back for ${days} ${days === 1 ? "day" : "days"}.` : "",
      `${leaderOf(p)} leads ${tribe}, which meets ${meetsText(p)}.`,
      SPAM,
    ].filter(Boolean),
    cta: { label: "Yes, I’m in", url: placedLink(c, "confirm") },
    options: [{ label: "Show me other tribes", url: placedLink(c, "change") }],
    signoff: ["The church office", "United Tribes"],
  };
}

function releasedEmail(p: Params, c: Context): EmailContent {
  const tribe = tribeOf(p);
  const days = typeof p.take_back_days === "number" ? Math.floor(p.take_back_days) : 0;
  const can = days > 0;
  return {
    subject: tagged(p, fit(`${c.first}, your seat in ${tribe} has been offered on`, "Your seat has been offered to someone else")),
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `We could not hear back about your seat in ${tribe} in time, so we have offered it to someone else. You did nothing wrong. We try to keep every tribe moving.`,
      can
        ? `If you still want it and it is still free, you can take it back for ${days} ${days === 1 ? "day" : "days"}. If it has gone, you are first in line for the next place that opens.`
        : "If you would still like a tribe this season, sign in and look at the ones that are open.",
      "If you would like to talk it over, reply to this email or ask the church office. We would love to help you find a place.",
    ],
    cta: can ? { label: "Take my seat back", url: seatLink(c) } : { label: "Look at the open tribes", url: c.link("/tribe") },
    options: can ? [{ label: "Look at other tribes", url: c.link("/tribe") }] : undefined,
    signoff: ["The church office", "United Tribes"],
  };
}

function reachReleasedEmail(p: Params, c: Context): EmailContent {
  const tribe = tribeOf(p);
  const days = typeof p.take_back_days === "number" ? Math.floor(p.take_back_days) : 0;
  const emails = typeof p.emails === "number" && p.emails > 0 ? Math.floor(p.emails) : 0;
  const can = days > 0;
  return {
    subject: tagged(p, fit(`${c.first}, your seat in ${tribe} has been offered on`, "Your seat has been offered to someone else")),
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${emails > 0 ? `We wrote to you ${emails} times over six days` : "We wrote to you over six days"} so that your leader can reach you, and we could not hear back, so we have offered your seat in ${tribe} to someone else. You did nothing wrong. A tribe works when its leader can reach everyone in it, and we try to keep every tribe moving.`,
      can
        ? `If you still want it and it is still free, you can take it back for ${days} ${days === 1 ? "day" : "days"}. If it has gone, you are first in line for the next place that opens.`
        : "If you would still like a tribe this season, sign in and look at the ones that are open.",
      "If you would like to talk it over, reply to this email or ask the church office. We would love to help you find a place.",
    ],
    cta: can ? { label: "Take my seat back", url: seatLink(c) } : { label: "Look at the open tribes", url: c.link("/tribe") },
    options: can ? [{ label: "Look at other tribes", url: c.link("/tribe") }] : undefined,
    signoff: ["The church office", "United Tribes"],
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
const joinNames = (v: unknown): string => {
  const names = (Array.isArray(v) ? v : []).map((x) => clean(x).slice(0, 30)).filter(Boolean).slice(0, 4);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/** What happened in a tribe today, as short lines. Only counts and the first names of those who said yes. */
export function leaderNoteLines(p: Params): string[] {
  const yes = num(p.yes_n);
  const opened = num(p.no_reply_n) + num(p.series_n) + num(p.left_n);
  const out: string[] = [];
  if (yes > 0) out.push(joinNames(p.yes_names) && yes <= 4 ? `${joinNames(p.yes_names)} said yes.` : `${many(yes, "member said", "members said")} yes.`);
  if (opened > 0) {
    const why = [
      num(p.no_reply_n) > 0 ? `${num(p.no_reply_n)} did not reply in time` : "",
      num(p.series_n) > 0 ? `${num(p.series_n)} could not be reached after the contact emails` : "",
      num(p.left_n) > 0 ? `${num(p.left_n)} chose to leave` : "",
    ].filter(Boolean);
    out.push(`${many(opened, "seat opened", "seats opened")}: ${why.join(", ")}.`);
  }
  if (num(p.replaced_n) > 0) out.push(`${many(num(p.replaced_n), "place was", "places were")} offered to the next person in line.`);
  if (num(p.numbers_n) > 0) out.push(`${many(num(p.numbers_n), "member", "members")} added their contact details.`);
  if (num(p.waiting_n) > 0) out.push(`${many(num(p.waiting_n), "seat is", "seats are")} still waiting for a yes.`);
  out.push(num(p.open_n) > 0 ? `You have ${many(num(p.open_n), "free seat", "free seats")}.` : "Your tribe is full.");
  return out;
}

function leaderNoteEmail(p: Params, c: Context): EmailContent {
  const tribe = tribeOf(p);
  const yes = num(p.yes_n);
  const opened = num(p.no_reply_n) + num(p.series_n) + num(p.left_n);
  const bits = [yes > 0 ? `${yes} said yes` : "", opened > 0 ? many(opened, "seat opened", "seats opened") : ""].filter(Boolean).join(", ");
  return {
    subject: tagged(p, fit(`${tribe}: ${bits || "today’s seats"}`, `Today in ${tribe}`, "Today in your tribe")),
    greeting: `Hi ${c.first},`,
    paragraphs: [`Here is what changed in ${tribe} today.`, ...leaderNoteLines(p), "This is the only note about seats you will get today."],
    cta: { label: "Open my Tribe Card", url: c.link("/lead/tribe") },
    signoff: ["The church office", "United Tribes"],
  };
}

const noteLine = (p: Params) => `${tribeOf(p)}: ${leaderNoteLines(p).slice(0, 2).join(" ")}`;

const line = (p: Params) => `${tribeOf(p)}: your seat is held until ${when(p)}.`;
const releasedLine = (p: Params) => `${tribeOf(p)}: your seat has been offered to someone else. You did nothing wrong.`;
function makeDef(key: string, title: string, email: (p: Params, c: Context) => EmailContent, cta: (c: Context) => string, say: (p: Params) => string = line): TemplateDef {
  return {
    key,
    audience: "member",
    title,
    emailOnly: true,
    email,
    sms: (p, c) => smsLine(`United Tribes: ${say(p)}`, cta(c)),
    whatsapp: (p, c) => ({
      body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
      example: ["Ada", "Builders Tribe: your seat is held until Thursday 12 November, 9 am.", cta(c)],
      vars: [flat(c.first), flat(say(p)), flat(cta(c))],
    }),
  };
}

const leaderNote: TemplateDef = {
  key: "leader_seat_note",
  audience: "leader",
  title: "A leader is told, once a day at 5 pm and only on a day something changed, how the seats in their tribe moved (the seat window)",
  emailOnly: true,
  email: leaderNoteEmail,
  sms: (p, c) => smsLine(`United Tribes: ${noteLine(p)}`, c.link("/lead/tribe")),
  whatsapp: (p, c) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
    example: ["Ngozi", "Builders Tribe: Ada said yes. 1 seat is still waiting for a yes.", c.link("/lead/tribe")],
    vars: [flat(c.first), flat(noteLine(p)), flat(c.link("/lead/tribe"))],
  }),
};

export const SEAT_WINDOW_TEMPLATES: TemplateDef[] = [
  makeDef("seat_reminder", "A placed member who has not answered is reminded, 24 hours in, that the seat is held for them (the seat window)", reminderEmail, (c) => placedLink(c, "confirm")),
  makeDef("seat_last_call", "A placed member who has not answered is told, 40 hours in, that this is the last email before the seat is offered on (the seat window)", lastCallEmail, (c) => placedLink(c, "confirm")),
  makeDef("seat_released", "A member whose seat was offered to someone else is told kindly, and given the way back (the seat window)", releasedEmail, seatLink, releasedLine),
  makeDef("reach_released", "A member who did nothing in the six-day contact series is told kindly that the seat was offered on, and given the way back", reachReleasedEmail, seatLink, releasedLine),
  leaderNote,
];

/** Believable fields as the database supplies them (placement_member_params plus the seat window's own). Used by the tests and the template list. */
const BASE: Params = {
  tribe: "Builders Tribe",
  leader_first: "Ngozi",
  assistant_first: "Dayo",
  meeting_day: 3,
  meeting_time: "20:00",
  mode: "online",
  place_note: "",
  starts_on: "2027-02-14",
  season: "Season 1",
  deadline_at: "2026-11-12T08:00:00+00:00",
  take_back_days: 7,
};
export const SEAT_WINDOW_SAMPLES: Record<string, Params> = {
  seat_reminder: { ...BASE },
  seat_last_call: { ...BASE },
  seat_released: { ...BASE },
  reach_released: { ...BASE, emails: 4 },
  leader_seat_note: { tribe: "Builders Tribe", yes_n: 2, yes_names: ["Ada", "Tunde"], no_reply_n: 1, series_n: 0, left_n: 1, replaced_n: 1, numbers_n: 1, waiting_n: 3, open_n: 2 },
};
