import { flat, smsLine, str } from "./format";
import type { Context, Params, TemplateDef } from "./types";

/**
 * The one email behind "Send the email again" and the Thursday, Friday and Saturday reminders on the Leader cards board. It is email only: it is
 * never put to Meta for approval, and the database only ever queues it as email.
 *
 * Rules the wording keeps, and the tests check:
 *   - it comes from the church office, is kind, and never says the leader did something wrong or is late; there is no deadline in it that the
 *     church has not set
 *   - it says in one plain sentence where the card is (not started, started, sent back with changes asked for) and what the one next step is
 *   - it says a pastor reviews the card before members can see the tribe, which is true and is the reason for it
 *   - the button opens the leader's own Tribe Card page, and signing in is the whole proof; there is no link that works as a key
 *   - "again" is for a leader whose first email may not have arrived: it says so, once, and says how they came to be a leader (appointed or approved)
 *   - Thursday, Friday and Saturday say the same thing in three tones; they are the only difference
 */

const clean = (v: unknown, fallback = "") => str(v).replace(/\s+/g, " ").trim() || fallback;

export type CardState = "not_started" | "in_progress" | "changes_asked";
const stateOf = (p: Params): CardState => (p.state === "in_progress" || p.state === "changes_asked" ? p.state : "not_started");

export type CardKind = "again" | "thursday" | "friday" | "saturday" | "weekly";
const kindOf = (p: Params): CardKind =>
  p.kind === "again" || p.kind === "thursday" || p.kind === "friday" || p.kind === "saturday" ? p.kind : "weekly";

const tribeOf = (p: Params) => clean(p.tribe).slice(0, 60);
const PATH = "/lead/tribe";

/** Where the card is, in one sentence. */
const where = (state: CardState) =>
  state === "changes_asked"
    ? "The pastorate has asked for a few changes to your Tribe Card. Open it to see what they said, make the changes and send it in again."
    : state === "in_progress"
      ? "You have started your Tribe Card. A few things are still to fill in before you can send it in."
      : "You have not started your Tribe Card yet. Part of it is already filled in for you, so you are not starting from nothing.";

const WHY = "A pastor reviews your card before members can see your tribe, so sending it in is what opens the door for them.";

const subjectFor = (kind: CardKind, state: CardState) => {
  if (kind === "again") return "Your Tribe Card link, again";
  if (state === "changes_asked") return "Your Tribe Card needs a few changes";
  if (kind === "thursday") return "Your Tribe Card is waiting for you";
  if (kind === "friday") return "A quiet nudge about your Tribe Card";
  if (kind === "saturday") return "Your Tribe Card, before the week ends";
  return "Your Tribe Card is waiting for you";
};

const opener = (kind: CardKind, p: Params) => {
  const tribe = tribeOf(p);
  if (kind === "again") {
    const how = p.how === "applied"
      ? "Your application to lead was approved, and your Tribe Card is ready for you."
      : `The church has appointed you to lead${tribe ? ` ${tribe}` : " a tribe"}, and your Tribe Card is ready for you.`;
    return `${how} In case our first email did not reach you, here is the way in again: sign in with this email address.`;
  }
  if (kind === "friday") return "A short note from the church office, in case this week has been full.";
  if (kind === "saturday") return "One last note from the church office before the weekend ends.";
  return "A short note from the church office about your Tribe Card.";
};

const leaderCardReminder: TemplateDef = {
  key: "leader_card_reminder",
  audience: "leader",
  title: "A leader is reminded, by email, that their Tribe Card is waiting",
  emailOnly: true,
  email: (p, c) => {
    const kind = kindOf(p);
    const state = stateOf(p);
    return {
      subject: subjectFor(kind, state),
      greeting: `Hi ${c.first},`,
      paragraphs: [
        opener(kind, p),
        where(state),
        WHY,
        "If something is in the way, tell the church office and we will help you with it.",
      ],
      cta: { label: state === "changes_asked" ? "See what to change" : "Open my Tribe Card", url: c.link(PATH) },
    };
  },
  sms: (p, c) => smsLine("United Tribes: your Tribe Card is waiting for you.", c.link(PATH)),
  whatsapp: (p, c: Context) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
    example: ["Ada", "Your Tribe Card is waiting for you.", c.link(PATH)],
    vars: [flat(c.first), flat("Your Tribe Card is waiting for you."), flat(c.link(PATH))],
  }),
};

export const LEADER_CARD_TEMPLATES: TemplateDef[] = [leaderCardReminder];

/** Believable fields for the template, as the database supplies them (leader_card_reminders_run, leader_cards_resend). Used by the tests. */
export const LEADER_CARD_SAMPLES: Record<string, Params> = {
  leader_card_reminder: { tribe: "Ada’s Business and entrepreneurship tribe", state: "not_started", kind: "thursday", how: "appointed" },
};
