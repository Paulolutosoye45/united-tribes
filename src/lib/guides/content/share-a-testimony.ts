import type { Guide } from "../types";

/** M4. Telling what God has done, and reading what He is doing across the church. */
export const shareATestimony: Guide = {
  code: "M4",
  slug: "share-a-testimony",
  title: "Share a testimony",
  lede: "A few sentences about what God has done. Your leader reads it first, and you choose who else may.",
  forWho: "For every member in a tribe",
  audience: ["member"],
  minutes: 3,
  art: "testimony",
  ready: ["A few sentences, written in your own words.", "No other people’s names or private details."],
  ifDifferent: "The testimony page opens once your tribe’s season has begun. Before that, the button is not there.",
  next: ["your-week"],
  parts: [
    {
      title: "Write it",
      blurb: "Short is fine. Honest is better.",
      steps: [
        {
          id: "open-testimonies",
          title: "Open Testimonies",
          do: ["Open **My tribe**. Under your tribe’s name, press [[Testimonies]]."],
          shot: { cast: "tribe-member", path: "/tribe", ring: [{ role: "link", name: "Testimonies" }], tag: "Press", alt: "Your tribe’s page, with the Testimonies button ringed." },
        },
        {
          id: "write",
          title: "Write what God has done",
          do: ["Under **What has God done in your life this season?**, write a few sentences.", "Leave out other people’s names and private details."],
          example: "I had been afraid to ask for a raise for two years. This week I prayed about it with my tribe, asked, and my manager said yes. I am amazed.",
          shot: { cast: "tribe-member", path: "/tribe/testimony", ring: [{ label: "What has God done in your life this season?" }], tag: "In your words", alt: "A box for what God has done in your life this season." },
        },
      ],
    },
    {
      title: "Choose who reads it",
      blurb: "You decide. Nothing is shown until your leader has read it.",
      steps: [
        {
          id: "who-reads",
          title: "Choose who may read it",
          do: ["Under **Who may read it?**, choose [[My tribe]] or [[The whole church]].", "The church one is read by your leader and then a pastor."],
          shot: { cast: "tribe-member", path: "/tribe/testimony", ring: [{ role: "group", name: "Who may read it?" }], tag: "Your choice", alt: "Two choices: My tribe, or The whole church.", lead: 40, minHeight: 440 },
        },
        {
          id: "how-name-shows",
          title: "Choose how your name shows",
          do: ["Under **How should your name appear?**, choose [[My first name]], [[My full name]] or [[No name]]."],
          tip: "No name is always allowed.",
          shot: { cast: "tribe-member", path: "/tribe/testimony", ring: [{ role: "group", name: "How should your name appear?" }], tag: "Your choice", alt: "Three choices: first name, full name, no name.", lead: 40, minHeight: 440 },
        },
        {
          id: "send",
          title: "Send it for review",
          do: ["Press [[Send for review]]. You will see **Sent. Your leader will read it first.**"],
          shot: {
            cast: "tribe-member",
            path: "/tribe/testimony",
            before: [{ do: "fill", on: { label: "What has God done in your life this season?" }, value: "I had been afraid to ask for a raise for two years. This week I prayed about it with my tribe, asked, and my manager said yes. I am amazed." }],
            ring: [{ role: "button", name: "Send for review" }],
            tag: "Press",
            alt: "The Send for review button, once something is written.",
          },
        },
      ],
    },
    {
      title: "After you send",
      steps: [
        {
          id: "what-happens",
          title: "What happens next",
          do: ["Your testimony shows under **Yours** with where it is. You can press [[Withdraw]] at any time.", "To be encouraged yourself, open **What God is doing** and read what the church has shared."],
          timeline: [
            { when: "At once", what: "It shows under Yours as “Waiting for your leader”." },
            { when: "When your leader has read it", what: "It is shared with your tribe, or sent on to a pastor if you chose the whole church." },
            { when: "If it is not shared", what: "You see “Not shared”, and often a kind note from your leader about why." },
          ],
        },
      ],
    },
  ],
};
