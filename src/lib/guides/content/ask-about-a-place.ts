import type { Guide, Shot } from "../types";

/**
 * L8. For a tribe leader who is worried about a member’s place in the tribe. A leader never removes anyone: they ask the church, and a person with the right to
 * decide does. The screen exists only once the owner has opened leader removal requests, so every picture says so.
 */
const leading = (rest: Omit<Shot, "cast" | "path" | "features" | "arrange">): Shot => ({
  cast: "leader",
  path: "/lead/tribe",
  arrange: "removal-is:none",
  features: ["removal_requests"],
  ...rest,
});

const open: Shot["before"] = [{ do: "click", on: { role: "button", name: "Ask the church about a member’s place" } }, { do: "wait", on: { testid: "removal-form" } }];
const written: NonNullable<Shot["before"]> = [
  ...open,
  { do: "select", on: { label: "Who is this about?" }, value: "Emeka" },
  { do: "click", on: { css: 'label:has(input[name="removal-reason"][value="repeated_absence"])' } },
  { do: "fill", on: { label: "What has happened?" }, value: "Emeka has missed the first meeting and has not answered my calls or messages for two weeks." },
];

export const askAboutAPlace: Guide = {
  code: "L8",
  slug: "ask-about-a-place",
  title: "Ask the church about a member’s place in your tribe",
  lede: "You never have to remove anyone yourself, and you cannot. If a member’s place in your tribe is a real worry, you ask the church, and a person who can decide looks at it carefully.",
  forWho: "For tribe leaders",
  audience: ["leader"],
  minutes: 5,
  art: "request",
  ready: ["A short, honest account of what has happened", "The member spoken to, in person or by phone: the church asks that you do this first"],
  whoSees: [
    "What you write is read by the person deciding, your coach and the Care Team. The member never reads it.",
    "If the church agrees, the member is told kindly and offered other tribes. Their attendance and everything they wrote stays.",
  ],
  ifDifferent: "If you do not see this on your Tribe Card, the church has not opened it yet. Speak to your coach.",
  next: ["run-your-week"],
  parts: [
    {
      title: "Before you ask",
      blurb: "This is a last step, not a first one.",
      steps: [
        {
          id: "speak-first",
          title: "Speak to them first",
          do: ["Talk to the person, in person or by phone, about what you have seen. Most things are settled in that conversation.", "If you still have a real worry afterwards, ask the church."],
          why: "You are not removing anyone. You are asking the church to look at it. Nothing happens to the member until a person who can decide has decided.",
          careful: "If someone may be in danger, do not wait for this form. Call your coach or the Care Team now.",
        },
      ],
    },
    {
      title: "Ask the church",
      blurb: "Three short questions, then you send it.",
      steps: [
        {
          id: "open-form",
          title: "Open the form on your Tribe Card",
          do: ["Open **Lead**, then **My Tribe Card**. Near the bottom is **Requests about a member’s place**.", "Press [[Ask the church about a member’s place]]."],
          shot: leading({ ring: [{ role: "button", name: "Ask the church about a member’s place" }], tag: "Press", alt: "The Requests about a member’s place section of the Tribe Card, with the ask button ringed.", minHeight: 420 }),
        },
        {
          id: "who-and-why",
          title: "Say who it is about, and the main reason",
          do: ["If you lead more than one person, choose who under [[Who is this about?]].", "Then choose the main reason under [[What is the main reason?]]. Each one says in a line what it means."],
          careful: "Safety or conduct goes to the Care Team alone. If it is that serious, do not wait for an answer: call them.",
          shot: leading({
            before: [...open, { do: "select", on: { label: "Who is this about?" }, value: "Emeka" }, { do: "click", on: { css: 'label:has(input[name="removal-reason"][value="repeated_absence"])' } }],
            ring: [{ role: "group", name: "What is the main reason?" }],
            second: [{ label: "Who is this about?" }],
            tag: "Your choice",
            alt: "Who this is about, and the five reasons to choose from, with one chosen.",
            minHeight: 520,
            lead: 70,
          }),
        },
        {
          id: "say-what",
          title: "Say what has happened",
          do: ["Write [[What has happened?]] in your own words, between 20 and 500 characters. The person deciding reads it. The member never does."],
          example: "Emeka has missed the first meeting and has not answered my calls or messages for two weeks.",
          careful: "Write only what you have seen and heard. The person deciding reads this, and so does your coach.",
          shot: leading({
            before: written,
            ring: [{ label: "What has happened?" }],
            tag: "In your own words",
            alt: "The box for what has happened, with a few sentences written and a count of characters beneath.",
            minHeight: 360,
            lead: 90,
          }),
        },
        {
          id: "send",
          title: "Tick that you have spoken, then send",
          do: [
            "Tick [[I have spoken to this person about this.]] You cannot send without it.",
            "Tick [[This is urgent: someone may be at risk.]] only if it is true. It sends an urgent alert to the Care Team now.",
            "Press [[Send to the church]].",
          ],
          shot: leading({
            before: [...written, { do: "check", on: { label: "I have spoken to this person about this." } }],
            ring: [{ role: "button", name: "Send to the church" }],
            second: [{ label: "I have spoken to this person about this." }],
            tag: "Press",
            alt: "The two boxes to tick and the Send to the church button.",
            minHeight: 420,
          }),
        },
      ],
    },
    {
      title: "What happens next",
      blurb: "You will be told. Nothing is decided in silence.",
      steps: [
        {
          id: "after",
          title: "Wait for the church to answer",
          do: [
            "Your request appears under **Requests about a member’s place**, with **Waiting for the church to look at it.**",
            "You can have two waiting at a time. If the church has a question, it says **The church has a question for you.** Type your reply and press [[Send my answer]].",
            "Changed your mind? Press [[Withdraw this request]].",
          ],
          timeline: [
            { when: "At once", what: "Sent. The Care Team is told, and so is your coach, unless it is about safety, conduct or a young person." },
            { when: "Within days", what: "A person who can decide reads it. They may ask you a question first." },
            { when: "If it is approved", what: "The member’s place is released and they are told kindly. If you keep a WhatsApp group for the tribe, please take them out of it yourself." },
            { when: "If it is not approved", what: "They stay in the tribe, and you are told. The member is told nothing." },
          ],
        },
      ],
    },
  ],
};
