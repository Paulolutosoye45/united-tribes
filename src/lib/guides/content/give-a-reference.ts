import type { Action, Guide, Shot } from "../types";

/** O1. For someone asked to be a referee: the private link in the email, the code, four ratings and one question. */

/** Past the code: the page asks for Ngozi’s reference. Pastor Ife has typed the code that was emailed to her. */
const unlocked: Action[] = [
  { do: "click", on: { role: "button", name: "Send me the code" } },
  { do: "wait", on: { label: "Six-digit code" } },
  { do: "fill-code", on: { label: "Six-digit code" }, to: "ife.example@example.org" },
  { do: "wait", on: { testid: "referee-confirmed" } },
];
const rate = (id: string, n: number): Action => ({ do: "click", on: { css: `label:has(input[name="rate-${id}"][value="${n}"])` } });
const allRated: Action[] = [rate("reliability", 5), rate("warmth", 5), rate("confidentiality", 5), rate("maturity", 4)];

const referee = (rest: Omit<Shot, "cast" | "path">): Shot => ({ cast: "referee", path: "@referee", ...rest });

export const giveAReference: Guide = {
  code: "O1",
  slug: "give-a-reference",
  title: "Give a reference",
  lede: "Someone has asked you to speak for them as they apply to lead a small group. Four short questions, about two minutes. You do not need an account.",
  forWho: "For someone asked to be a referee",
  audience: ["member"],
  seenBy: ["leader", "pastor", "director", "admin"],
  public: true,
  minutes: 3,
  art: "reference",
  ready: ["The email asking you for a reference", "Your phone or email open, to get a six-digit code"],
  ifDifferent: "If the page says your link has expired or has already been used, ask the person who named you to tell the church office.",
  next: [],
  parts: [
    {
      title: "Open your link",
      blurb: "The page checks that it is really you before it asks anything.",
      steps: [
        {
          id: "open",
          title: "Open the link in your email",
          do: ["Open the link in the email that asked you for a reference. It is private to you, so please do not forward it.", "The top names the person and says how long it takes."],
          shot: referee({ frame: "screen", ring: [{ role: "heading", name: /^A reference for/ }], tag: "Their name", alt: "The reference page, with the heading A reference for the applicant’s name." }),
        },
        {
          id: "send-code",
          title: "Ask for a code",
          do: ["Under **First, let’s make sure it’s you**, press [[Send me the code]]."],
          why: "The code goes to the address the applicant gave for you. It shows that the reference comes from you, and not from the applicant.",
          shot: referee({ frame: "screen", ring: [{ role: "button", name: "Send me the code" }], tag: "Press", alt: "The page asking you to confirm it is you, with the Send me the code button." }),
        },
        {
          id: "enter-code",
          title: "Type your code",
          do: ["Open the email with your six-digit code, and type it into [[Six-digit code]].", "It is checked as soon as you have typed all six. If it has not come after a minute, you can ask for a new one."],
          shot: referee({
            before: [{ do: "click", on: { role: "button", name: "Send me the code" } }, { do: "wait", on: { label: "Six-digit code" } }],
            frame: "screen",
            ring: [{ label: "Six-digit code" }],
            tag: "Your code",
            alt: "The Check your email page, with a box for the six-digit code.",
          }),
        },
      ],
    },
    {
      title: "Your answers",
      blurb: "Rate four things, and say whether you have a concern. Your answers are private.",
      steps: [
        {
          id: "rate",
          title: "Rate four things from 1 to 5",
          do: ["For **Reliability**, **Warmth**, **Trustworthiness** and **Spiritual maturity**, tap the number that fits what you have seen. 1 is not really, and 5 is always.", "Answer as you have seen it in them, not as you hope it will be."],
          shot: referee({
            before: [...unlocked, rate("reliability", 5)],
            ring: [{ role: "radiogroup", name: /^Reliability/ }, { role: "radiogroup", name: /^Warmth/ }],
            tag: "Tap a number",
            alt: "Two of the four questions, Reliability and Warmth, each with the numbers 1 to 5. One number is chosen.",
            minHeight: 480,
            lead: 120,
          }),
        },
        {
          id: "concern",
          title: "Say whether you have a concern",
          do: ["Under **Any concern … leading others?**, choose [[No concern]] or [[Yes, I have one]].", "If you choose yes, a box opens: say what concerns you, in your own words. It goes to a pastor, who follows it up with care."],
          tip: "A concern is not a rejection. It is a reason for a pastor to talk with the person first.",
          shot: referee({
            before: [...unlocked, ...allRated],
            ring: [{ role: "radiogroup", name: "Any concern about this person leading others" }],
            tag: "Your choice",
            alt: "The question Any concern about the applicant leading others, with No concern and Yes, I have one.",
            minHeight: 420,
            lead: 140,
          }),
        },
        {
          id: "send",
          title: "Send your reference",
          do: ["Press [[Send my reference]]. It stays grey until you have rated all four and answered the question about a concern."],
          careful: "You can only send a reference once. Read your numbers before you press.",
          shot: referee({
            before: [...unlocked, ...allRated, { do: "click", on: { css: 'label:has-text("No concern")' } }, { do: "pause", ms: 400 }],
            ring: [{ role: "button", name: "Send my reference" }],
            tag: "Press",
            alt: "The four questions answered, the concern question answered, and the Send my reference button ready.",
            minHeight: 420,
            lead: 260,
          }),
        },
        {
          id: "thanks",
          title: "You are done",
          do: ["You will see **Thank you**, with your name.", "Your answers go only to the pastors and coaches who review leader applications. The person you spoke about never sees your ratings or your note."],
          shot: referee({
            before: [...unlocked, ...allRated, { do: "click", on: { css: 'label:has-text("No concern")' } }, { do: "click", on: { role: "button", name: "Send my reference" } }, { do: "wait", on: { role: "heading", name: /^Thank you/ } }],
            frame: "screen",
            ring: [{ role: "heading", name: /^Thank you/ }],
            tag: "Done",
            alt: "The Thank you screen after a reference has been sent.",
          }),
        },
      ],
    },
  ],
};
