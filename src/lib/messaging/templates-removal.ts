import { flat, num, smsLine, str } from "./format";
import type { Context, EmailContent, Params, TemplateDef } from "./types";

/**
 * The three messages behind leader removal requests. All of them are email only: they are never put to Meta for approval, and the database only ever
 * queues them as email (the church does not use WhatsApp to tell anyone about a change to their place).
 *
 * Rules the wording keeps, and the tests check:
 *   - the member is told kindly that their place has changed, which tribe, that other tribes are open to them, and the first name of the person to
 *     speak to. They are never told the reason, the leader's note, who asked or who decided, and never in a way that sounds like a judgement
 *   - a member who declined to be removed is told nothing (there is no message for a declined request), and a young person is never written to
 *     by this message: the Care Lead speaks to their parent or guardian
 *   - the leader is told what was decided (approved, declined, a question for them, or the seat put back), by the member's first name only, with a
 *     button to their tribe page, where the words of the person who decided are. The reminder to take the person out of any WhatsApp group the leader
 *     keeps outside this site goes only in the "approved" message and in "removed" (the office took the place itself, from Admin)
 *   - one idea and one main button; a subject that fits on a phone's lock screen
 */

const clean = (v: unknown, fallback = "") => str(v).replace(/\s+/g, " ").trim() || fallback;
const short = (v: unknown, fallback: string, max = 40) => clean(v, fallback).slice(0, max).trim();

type Spec = {
  key: string;
  audience: TemplateDef["audience"];
  title: string;
  subject: (p: Params) => string;
  email: (p: Params, c: Context) => Omit<EmailContent, "subject" | "greeting">;
  /** One line for a text message or a WhatsApp variable, and the page it points to. */
  line: (p: Params) => string;
  path: string;
};

function build(s: Spec): TemplateDef {
  return {
    key: s.key,
    audience: s.audience,
    title: s.title,
    emailOnly: true,
    email: (p, c) => ({ subject: s.subject(p), greeting: `Hi ${c.first},`, ...s.email(p, c) }),
    sms: (p, c) => smsLine(`United Tribes: ${s.line(p)}`, c.link(s.path)),
    whatsapp: (p, c) => ({
      body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
      example: ["Ada", s.line({ tribe: "Builders Tribe", member_first: "Bola" }), c.link(s.path)],
      vars: [flat(c.first), flat(s.line(p)), flat(c.link(s.path))],
    }),
  };
}

// ---------------------------------------------------------------------------
// The member
// ---------------------------------------------------------------------------

const memberTold = build({
  key: "removal_member_told",
  audience: "member",
  title: "A member is told their place in a tribe has changed",
  subject: (p) => `Your place in ${short(p.tribe, "your tribe")} has changed`,
  email: (p, c) => {
    const tribe = short(p.tribe, "your tribe", 60);
    const contact = short(p.contact_first, "the Care Team", 30);
    // A place the office changed has no appeal to offer; the database says so with a 0. Anything else (including nothing at all) keeps the 14 days.
    const given = p.appeal_days === undefined || p.appeal_days === null ? 14 : num(p.appeal_days, 14);
    const noAppeal = given <= 0;
    const days = Math.max(1, Math.round(given));
    return {
      paragraphs: [
        `Your place in ${tribe} has changed. The church’s leaders looked at this carefully before it was decided, and you are still very much part of this church family.`,
        "You do not lose anything by this. What you have shared with us, and everything you have taken part in, is just as you left it.",
        "Other tribes are open to you, and we would love you to be in one. The button below shows the tribes that fit you best.",
        noAppeal
          ? `If you would like to talk about it, ${contact} is the person to speak to.`
          : `If you would like to talk about it, ${contact} is the person to speak to. If you feel a mistake has been made, you can ask ${contact} to look at it again, from the same page, within ${days} days.`,
      ],
      cta: { label: "See other tribes", url: c.link("/tribe") },
    };
  },
  line: (p) => `your place in ${short(p.tribe, "your tribe")} has changed, and other tribes are open to you.`,
  path: "/tribe",
});

const memberReinstated = build({
  key: "removal_member_reinstated",
  audience: "member",
  title: "A member is told their place in a tribe has been put back",
  subject: (p) => `Your place in ${short(p.tribe, "your tribe")} is back`,
  email: (p, c) => ({
    paragraphs: [
      `The church has looked again, and your place in ${short(p.tribe, "your tribe", 60)} has been put back. You are welcome there, and your leader knows.`,
      "Thank you for your patience while this was looked at. Everything you had shared is as it was.",
    ],
    cta: { label: "Open my tribe", url: c.link("/tribe") },
  }),
  line: (p) => `your place in ${short(p.tribe, "your tribe")} has been put back.`,
  path: "/tribe",
});

// ---------------------------------------------------------------------------
// The leader
// ---------------------------------------------------------------------------

const decisionOf = (p: Params): "approved" | "declined" | "question" | "reinstated" | "removed" => {
  const d = str(p.decision);
  return d === "approved" || d === "declined" || d === "question" || d === "reinstated" || d === "removed" ? d : "question";
};

const leaderDecided = build({
  key: "removal_leader_decided",
  audience: "leader",
  title: "A leader is told what was decided about their request",
  subject: (p) => {
    const who = short(p.member_first, "your member", 30);
    switch (decisionOf(p)) {
      case "approved": return `Your request about ${who} was approved`;
      case "declined": return `Your request about ${who} was not approved`;
      case "reinstated": return `${who} is back in your tribe`;
      case "removed": return `${who}’s place in your tribe has changed`;
      default: return `A question about your request for ${who}`;
    }
  },
  email: (p, c) => {
    const who = short(p.member_first, "your member", 30);
    const tribe = short(p.tribe, "your tribe", 60);
    const path = "/lead/tribe";
    switch (decisionOf(p)) {
      case "approved":
        return {
          paragraphs: [
            `The church has approved your request about ${who} in ${tribe}. Their place in the tribe has been released, and they have been told kindly and offered other tribes.`,
            "If you keep a WhatsApp group for the tribe outside this site, please take them out of it yourself. We cannot do that for you, and they should not be left in a group they are no longer part of.",
            "Please do not talk about the reason with the tribe. If someone asks, tell them it was a decision of the church and leave it there.",
          ],
          cta: { label: "Open my tribe", url: c.link(path) },
        };
      case "removed":
        return {
          paragraphs: [
            `The church has changed ${who}’s place in ${tribe}. Their place in the tribe has been released, and they have been told kindly and offered other tribes.`,
            "If you keep a WhatsApp group for the tribe outside this site, please take them out of it yourself. We cannot do that for you, and they should not be left in a group they are no longer part of.",
            "Please do not talk about it with the tribe. If someone asks, tell them it was a decision of the church and leave it there.",
          ],
          cta: { label: "Open my tribe", url: c.link(path) },
        };
      case "declined":
        return {
          paragraphs: [
            `The church has looked at your request about ${who} in ${tribe} and has asked that they stay in the tribe. ${who} has not been told anything about it.`,
            "The words of the person who looked at it are on your tribe page. Please keep walking with them. If things change, you can ask again.",
          ],
          cta: { label: "Read the answer", url: c.link(path) },
        };
      case "reinstated":
        return {
          paragraphs: [
            `After looking at it again, the church has put ${who}’s place in ${tribe} back. ${who} has been told.`,
            "Please welcome them back warmly, and keep the reason between you and the people who decided.",
          ],
          cta: { label: "Open my tribe", url: c.link(path) },
        };
      default:
        return {
          paragraphs: [
            `The person looking at your request about ${who} in ${tribe} has a question for you.`,
            "Please answer it on your tribe page. Nothing happens to the member while you do, and nothing is decided until you have.",
          ],
          cta: { label: "Answer the question", url: c.link(path) },
        };
    }
  },
  line: (p) => {
    const who = short(p.member_first, "your member", 30);
    switch (decisionOf(p)) {
      case "approved": return `your request about ${who} was approved.`;
      case "declined": return `your request about ${who} was not approved.`;
      case "reinstated": return `${who} is back in your tribe.`;
      case "removed": return `${who}’s place in your tribe has changed.`;
      default: return `there is a question about your request for ${who}.`;
    }
  },
  path: "/lead/tribe",
});

export const REMOVAL_TEMPLATES: TemplateDef[] = [memberTold, leaderDecided, memberReinstated];

/** Believable fields for the templates, as the database supplies them. Used by the tests. */
export const REMOVAL_SAMPLES: Record<string, Params> = {
  removal_member_told: { tribe: "Builders Tribe", contact_first: "Grace", appeal_days: 14 },
  removal_leader_decided: { decision: "approved", member_first: "Bola", tribe: "Builders Tribe" },
  removal_member_reinstated: { tribe: "Builders Tribe" },
};
