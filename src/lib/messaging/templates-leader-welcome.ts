import { SAFEGUARDING_PROMISES } from "@/lib/academy/declaration";
import { flat, smsLine, str } from "./format";
import type { Context, EmailContent, Params, TemplateDef } from "./types";

/**
 * The welcome email a leader gets when the church sends it: "Welcome to leading a tribe".
 *
 * It says the pastorate asked because it trusts them, lists the promises that come with that trust, and walks through the steps with a
 * picture of each page. It is signed with the pastor's name, typed in from two boxes in God Mode. It is not sent from his mailbox.
 *
 * Two versions, one template: the leader may choose their goal (`choose`), or the goal was chosen for them.
 *
 * Rules the wording keeps, and the tests check:
 *   - it names no owner and no administrator. The only name in it is the signature
 *   - it carries no link that works as a key: the button opens the sign-in page, and signing in is the whole proof
 *   - every step is written out in words, with the picture under it, so the email is whole when a mail program hides pictures
 *   - the seven promises are the first seven of the safeguarding declaration, word for word, so the email and the declaration never disagree
 *   - email only: it is never put to Meta for approval, and the database queues it as email
 *
 * The pastor approves THIS wording. Change a word below and you must change WELCOME_WORDING_VERSION: a test fails until you do, and the
 * database switches the welcome buttons off until the pastor has approved the new version.
 */
export const WELCOME_WORDING_VERSION = "2026-10-w1";

/** What the signature reads when the settings carry none (the preview). The database always passes the saved two lines. */
export const WELCOME_DEFAULT_SIGNATURE = ["Wale Ekundayo", "Pastor TCN Iganmu Center"] as const;

/**
 * The pictures: real pages of the platform on a phone-size screen, made by `scripts/leader-guide-pictures.ts` with a made-up leader and
 * made-up numbers, kept in public/email/leader-guide. Width and height are what the email shows; the files are twice that, for sharp screens.
 * A test reads every file and checks it against this table.
 */
export const GUIDE_PICTURES = {
  "sign-in": { width: 390, height: 520, alt: "The sign-in page, with the box for your email address circled." },
  card: { width: 390, height: 520, alt: "Your Tribe Card as it opens, with its title circled." },
  "goal-choose": { width: 390, height: 520, alt: "Your Tribe Card, with the list of goals you can choose from circled. The goal you were started on is marked." },
  "goal-fixed": { width: 390, height: 520, alt: "Your Tribe Card, with your goal circled." },
  "card-lines": { width: 390, height: 680, alt: "Your Tribe Card, with the three lines of your Success Picture circled." },
  academy: { width: 390, height: 520, alt: "The Academy, with the module on the Success Picture circled." },
  declaration: { width: 390, height: 520, alt: "The safeguarding promises, with the box where you sign circled." },
  send: { width: 390, height: 520, alt: "Your Tribe Card, with the Send my Tribe Card button circled." },
} as const;
export type GuidePicture = keyof typeof GUIDE_PICTURES;

const picture = (c: Context, name: GuidePicture) => ({
  src: c.link(`/email/leader-guide/${name}.png`),
  alt: GUIDE_PICTURES[name].alt,
  width: GUIDE_PICTURES[name].width,
  height: GUIDE_PICTURES[name].height,
});

/** What the church asks of a leader beyond the declaration. One line, added to the seven. */
const SIGN_IN_PROMISE = "I will keep my sign-in private. I will not share it, or let anyone else use my account.";

/** The seven promises that come from the declaration, word for word. The eighth there (telling a coach) is left to the coach's own welcome. */
export const WELCOME_PROMISES: readonly string[] = [...SAFEGUARDING_PROMISES.slice(0, 7), SIGN_IN_PROMISE];

type Mode = "required" | "optional" | "off";
const mode = (v: unknown, others: readonly string[]): Mode => (typeof v === "string" && others.includes(v) ? (v as Mode) : "required");

const text = (v: unknown) => str(v).replace(/\s+/g, " ").trim();

export function welcomeEmail(p: Params, c: Context): EmailContent {
  const choose = p.choose === true;
  const communityFree = choose && p.community_free === true;
  const goal = text(p.goal);
  const community = text(p.community);
  const academy = mode(p.academy, ["required", "optional", "off"]);
  const declaration = mode(p.declaration, ["required", "off"]);
  // Only when the Details Check is On for this leader and their stage is not yet confirmed (the database says so). With it Off the email is word for word what the pastor approved.
  const confirmDetails = p.confirm_details === true;
  const name = text(p.signature_name) || WELCOME_DEFAULT_SIGNATURE[0];
  const title = text(p.signature_title) || WELCOME_DEFAULT_SIGNATURE[1];

  const started = goal ? `“${goal}”${community ? ` in ${community}` : ""}` : "";
  const tribeLine = choose
    ? communityFree
      ? `The church has let you choose your community and your goal for this season.${started ? ` You were started on ${started}. You can keep it or choose another.` : " You can pick from the goals on your Tribe Card."}`
      : `The church has let you choose your goal for this season.${started ? ` You were started on ${started}. You can keep it or choose another from the same community.` : " You can pick from the goals on your Tribe Card."}`
    : `Your goal for this season was chosen for you${started ? `: ${started}` : ""}. It is set, so there is nothing for you to choose.`;

  type Step = { title: string; body: string; image: GuidePicture };
  const steps: Step[] = [
    {
      title: "Sign in",
      body: "Open United Tribes and sign in with this email address, the one this message was sent to. Choose Email me a code, or Continue with Google if that is the account you use.",
      image: "sign-in",
    },
    {
      title: "Open your Tribe Card",
      body: "Press Open my Tribe Card at the end of this email. Your card is already started for you, so there is nothing to set up.",
      image: "card",
    },
    choose
      ? {
          title: "Choose your goal",
          body: communityFree
            ? "Pick your community, then your goal. The list marks the goal you were started on and shows how many people are waiting for each one."
            : "The list shows the goals open to you, marks the goal you were started on, and shows how many people are waiting for each one. Pick the one you want to lead.",
          image: "goal-choose",
        }
      : {
          title: "Check your goal",
          body: "Your goal is already filled in. Read it, and make sure you are glad to lead it. If something is wrong, tell the church office before you go on.",
          image: "goal-fixed",
        },
    {
      title: "Make the card yours",
      body: "Tell the story of why you lead, then read the three lines of your Success Picture. They are written for you to start from, so change them until they sound like you. Say when your tribe meets.",
      image: "card-lines",
    },
  ];
  if (academy === "required") {
    steps.push({
      title: "Do the Academy",
      body: "Work through the module on the Success Picture before you send your card. The rest of the Academy follows, and the church certifies you when it is done.",
      image: "academy",
    });
  } else if (academy === "optional") {
    steps.push({
      title: "The Academy, when you are ready",
      body: "The Academy is open to you. It is not required, so you can send your card first and do it when it suits you.",
      image: "academy",
    });
  }
  if (declaration === "required") {
    steps.push({
      title: "Sign the safeguarding promises",
      body: "Read the promises on that page slowly, then sign them. The first seven are the ones listed below, word for word.",
      image: "declaration",
    });
  }
  steps.push({
    title: "Send your card to the pastorate",
    body: "When everything is filled in, press Send my Tribe Card. A pastor reads it and tells you if anything needs to change.",
    image: "send",
  });

  return {
    subject: "Welcome to leading a tribe",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "The pastorate at The Covenant Nation asked you to lead a tribe because it trusts you. That trust is the reason you are a leader, and it is why a few promises come with the role.",
      tribeLine,
      ...(confirmDetails ? ["One thing first, and it takes under a minute: please check the details we hold for your tribe. The button below opens My page, after you sign in."] : []),
      "Here are the steps, in the order you will do them. Each has a picture of the page, with the thing to press circled.",
    ],
    ...(confirmDetails ? { options: [{ label: "Confirm your details", url: c.link("/my") }] } : {}),
    steps: { title: "Your steps", items: steps.map((s) => ({ title: s.title, body: s.body, image: picture(c, s.image) })) },
    lists: [
      {
        title: declaration === "required" ? "The promises that come with this role" : "What we ask of every leader",
        items: [...WELCOME_PROMISES],
      },
      {
        title: "Good to know",
        items: [
          "Being appointed does not skip anything. A pastor reads your card before members can see your tribe.",
          "Members cannot see your tribe until it is approved, so take the time you need.",
          "If anything is unclear, ask the church office. No question is too small.",
          "If this is not the right season for you, tell the church office. Saying “not now” is allowed.",
        ],
      },
    ],
    cta: { label: "Open my Tribe Card", url: c.link("/lead/tribe") },
    signoff: [name, title],
  };
}

const welcome: TemplateDef = {
  key: "leader_welcome",
  audience: "leader",
  title: "Welcome to leading a tribe",
  emailOnly: true,
  email: welcomeEmail,
  sms: (_p, c) => smsLine("United Tribes: welcome to leading a tribe. Sign in to open your Tribe Card:", c.link("/lead/tribe")),
  whatsapp: (_p, c) => ({
    body: "Welcome to leading a tribe. Sign in to open your Tribe Card: {{1}}",
    example: ["https://unitedtribes.example/lead/tribe"],
    vars: [flat(c.link("/lead/tribe"))],
  }),
};

export const LEADER_WELCOME_TEMPLATES: TemplateDef[] = [welcome];

/** Believable fields for the template, as the database supplies them. Used by the tests. */
export const LEADER_WELCOME_SAMPLES: Record<string, Params> = {
  leader_welcome: {
    choose: true,
    community_free: false,
    goal: "Build a steady client pipeline",
    community: "Business and entrepreneurship",
    academy: "required",
    declaration: "required",
    signature_name: WELCOME_DEFAULT_SIGNATURE[0],
    signature_title: WELCOME_DEFAULT_SIGNATURE[1],
    version: WELCOME_WORDING_VERSION,
  },
};
