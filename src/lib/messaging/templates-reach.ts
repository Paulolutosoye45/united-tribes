import { flat, smsLine, str } from "./format";
import type { Context, Params, TemplateDef } from "./types";

/**
 * The one message behind the leader's "Ask them to add it" button and the office's ask (Contact gaps). It is email only: it is never put to Meta
 * for approval, and the database only ever queues it as email.
 *
 * Rules the wording keeps, and the tests check:
 *   - it comes from the church office and names the leader by first name, because it is the leader who asked
 *   - it says in one plain sentence who can see a number (the tribe's leader, their assistant and the person's coach, and only if WhatsApp is
 *     ticked) and that other members never do
 *   - it says the choice is theirs, that nothing changes unless they change it, and that they can change or remove it any time
 *   - it never says the person did something wrong, never names another member, and never carries a number
 *   - one idea and one main button, to the person's profile; a subject that fits on a phone's lock screen
 */

const clean = (v: unknown, fallback = "") => str(v).replace(/\s+/g, " ").trim() || fallback;
const leaderOf = (p: Params) => clean(p.leader_first, "Your leader").slice(0, 30).trim();

export type ReachKind = "no_number" | "no_yes";
const kindOf = (p: Params): ReachKind => (p.kind === "no_yes" ? "no_yes" : "no_number");

const PATH = "/profile";

const askLeader: TemplateDef = {
  key: "contact_ask_leader",
  audience: "member",
  title: "A member is asked, by email, to add a number or to say yes to WhatsApp",
  emailOnly: true,
  email: (p, c) => {
    const leader = leaderOf(p);
    const noYes = kindOf(p) === "no_yes";
    return {
      subject: noYes ? `${leader} cannot see your number yet` : `${leader} would like to reach you`,
      greeting: `Hi ${c.first},`,
      paragraphs: noYes
        ? [
            `${leader} leads your tribe. Thank you for adding your number. ${leader} cannot see it yet, because WhatsApp is not ticked on your profile.`,
            "If you are happy for your leader to message you on WhatsApp, tick it. Only your tribe’s leader, their assistant and your coach can see your number, and only then. Other members never see it.",
            "If you would rather be reached another way, leave it as it is. Nothing changes unless you change it, and you can change it any time.",
          ]
        : [
            `${leader} leads your tribe and would like to be able to message you. We do not have a phone number for you yet, so for now they can only reach you by email.`,
            "If you are happy to, add one on your profile and say whether WhatsApp is fine. Only your tribe’s leader, their assistant and your coach can see it, and only if you tick WhatsApp. Other members never see it.",
            "It is entirely your choice, and you can change or remove it any time. If you would rather not, you do not need to do anything.",
          ],
      cta: { label: "Choose how I am reached", url: c.link(PATH) },
    };
  },
  sms: (p, c) => smsLine(`United Tribes: ${leaderOf(p)} would like to reach you. Add a number if you are happy to.`, c.link(PATH)),
  whatsapp: (p, c: Context) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
    example: ["Ada", "Your leader would like to reach you. Add a number if you are happy to.", c.link(PATH)],
    vars: [flat(c.first), flat(`${leaderOf(p)} would like to reach you. Add a number if you are happy to.`), flat(c.link(PATH))],
  }),
};

export const REACH_TEMPLATES: TemplateDef[] = [askLeader];

/** Believable fields for the template, as the database supplies them (contact_ask_send). Used by the tests. */
export const REACH_SAMPLES: Record<string, Params> = {
  contact_ask_leader: { leader_first: "Grace", kind: "no_number" },
};
