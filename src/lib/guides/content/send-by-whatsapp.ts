import type { Guide } from "../types";

/**
 * L9. For tribe leaders (and the assistant leader and coach, who can open the same page): posting the week's words to the tribe's WhatsApp group and
 * messaging a member who said yes to WhatsApp, from the leader's own phone. The page exists only once the owner has opened WhatsApp mode, so there are
 * no pictures of it.
 */
export const sendByWhatsapp: Guide = {
  code: "L9",
  slug: "send-by-whatsapp",
  title: "Send WhatsApp to your tribe yourself",
  lede: "The words are ready. You read them, change them if you like, and send them from your own WhatsApp.",
  forWho: "For tribe leaders, and the assistant leader and coach who can open the same page",
  audience: ["leader"],
  seenBy: ["assistant_leader", "coach"],
  minutes: 4,
  art: "run",
  ready: ["WhatsApp on your phone", "Your tribe's WhatsApp group link saved on your Tribe page, to post to the group"],
  whoSees: [
    "Members only see a message from you, from your own number, as they would from any friend. Nothing from this site is sent in your name.",
    "The church office sees how many chats you opened and whether you marked them sent. It never sees what you wrote.",
  ],
  ifDifferent: "If you cannot find Send by WhatsApp on your week page, the church has not switched it on yet. Your members still get their weekly messages by email.",
  next: [],
  parts: [
    {
      title: "Post to the group",
      blurb: "This week's passage and step, in words your tribe already knows.",
      steps: [
        {
          id: "open-hand",
          title: "Open Send by WhatsApp",
          do: ["Open **This week**, and press [[Send by WhatsApp]] at the top."],
        },
        {
          id: "post-group",
          title: "Copy the words and open the group",
          do: [
            "Choose what to post. Read the words and change anything you like.",
            "Press [[Copy and open the group]]. The words are copied, and your tribe's WhatsApp group opens on your phone. Paste, and press send.",
          ],
          careful: "Nothing is sent from this website. If the group did not open, use the link that appears under the button.",
        },
        {
          id: "mark-group",
          title: "Say whether you sent it",
          do: ["When WhatsApp opens, a box asks whether you sent it. Press [[Yes, I sent it]], or [[I left it]]."],
          why: "It keeps your list of what you have sent right, so you do not send the same thing twice.",
        },
      ],
    },
    {
      title: "Message someone",
      blurb: "For the member who has gone quiet, or who has just arrived.",
      steps: [
        {
          id: "choose-words",
          title: "Choose what to say",
          do: ["Under **Message someone yourself**, choose a welcome, a check-in after two missed weeks, a question about their step, or a thank-you. Change the words if you like; [first] becomes each person's first name."],
        },
        {
          id: "who-can",
          title: "See who you can message",
          do: ["Each member shows whether they said yes to WhatsApp, and whether their details are open to you. Only those who did can be messaged from here."],
          careful: "You never see a number on this page. If someone has not said yes, use another way to reach them, or leave them be.",
        },
        {
          id: "send-one",
          title: "Press their name",
          do: ["Press **Message** and their first name. WhatsApp opens on your phone with the words ready. Press send, then [[Yes, I sent it]]."],
          tip: "If the church has switched the site's own WhatsApp off, a list at the top names the members who could not be reached by email either. Start with them.",
        },
      ],
    },
  ],
};
