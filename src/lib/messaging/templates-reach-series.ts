import { flat, smsLine, str } from "./format";
import type { Context, Params, TemplateDef } from "./types";

/**
 * The messages behind the contact series and the tribe note (seats and contacts, Package 5). All three are email only: they are never put to Meta
 * for approval, and the database only ever queues them as email.
 *
 * The series is four emails over six days to a member whose tribe leader cannot message them on WhatsApp (no number saved, or a number without the
 * yes). Emails 1 and 3 speak as the leader (the church sends them, in the leader’s name, and quotes the leader’s own line in email 1); emails 2 and
 * 4 are the church’s. Each carries one private link that is only that person’s.
 *
 * Rules the wording keeps, and the tests check:
 *   - it never says the person did something wrong, never names another member, and never carries a number (the page shows a number with its middle hidden)
 *   - it says in one plain sentence who can see a number (the tribe’s leader, their assistant and the person’s coach, and only if WhatsApp is ticked) and
 *     that other members never do
 *   - it says the choice is theirs, and gives the way out in the email itself: “Email me instead” is on the page every email opens
 *   - one idea and one main button; a subject that fits on a phone’s lock screen
 *   - email 4 is plain: it says it is the last, and it never threatens. While the end of the series does nothing (release_on is false) it says nothing about
 *     what happens at the end
 */

const clean = (v: unknown, fallback = "") => str(v).replace(/\s+/g, " ").trim() || fallback;
const leaderOf = (p: Params) => clean(p.leader_first, "Your leader").slice(0, 30).trim();
const tribeOf = (p: Params) => clean(p.tribe).slice(0, 60);

export type SeriesKind = "no_number" | "no_yes";
const kindOf = (p: Params): SeriesKind => (p.kind === "no_yes" ? "no_yes" : "no_number");
const nOf = (p: Params): 1 | 2 | 3 | 4 => {
  const n = Math.floor(Number(p.n));
  return n === 2 || n === 3 || n === 4 ? n : 1;
};

/** The private page behind the message, when the message carries its link; the signed-in profile otherwise (the link is forgotten some time after it is used). */
const pageOf = (c: Context): string => (c.token && /^[a-f0-9]{64}$/.test(c.token) ? c.link(`/add-number/${c.token}`) : c.link("/profile"));

const WHO_SEES =
  "Only your tribe’s leader, their assistant and your coach can see your number, and only if you tick WhatsApp. Other members never see it.";
const CHOICE = "It is your choice. If you would rather be emailed, there is a button for that on the same page, and we will leave it there.";

const series: TemplateDef = {
  key: "reach_series",
  audience: "member",
  title: "A member is asked, by email, to add a WhatsApp number or to say yes to WhatsApp (the four-email series)",
  emailOnly: true,
  email: (p, c) => {
    const leader = leaderOf(p);
    const tribe = tribeOf(p);
    const noYes = kindOf(p) === "no_yes";
    const n = nOf(p);
    const line = clean(p.line).slice(0, 200);
    const label = noYes ? "Tick WhatsApp" : "Add my number";
    const url = pageOf(c);

    // What is missing, said once, in the voice of whoever is writing
    const missing = noYes
      ? `${leader} cannot use the number you gave us yet, because WhatsApp is not ticked.`
      : `${leader} cannot message you on WhatsApp yet, because we have no number for you.`;

    if (n === 1) {
      return {
        subject: noYes ? `${leader} cannot use your number yet` : `${leader} would like to message you on WhatsApp`,
        greeting: `Hi ${c.first},`,
        paragraphs: [
          `${leader} leads ${tribe || "your tribe"}. ${missing}${p.has_group === true && tribe ? ` ${tribe} keeps in touch on WhatsApp.` : ""}`,
          noYes ? "It takes a few seconds: one tick." : "It takes about a minute: your number and one tick.",
          WHO_SEES,
          CHOICE,
          // The quote is drawn after the paragraphs, so this line sits right above it
          ...(line ? [`${leader} adds:`] : []),
        ],
        ...(line ? { quote: line } : {}),
        cta: { label, url },
        signoff: [leader, tribe || "Your tribe"],
      };
    }
    if (n === 2) {
      return {
        subject: noYes ? "One tick left" : "A quick reminder from United Tribes",
        greeting: `Hi ${c.first},`,
        paragraphs: [
          `A few days ago ${leader} asked you to ${noYes ? "tick WhatsApp" : "add your WhatsApp number"}. In case it got buried: ${missing}`,
          noYes ? "It takes a few seconds." : "It takes about a minute, and the link below is only yours.",
          WHO_SEES,
          CHOICE,
        ],
        cta: { label, url },
      };
    }
    if (n === 3) {
      return {
        subject: `${leader} is still hoping to reach you`,
        greeting: `Hi ${c.first},`,
        paragraphs: [
          `${leader} would still like to be able to message you on WhatsApp. ${missing}`,
          "You do not need to sign in. Open the link, and it is done in a minute.",
          WHO_SEES,
          CHOICE,
        ],
        cta: { label, url },
        signoff: [leader, tribe || "Your tribe"],
      };
    }
    return {
      subject: "The last reminder about your WhatsApp number",
      greeting: `Hi ${c.first},`,
      paragraphs: [
        `This is the last of four emails about this. ${missing}`,
        noYes ? "If you are happy for them to message you on WhatsApp, tick it. If not, you can leave it as it is." : "If you are happy to be reached on WhatsApp, add your number. If not, you can leave it as it is.",
        WHO_SEES,
        "If you would rather be emailed, press “Email me instead” on the page. We will not ask again this season.",
      ],
      cta: { label, url },
      options: [{ label: "Email me instead", url }],
    };
  },
  sms: (p, c) => smsLine(`United Tribes: ${leaderOf(p)} would like to message you on WhatsApp. Add your number if you are happy to.`, pageOf(c)),
  whatsapp: (p, c: Context) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
    example: ["Ada", "Your leader would like to message you on WhatsApp. Add your number if you are happy to.", pageOf(c)],
    vars: [flat(c.first), flat(`${leaderOf(p)} would like to message you on WhatsApp. Add your number if you are happy to.`), flat(pageOf(c))],
  }),
};

const newLink: TemplateDef = {
  key: "reach_new_link",
  audience: "member",
  title: "A member whose link ran out is sent a new one",
  emailOnly: true,
  email: (p, c) => ({
    subject: "Your new link",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `Here is a fresh link to ${leaderOf(p) ? `let ${leaderOf(p)} reach you on WhatsApp` : "add your WhatsApp number"}. It works for thirty days, and it is only yours.`,
      WHO_SEES,
    ],
    cta: { label: "Add my number", url: pageOf(c) },
  }),
  sms: (p, c) => smsLine("United Tribes: here is your new link to add your WhatsApp number.", pageOf(c)),
  whatsapp: (p, c: Context) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
    example: ["Ada", "Here is your new link to add your WhatsApp number.", pageOf(c)],
    vars: [flat(c.first), flat("Here is your new link to add your WhatsApp number."), flat(pageOf(c))],
  }),
};

const note: TemplateDef = {
  key: "tribe_note",
  audience: "member",
  title: "A note from a tribe’s leader to the whole tribe, by email",
  emailOnly: true,
  email: (p, c) => {
    const leader = leaderOf(p);
    const tribe = tribeOf(p);
    // The leader’s words, as they wrote them: a paragraph for each line. Nothing is added to them but a sign-off.
    const body = str(p.body)
      .split(/\r?\n+/)
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 12);
    const gap = p.gap === "no_number" || p.gap === "no_yes" ? p.gap : null;
    return {
      subject: tribe ? `A note from ${leader} (${tribe})` : `A note from ${leader}`,
      greeting: `Hi ${c.first},`,
      paragraphs: [
        ...(body.length > 0 ? body : [`${leader} has sent your tribe a note.`]),
        ...(gap
          ? [
              gap === "no_yes"
                ? `${leader} cannot use your number on WhatsApp yet, because WhatsApp is not ticked. If you are happy for them to message you there, it takes a few seconds.`
                : `${leader} cannot message you on WhatsApp yet, because we have no number for you. If you are happy to add one, it takes about a minute.`,
              WHO_SEES,
            ]
          : []),
      ],
      ...(gap ? { cta: { label: gap === "no_yes" ? "Tick WhatsApp" : "Add my number", url: pageOf(c) } } : {}),
      signoff: [leader, tribe || "Your tribe"],
    };
  },
  sms: (p, c) => smsLine(`United Tribes: a note from ${leaderOf(p)}. Open your email to read it.`, c.link("/tribe")),
  whatsapp: (p, c: Context) => ({
    body: "Hi {{1}}, a note from United Tribes: {{2}} You can open your tribe here: {{3}}",
    example: ["Ada", "Your leader has sent your tribe a note. Please check your email.", c.link("/tribe")],
    vars: [flat(c.first), flat(`${leaderOf(p)} has sent your tribe a note. Please check your email.`), flat(c.link("/tribe"))],
  }),
};

export const REACH_SERIES_TEMPLATES: TemplateDef[] = [series, newLink, note];

/** Believable fields for the templates, as the database supplies them (reach_send, worker_reach_new_link, tribe_note_send). Used by the tests. */
export const REACH_SERIES_SAMPLES: Record<string, Params> = {
  reach_series: { n: 1, kind: "no_number", leader_first: "Grace", tribe: "Builders Tribe", has_group: true, release_on: false },
  reach_new_link: { leader_first: "Grace" },
  tribe_note: { leader_first: "Grace", tribe: "Builders Tribe", body: "Hello, tribe.\nWe meet as usual on Wednesday at 8 pm. Bring a friend.", gap: "no_number" },
};
