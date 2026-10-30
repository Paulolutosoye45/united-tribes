import type { Guide } from "../types";

/** M6. Seeing, changing, downloading and asking to delete one's own information. */
export const yourInformation: Guide = {
  code: "M6",
  slug: "your-information",
  title: "Your information: see it, take it, or ask for it to be deleted",
  lede: "It is your information. You can change how we reach you, download a copy, or ask the church office to delete your account.",
  forWho: "For every member",
  audience: ["member"],
  minutes: 4,
  art: "privacy",
  ready: ["Nothing but your phone. You can stop at any step."],
  ifDifferent: "If a button here is missing or does not work, ask the church office. They can do all of this for you.",
  parts: [
    {
      title: "See and change",
      blurb: "Each choice takes effect as soon as you save it.",
      steps: [
        {
          id: "open-privacy",
          title: "Open Privacy and my data",
          do: ["Tap your **initials** at the top right, then [[Privacy and my data]]."],
          shot: {
            cast: "member",
            path: "/home",
            before: [{ do: "click", on: { role: "button", name: "Your account" } }, { do: "wait", on: { role: "link", name: "Privacy and my data" } }],
            frame: "screen",
            ring: [{ role: "link", name: "Privacy and my data" }],
            tag: "Press",
            alt: "The account menu, with Privacy and my data ringed.",
          },
        },
        {
          id: "add-number",
          title: "Add your WhatsApp number, if we ask",
          do: ["If the top of your profile says **Add your WhatsApp number**, press [[Add my number]]. It takes you to the box below.", "Not ready? Press [[Not now]]. The reminder stays away for a week."],
          why: "We need a number to reach you about your tribe. It takes a moment, and you choose how we use it.",
          shot: { cast: "member", path: "/profile", features: ["number_required"], ring: [{ testid: "number-prompt" }], tag: "If you see this", alt: "A card at the top of the profile: Add your WhatsApp number, with Add my number and Not now.", minHeight: 300 },
        },
        {
          id: "how-we-reach-you",
          title: "Choose how we reach you",
          do: ["Under **How we reach you**, type your [[WhatsApp number]], then tick [[WhatsApp]], [[Email]] or [[Text message]].", "Press [[Save]]."],
          why: "We send nothing between 10 pm and 6 am, except an urgent care alert.",
          tip: "If the page says **You have two numbers**, you sign in with one number and we message you on another. That is fine if you meant it. If not, change the one that is wrong.",
          shot: { cast: "member", path: "/profile", features: ["number_required"], ring: [{ role: "textbox", name: "WhatsApp number" }], tag: "Your number", alt: "The choices for how we reach you: your WhatsApp number, then WhatsApp, email and text message.", lead: 140, minHeight: 520 },
        },
        {
          id: "emails",
          title: "Choose which emails you get",
          do: ["Under **Emails from us**, tick or untick [[Reminders]], [[Announcements]] and [[My tribe]].", "Press [[Save]]. It lights up once you change something."],
          tip: "Safety messages, like a sign-in code, always arrive. Every email also has a link at the bottom to stop that kind.",
          shot: { cast: "member", path: "/profile", ring: [{ role: "heading", name: "Emails from us" }], tag: "Tick or untick", alt: "The three email choices: Reminders, Announcements, My tribe.", lead: 40, minHeight: 480 },
        },
        {
          id: "delete-answers",
          title: "Take back your answers",
          do: ["Under **Your answers**, press [[Delete my answers]] to stop being matched. Your account stays."],
          careful: "Your answers are removed and no longer used to match you.",
          shot: { cast: "member", path: "/profile", ring: [{ role: "button", name: "Delete my answers" }], second: [{ role: "link", name: "Change my answers" }], tag: "Only if you want to", alt: "Under Your answers: Change my answers, and Delete my answers." },
        },
      ],
    },
    {
      title: "Take it, or have it deleted",
      blurb: "Download first if you want to keep a copy.",
      steps: [
        {
          id: "download",
          title: "Download a copy first",
          do: ["Under **Your data**, press [[Download my data]]. You get one file with everything we hold about you, opened for you and nobody else."],
          shot: { cast: "member", path: "/profile", ring: [{ role: "link", name: "Download my data" }], tag: "Your copy", alt: "The Download my data button." },
        },
        {
          id: "ask-delete",
          title: "Ask for your account to be deleted",
          do: ["Press [[Ask for my account to be deleted]]."],
          careful: "It cannot be undone. If you only want to stop being matched or messaged, use the choices above instead.",
          shot: { cast: "member", path: "/profile", ring: [{ role: "button", name: "Ask for my account to be deleted" }], tag: "Think first", alt: "The Ask for my account to be deleted button." },
        },
        {
          id: "send-request",
          title: "Read it, then send",
          do: ["Read what deleting removes. You may add a note for the office.", "Press [[Send my request]]. Or press [[Keep my account]] to stop."],
          shot: {
            cast: "member",
            path: "/profile",
            before: [{ do: "click", on: { role: "button", name: "Ask for my account to be deleted" } }, { do: "wait", on: { role: "button", name: "Send my request" } }],
            ring: [{ role: "button", name: "Send my request" }],
            second: [{ role: "button", name: "Keep my account" }],
            tag: "Send",
            alt: "The deletion request form, with Send my request and Keep my account.",
            lead: 280,
          },
        },
      ],
    },
    {
      title: "What happens next",
      steps: [
        {
          id: "office-answers",
          title: "The church office answers",
          do: ["Your account works as normal until they answer. You see their answer on this page.", "Changed your mind? Press [[I’ve changed my mind]]."],
          timeline: [
            { when: "At once", what: "Your request is sent. Nothing is deleted yet." },
            { when: "When the office has looked", what: "They delete your account, or tell you here why they cannot yet." },
            { when: "If you lead a tribe", what: "The office arranges someone to take over before they delete you." },
          ],
          shot: { cast: "member-leaving", path: "/profile", ring: [{ role: "button", name: "I’ve changed my mind" }], tag: "Until they answer", alt: "After you ask: You have asked for your account to be deleted, with I’ve changed my mind." },
        },
      ],
    },
  ],
};
