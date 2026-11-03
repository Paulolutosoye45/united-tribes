import type { Guide, Shot } from "../types";

/** L6. For a leader the church appointed, or offered a tribe: what your page says, your Tribe Card, and welcoming your members. */

/** Chiamaka, appointed to lead a tribe whose card has been started for her. */
const appointed = (rest: Omit<Shot, "cast" | "arrange">): Shot => ({ cast: "appointed-leader", arrange: "appointed-leader", ...rest });
/** Segun, whose card is approved and whose members have joined. */
const leading = (rest: Omit<Shot, "cast" | "arrange" | "path">): Shot => ({ cast: "leader", arrange: "leader-week", path: "/lead/tribe", ...rest });

export const appointedToLead: Guide = {
  code: "L6",
  slug: "appointed-to-lead",
  title: "Appointed or invited to lead? Start here",
  lede: "There is no application for you to fill in. Here is what your page says, what to do about your Tribe Card, and how to welcome the people who join.",
  forWho: "For leaders the church appointed or offered a tribe",
  audience: ["leader"],
  minutes: 8,
  art: "appointed",
  ready: ["Ten minutes for your Tribe Card, in one go or two. It saves as you type."],
  ifDifferent: "Your steps may differ a little: the church can turn training on or off. Your Lead page always lists the steps that are true for you.",
  next: ["leader-academy", "run-your-week"],
  parts: [
    {
      title: "Your page",
      blurb: "It already knows you have been asked. There is nothing to apply for.",
      steps: [
        {
          id: "appointed",
          title: "Read what your Lead page says",
          do: ["Press [[Lead]] at the bottom of your screen.", "The top says **You have been appointed to lead** and names your tribe. There is no application and no interview."],
          shot: appointed({ path: "/lead", ring: [{ role: "heading", name: /^You have been appointed to lead/ }], tag: "Your role", alt: "The Lead page for an appointed leader: You have been appointed to lead, with the tribe’s name.", minHeight: 420, lead: 40 }),
        },
        {
          id: "where-you-are",
          title: "Follow the four steps",
          do: ["Under **Where you are**: Appointed, Leader training, Tribe Card, and Open to members.", "The ticks fill in as you go. The one with a glow is the one to do now."],
          shot: appointed({ path: "/lead", ring: [{ role: "heading", name: "Where you are" }], tag: "Four steps", alt: "The four steps for an appointed leader, with the first ticked.", minHeight: 520, lead: 40 }),
        },
        {
          id: "offered",
          title: "If you accepted an offer instead",
          do: ["If you were approved and then pressed **Yes, I’ll lead it**, your Tribe Card already exists with the goal chosen.", "From here the steps are the same as for an appointed leader."],
        },
      ],
    },
    {
      title: "Your Tribe Card",
      blurb: "The page members choose your tribe from. A pastor approves it before anyone sees it.",
      steps: [
        {
          id: "open-card",
          title: "Open your Tribe Card",
          do: ["Press [[My Tribe Card]] at the top of your Lead page."],
          shot: appointed({ path: "/lead", frame: "screen", ring: [{ role: "link", name: "My Tribe Card" }], tag: "Press", alt: "The Lead page, with My Tribe Card ringed." }),
        },
        {
          id: "already-filled",
          title: "See what is already filled in",
          do: ["The community, stage of life and Season Goal are set, because your tribe is built on them. They show as plain text.", "The three Success Picture lines come from the church’s ready-made card. Use them as they are, change them, or write your own."],
          shot: appointed({ path: "/lead/tribe", ring: [{ role: "heading", name: "What it is built on" }], tag: "Already set", alt: "What it is built on: the community, the stage of life and the Season Goal, set for you.", minHeight: 520, lead: 60 }),
        },
        {
          id: "when-where",
          title: "Choose when and where you meet",
          do: ["Tap the day, choose the start time, then online or in person, your zone, and the area in general terms.", "Never a home address."],
          tip: "Times that suit most people are after 7:30pm on a weeknight, Saturday morning, or Sunday after service.",
          shot: appointed({ path: "/lead/tribe", ring: [{ role: "heading", name: "When and where" }], tag: "Day and time", alt: "The day buttons, start time, format and zone for your tribe.", minHeight: 680, lead: 40 }),
        },
        {
          id: "send-card",
          title: "Send it to the pastorate",
          do: ["Under **Send to the pastorate**, the list **Still to do** says what is missing. When it is empty, press [[Send my Tribe Card]].", "The card locks while a pastor reads it."],
          careful: "Pass the module on the Success Picture first if your training asks for it. The button waits for it.",
          shot: appointed({ path: "/lead/tribe", ring: [{ role: "heading", name: "Send to the pastorate" }], tag: "Last step", alt: "Send to the pastorate: what is still to do, and the Send my Tribe Card button.", minHeight: 460, lead: 40 }),
        },
        {
          id: "then",
          title: "What happens next",
          do: ["You will see the answer on your Lead page and your card. If a pastor asks for changes, it says exactly what to change."],
          timeline: [
            { when: "At once", what: "Your card shows With the pastorate, and is locked." },
            { when: "When a pastor has read it", what: "It is Published, or it comes back with a note about what to change." },
            { when: "Once you are certified too", what: "Members can find your tribe and join it." },
            { when: "When someone joins", what: "They appear under Your members on this page." },
          ],
        },
      ],
    },
    {
      title: "When members join",
      blurb: "The first week matters most. A short, warm welcome goes a long way.",
      steps: [
        {
          id: "where-you-meet",
          title: "Say where you meet",
          do: ["Once your card is published, **Where you meet** is at the top of your Tribe Card page.", "Online: paste your meeting link. In person: a short note on where to find you. Then press [[Save]]. Members get it in their reminders."],
          shot: leading({ ring: [{ role: "heading", name: "Where you meet" }], tag: "Link or place", alt: "Where you meet: a box for the meeting link and a place note.", minHeight: 420, lead: 40 }),
        },
        {
          id: "members",
          title: "See who has joined",
          do: ["**Your members** lists each person the moment they join, with when they joined and a short note on what they are hoping for.", "Each shows **To welcome** until you have welcomed them."],
          shot: leading({ ring: [{ role: "heading", name: "Your members" }], tag: "Your members", alt: "The list of members who have joined, each marked To welcome.", minHeight: 640, lead: 40 }),
        },
        {
          id: "welcome",
          title: "Welcome each person",
          do: ["Press [[Message on WhatsApp]] for a ready-written hello, or [[Call]].", "Then press [[I have welcomed them]] so you can see who is left."],
          shot: leading({ ring: [{ role: "link", name: "Message on WhatsApp" }], second: [{ role: "button", name: "I have welcomed them" }], tag: "Say hello", alt: "A member’s card with Message on WhatsApp, Call, and I have welcomed them.", minHeight: 520, lead: 160 }),
        },
        {
          id: "group-link",
          title: "Add your group link and first meeting",
          do: ["Under **For your tribe**, paste the WhatsApp group invite link, and choose the date of your first meeting. Then press [[Save]].", "Aim to meet within two weeks of the season starting."],
          shot: leading({ ring: [{ role: "heading", name: "For your tribe" }], tag: "Link and date", alt: "A box for the WhatsApp group invite link and a date for the first meeting.", minHeight: 520, lead: 40 }),
        },
        {
          id: "group-add",
          title: "Add people to the group after they say yes",
          do: [
            "Under **Your WhatsApp group**, **Ready to add** lists the people who have pressed Yes, I’m in, with their number where they allow it. Add each one to your WhatsApp group, then tick [[Added to the group]].",
            "People the church placed who have not yet said yes appear as names only. Their number and the group link open when they say yes, and not before, because joining a WhatsApp group shows a person’s number to everyone in it.",
            "If someone leaves your tribe, they appear under **If they joined the group, remove them**. Take them out of the group and tick [[Removed from the group]].",
          ],
          tip: "Your assistant sees your ticks, so nobody is added twice.",
        },
        {
          id: "assistant",
          title: "Recommend an assistant leader",
          do: ["Under **Your assistant leader**, type the email of someone you trust, say why in a line or two, and press [[Recommend an assistant]].", "The church office decides, and tells you."],
          tip: "An assistant who leads in a different way from you balances your tribe.",
          shot: leading({ ring: [{ role: "heading", name: "Your assistant leader" }], tag: "Optional", alt: "Your assistant leader: an email box, a reason, and the Recommend an assistant button.", minHeight: 560, lead: 40 }),
        },
      ],
    },
  ],
};
