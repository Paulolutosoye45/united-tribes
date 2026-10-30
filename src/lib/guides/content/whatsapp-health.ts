import type { Guide, Shot } from "../types";

/**
 * A1. For the admin (and the director and data lead, who can open the same pages): watching WhatsApp, pausing it, and finding out why it is not working.
 * The screens exist only once the owner has opened them from the console's Features page, so every picture says which switches are On.
 */
const SWITCHES = ["whatsapp_guard", "whatsapp_health"] as const;

const office = (rest: Omit<Shot, "cast" | "device" | "features">): Shot => ({ cast: "admin", device: "desktop", features: SWITCHES, ...rest });

export const whatsappHealth: Guide = {
  code: "A1",
  slug: "whatsapp-health",
  title: "Watch WhatsApp, pause it, and find out why it stopped",
  lede: "WhatsApp is how most members hear from the church. This is where you see that it is working, stop it in one press if it is not, and ask Meta what is wrong.",
  forWho: "For the admin, and the director and data lead who can open the same pages",
  audience: ["admin"],
  seenBy: ["director", "data_lead"],
  minutes: 6,
  art: "watch",
  ready: ["Your own phone number saved on your profile, to try the test message", "The reason, if you are pausing: a few words for the log"],
  whoSees: [
    "While WhatsApp is paused, members are not told. Each message goes to their next channel (email or text) instead, and nothing is lost.",
    "The director and the admin are emailed if WhatsApp pauses itself. Only a person can restart it.",
  ],
  ifDifferent: "If you cannot find the WhatsApp card or the health page, the owner has not opened them yet. They are opened from the owner’s console, under Features.",
  next: [],
  parts: [
    {
      title: "Keep an eye on it",
      blurb: "Everything starts from the Message log.",
      steps: [
        {
          id: "open-log",
          title: "Open the Message log",
          do: ["Open **Admin**, then **Sending and email**, and press [[See the message log]]."],
          shot: office({ path: "/admin/system", ring: [{ role: "link", name: "See the message log" }], tag: "Press", alt: "The Sending and email page, with See the message log ringed." }),
        },
        {
          id: "read-card",
          title: "Read the WhatsApp messages card",
          do: [
            "At the top of the log, **WhatsApp messages** tells you in one word how WhatsApp is: **Running**, **Paused**, or **Paused by itself**. In Rehearsal it only counts and says when it would have paused.",
            "Under it are three numbers. **Account refusals counted now** is how many times Meta has refused the church’s account lately. **Oldest still waiting** is the message that has waited longest.",
          ],
          tip: "Most days there is nothing to do. A number that is climbing, or a message that has waited a long time, is your cue to look.",
          shot: office({ path: "/admin/messages", ring: [{ role: "heading", name: "WhatsApp messages" }], tag: "How WhatsApp is", alt: "The WhatsApp messages card, with its state and three numbers.", minHeight: 360 }),
        },
      ],
    },
    {
      title: "Pause it, restart it",
      blurb: "The pause is yours to use. Nothing is lost while it is paused.",
      steps: [
        {
          id: "pause-start",
          title: "Press the pause button",
          do: ["If Meta is refusing messages, or you have been told something is wrong, press [[Pause all WhatsApp messages]]."],
          why: "Every WhatsApp message stops at once and goes to the person’s next channel instead. Pausing early is safer than letting refused messages pile up.",
          shot: office({ path: "/admin/messages", ring: [{ role: "button", name: "Pause all WhatsApp messages" }], tag: "Press", alt: "The Pause all WhatsApp messages button at the bottom of the card." }),
        },
        {
          id: "pause-why",
          title: "Say why",
          do: ["Write a few words in the box, at least eight characters. It goes in the log, so whoever restarts it knows what happened.", "Press [[Pause WhatsApp messages]]."],
          example: "Meta says our access token has expired. Checking with the owner.",
          careful: "A pause does not end by itself. Someone has to restart it.",
          shot: office({
            path: "/admin/messages",
            before: [
              { do: "click", on: { role: "button", name: "Pause all WhatsApp messages" } },
              { do: "fill", on: { label: "Why are you pausing WhatsApp?" }, value: "Meta says our access token has expired. Checking with the owner." },
            ],
            ring: [{ role: "button", name: "Pause WhatsApp messages" }],
            second: [{ label: "Why are you pausing WhatsApp?" }],
            tag: "Then press",
            alt: "The box asking why you are pausing WhatsApp, filled in, with the Pause WhatsApp messages button.",
          }),
        },
        {
          id: "restart",
          title: "Restart it when you have looked into it",
          do: ["The card now says who paused it, when, and why. When the problem is fixed, press [[I have looked into it: restart]]."],
          shot: office({ path: "/admin/messages", whatsapp: "paused", ring: [{ role: "button", name: "I have looked into it: restart" }], tag: "Only when it is fixed", alt: "The card while WhatsApp is paused, with the restart button ringed." }),
        },
        {
          id: "restart-note",
          title: "Leave a note, then restart",
          do: ["Write what you found, if you like. Then press [[Restart WhatsApp messages]]."],
          tip: "It pauses itself again if Meta keeps refusing, so a restart that was too early costs nothing.",
          shot: office({
            path: "/admin/messages",
            whatsapp: "paused",
            before: [{ do: "click", on: { role: "button", name: "I have looked into it: restart" } }],
            ring: [{ role: "button", name: "Restart WhatsApp messages" }],
            tag: "Press",
            alt: "The note for the log and the Restart WhatsApp messages button.",
          }),
        },
      ],
    },
    {
      title: "Find out why",
      blurb: "The health page asks Meta and tells you in plain words.",
      steps: [
        {
          id: "open-health",
          title: "Open WhatsApp health",
          do: ["Under the title of the Message log, press [[WhatsApp health]]."],
          shot: office({ path: "/admin/messages", ring: [{ role: "link", name: "WhatsApp health" }], tag: "Press", alt: "The link to WhatsApp health under the Message log title." }),
        },
        {
          id: "ask-meta",
          title: "Ask Meta",
          do: ["Under **Asking Meta**, press [[Check now]]. It asks Meta whether the access token works, how the sending number stands, whether the site hears back, and whether every message has approved wording."],
          shot: office({ path: "/admin/messages/whatsapp", ring: [{ role: "button", name: "Check now" }], tag: "Press", alt: "The Asking Meta card with the Check now button." }),
        },
        {
          id: "read-answers",
          title: "Read what Meta said",
          do: ["In a few seconds a line appears: **Nothing is stopping WhatsApp**, or **Something needs fixing before WhatsApp can be trusted**.", "Each line below it is one question. The ones that need you say what to do about it, in words."],
          tip: "Press [[Check again]] after the owner has fixed something, to see it go away.",
          shot: office({
            path: "/admin/messages/whatsapp",
            before: [{ do: "click", on: { role: "button", name: "Check now" } }, { do: "wait", on: { testid: "wa-checks-summary" } }],
            ring: [{ testid: "wa-checks-summary" }],
            second: [{ role: "button", name: "Check again" }],
            tag: "The answer",
            alt: "The answer from Meta: a line saying whether anything is stopping WhatsApp, with a list of what was checked.",
          }),
        },
        {
          id: "test-message",
          title: "Send yourself a test message",
          do: ["Press [[Send me a test message]]. One short message goes to the number saved on your own profile.", "A minute or two later, refresh the page. **Your last test** says whether it arrived."],
          why: "It is the surest check there is, because it travels the whole way from the site to a real phone.",
          careful: "If the button is missing, your own phone number is not saved on your profile yet.",
          shot: office({ path: "/admin/messages/whatsapp", ring: [{ role: "button", name: "Send me a test message" }], tag: "Press", alt: "The Send me a test message card and its button." }),
        },
      ],
    },
  ],
};
