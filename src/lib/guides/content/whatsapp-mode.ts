import type { Guide } from "../types";

/**
 * A2. For the admin (and the director, data lead and pastor, who can open the same pages): choosing how the church uses WhatsApp, reading what it costs, and
 * keeping the number safe. The screens exist only once the owner has opened WhatsApp mode from the console's Features page, so there are no pictures
 * of them; the words say where to look.
 */
export const whatsappMode: Guide = {
  code: "A2",
  slug: "whatsapp-mode",
  title: "Choose how the church uses WhatsApp, and what it costs",
  lede: "Full is WhatsApp as it has always been. Saver keeps WhatsApp for the messages that must reach. Free sends nothing through Meta, so nothing is paid to Meta.",
  forWho: "For the admin, and the director, data lead and pastor who can open the same pages",
  audience: ["admin"],
  seenBy: ["director", "data_lead", "pastor"],
  minutes: 7,
  art: "watch",
  ready: ["The WhatsApp safety net already On: WhatsApp mode needs it", "The price per message from Meta's rate card for Nigeria, if you want the cost page to be close"],
  whoSees: [
    "Members are never told which mode is chosen. In Saver or Free they get the same message by email, as they agreed.",
    "The director and the admin are emailed if the rule changes the mode by itself (the month's ceiling, or Meta rating the number Medium or Low).",
  ],
  ifDifferent: "If you cannot find WhatsApp mode, the owner has not opened it yet. It is opened from the owner’s console, under Features, after the WhatsApp safety net.",
  next: ["whatsapp-health"],
  parts: [
    {
      title: "Choose a mode",
      blurb: "The choice takes effect on the next message. No redeploy, and nothing is lost.",
      steps: [
        {
          id: "open-mode",
          title: "Open WhatsApp mode",
          do: ["Open **Admin**, then the **Message log**. Under its title, press [[WhatsApp mode]]."],
          tip: "The line at the top says which mode is in force and, in a few words, what that means.",
        },
        {
          id: "pick-mode",
          title: "Pick Full, Saver or Free",
          do: [
            "Press the mode you want. **Full** is as before: WhatsApp first, then email or text. **Saver** keeps WhatsApp for the messages that must reach and sends the weekly rhythm by email. **Free** sends nothing through Meta at all.",
            "A box asks why. Write a few words and press the button that says **Use** and the name of the mode.",
          ],
          example: "Watching the bill this month.",
          why: "The reason goes in the log, with your name, so whoever looks next knows what happened.",
          careful: "In Free the site makes no request to Meta, so the account is not checked and the test message is not sent. Leaders send WhatsApp themselves from their phones. WhatsApp sign-in codes work only on the ordinary-number route.",
        },
        {
          id: "week-would",
          title: "See what each mode would have done",
          do: ["Under **What each mode would have done to the last seven days**, read how many messages each would have kept on WhatsApp, and about what that saves."],
          tip: "It is worked out from the real messages of the last week, so it is a fair guide to what your choice will do.",
        },
      ],
    },
    {
      title: "Read what it costs",
      blurb: "An estimate from your own rates. Meta's invoice is the true figure.",
      steps: [
        {
          id: "enter-rate",
          title: "Enter Meta's price",
          do: ["Under **What Meta charges**, press [[Enter a new rate]]. Choose Utility or Marketing, type the price in US dollars from Meta's rate card, the date it starts, and press [[Save the rate]]."],
          why: "The site never asks Meta for prices. The estimate is only as good as the figures typed here, and the newest one that has started is used.",
          careful: "Whether the church qualifies for a nonprofit rate is a question for Meta, not for this page.",
        },
        {
          id: "cost-page",
          title: "Open the cost page",
          do: ["Press [[The cost page]] under **The month so far**. It lists each kind of message sent in the last 30 days, how many, and about what each cost, and shows how much of it Meta has filed as Marketing, which costs more."],
          tip: "The messages Meta files as Marketing are kept off WhatsApp automatically, whatever the mode.",
        },
        {
          id: "ceiling",
          title: "Set a monthly ceiling",
          do: ["Press [[Change the numbers]], type a ceiling in US dollars, and press [[Save]]. You are emailed at the warning percentage, and Full drops to Saver at the ceiling, once a month."],
          careful: "Nothing drops by itself if there is no ceiling. If you choose Full again after a drop, it stays until next month.",
        },
      ],
    },
    {
      title: "Keep the number safe",
      blurb: "These protect the sending number from the things that get numbers blocked.",
      steps: [
        {
          id: "protect",
          title: "Read the protections",
          do: ["Under **Protecting the number**, read the numbers. They hold the weekly rhythm to a message or two a week for each person, spread it across the hour and the day, and stop short of Meta's daily limit."],
          why: "A number that sends too much, too fast, to people who do not expect it, is the one that gets rated Low and then limited.",
          tip: "If Meta rates the number Medium, Full drops to Saver by itself. If it rates it Low, WhatsApp pauses itself. A person puts it back.",
        },
        {
          id: "classes",
          title: "Decide which messages must reach",
          do: ["Under **Which messages must reach**, open **Must reach (A)**. These stay on WhatsApp in Saver. Move a message to another class from the list beside it if you disagree."],
          careful: "A person with no other way to be reached still gets a class B or C message by WhatsApp in Saver. Nobody is left out.",
        },
        {
          id: "by-hand",
          title: "Message a leader yourself",
          do: ["Press [[Message a leader by hand]]. It lists the leaders and coaches who said yes to WhatsApp. Press one of their names: WhatsApp opens on your phone with the words ready."],
          why: "A person sending a message from their own phone is not a business message, and costs Meta nothing.",
          careful: "You never see a number. After you send, press [[Yes, I sent it]] so the log is right.",
        },
      ],
    },
  ],
};
