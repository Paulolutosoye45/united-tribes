import type { Guide, Shot } from "../types";

/** O3. For a member the church has placed in a tribe: the private link in the email, and the four things it lets you do. */

const placed = (rest: Omit<Shot, "cast" | "path">): Shot => ({ cast: "placed", path: "@placed", ...rest });

export const youHaveBeenPlaced: Guide = {
  code: "O3",
  slug: "you-have-been-placed",
  title: "You have been placed in a tribe",
  lede: "The church has found you a tribe that fits. Your email says which. Here is what the page shows, and the three things you can do with it.",
  forWho: "For a member the church has placed",
  audience: ["member"],
  seenBy: ["leader", "assistant_leader", "director"],
  public: true,
  minutes: 4,
  art: "placed",
  ready: ["The email that says the church has placed you in a tribe", "Your phone, or a computer"],
  ifDifferent: "If the page says the link is not valid, it may have expired, or you may already have chosen. Open your tribe in the app to see where you stand.",
  next: [],
  parts: [
    {
      title: "Look at your tribe",
      blurb: "Opening the link changes nothing. It only shows you where you have been placed.",
      steps: [
        {
          id: "open",
          title: "Open the link in your email",
          do: ["Open the link in the email that says the church has placed you. You do not need to sign in.", "The top says your first name and **your tribe**. Nothing happens until you press a button."],
          shot: placed({ frame: "screen", ring: [{ role: "heading", name: /, your tribe$/ }], tag: "Your tribe", alt: "The placement page, with the heading naming you and your tribe." }),
        },
        {
          id: "tribe",
          title: "See who leads it, and when it meets",
          do: ["The first box names your tribe and who leads it. It says when it meets, which season it is for, and the date to meet by.", "**Fit** says how well the tribe matches what you asked for."],
          shot: placed({ ring: [{ role: "heading", name: /Growers tribe$/ }], tag: "Your tribe", alt: "A box with the tribe’s name, its leader, the day and time it meets, the season, and how well it fits you.", minHeight: 460, lead: 40 }),
        },
        {
          id: "purpose",
          title: "Read what it is for",
          do: ["**What this tribe is for** is three lines: how the tribe will love God, others and life.", "**The Tribe Covenant** is four promises every member makes."],
          shot: placed({ ring: [{ role: "heading", name: "What this tribe is for" }, { role: "heading", name: "The Tribe Covenant" }], tag: "Read both", alt: "What this tribe is for, and the four promises of the Tribe Covenant.", minHeight: 520, lead: 40 }),
        },
        {
          id: "details",
          title: "See who is given your details",
          do: ["**Your details** says that your leader can see your name now, and is given your email and number only after you press **Yes, I’m in**.", "You can keep them private. The last button on the page does it."],
          shot: placed({ ring: [{ role: "heading", name: "Your details" }], tag: "Your details", alt: "Your details: when your leader is given your name and email.", minHeight: 420, lead: 40 }),
        },
      ],
    },
    {
      title: "Choose what to do",
      blurb: "Three buttons. Take your time over which.",
      steps: [
        {
          id: "yes",
          title: "Keep your place",
          do: ["Press [[Yes, I’m in]]. This records that you agree to the tribe’s Success Picture and to the Tribe Covenant.", "Your leader sees your name and, if you said yes to WhatsApp, your number."],
          shot: placed({ ring: [{ role: "button", name: "Yes, I’m in" }], tag: "Press", alt: "The Yes, I’m in button, with the words about what you agree to.", minHeight: 420, lead: 120 }),
        },
        {
          id: "said-yes",
          title: "After you press yes",
          do: ["You will see **You said yes to this tribe.**", "Next, your leader will say hello, and tell you where and when to meet."],
          shot: placed({
            before: [{ do: "click", on: { role: "button", name: "Yes, I’m in" } }, { do: "wait", on: { text: "You said yes to this tribe" } }],
            ring: [{ text: "You said yes to this tribe" }],
            tag: "Done",
            alt: "The notice You said yes to this tribe.",
            minHeight: 420,
            lead: 120,
          }),
        },
        {
          id: "other-tribes",
          title: "Ask for a different tribe",
          do: ["If it does not suit you, press [[Show me other tribes]]. You give up this place, and you can look at tribes that fit you.", "This button is there until joining closes, a couple of weeks after the season begins."],
          careful: "Pressing it gives up your place in this tribe at once. Another tribe is not promised until you choose it.",
          shot: placed({ ring: [{ role: "button", name: "Show me other tribes" }], tag: "Only if needed", alt: "The Show me other tribes button.", minHeight: 420, lead: 120 }),
        },
        {
          id: "withhold",
          title: "Keep your details private",
          do: ["Press [[Don’t share my details]] if you would rather your leader was not given your email or your WhatsApp number.", "Your leader is told to expect you, and can still welcome you at the first meeting."],
          shot: placed({ ring: [{ role: "button", name: "Don’t share my details" }], tag: "If you prefer", alt: "The Don’t share my details button, with what it does.", minHeight: 420, lead: 120 }),
        },
        {
          id: "signed-in",
          title: "Or do it signed in",
          do: ["You can do all of this signed in, from your tribe page, if you prefer. The link in your email shows the same page."],
          shot: placed({ ring: [{ role: "link", name: "your tribe page" }], tag: "Signed in", alt: "The line at the bottom: You can also do all of this signed in, on your tribe page.", minHeight: 360, lead: 120 }),
        },
      ],
    },
  ],
};
