import type { Guide } from "../types";

/** M2. From the three tribes that fit to being a member of one. */
export const joinYourTribe: Guide = {
  code: "M2",
  slug: "join-your-tribe",
  title: "Join your tribe",
  lede: "Look at the three tribes that fit you, choose one, and join it.",
  forWho: "For every member",
  audience: ["member"],
  minutes: 4,
  art: "tribe",
  ready: ["You have answered the form in the guide before this one.", "A look at your week: when could you meet?"],
  ifDifferent: "If you do not see three tribes, you may not have saved your answers yet (see the form guide), or your age group may need a parent’s permission first. Ask your tribe leader or the church office.",
  next: ["your-week", "find-your-tribe"],
  parts: [
    {
      title: "Choose",
      blurb: "Take your time. Nobody is told until you join.",
      steps: [
        {
          id: "read-the-three",
          title: "Read your three tribes",
          do: ["Each card is one tribe. The percentage is for that tribe alone, so two can both score high."],
          shot: { cast: "member", path: "/tribe", ring: [{ css: "article", nth: 0 }], tag: "A tribe", alt: "The first of three tribe cards, with its percentage." },
        },
        {
          id: "why-it-fits",
          title: "See why it fits you",
          do: ["Read **Why it fits you**. It says what you have in common: your goal, your stage of life, your community."],
          shot: { cast: "member", path: "/tribe", ring: [{ text: "Why it fits you" }], tag: "Why", alt: "The Why it fits you list on a tribe card." },
        },
        {
          id: "meets",
          title: "Check when and where it meets",
          do: ["Look at **Meets** and **Where**. Be honest: could you come, most weeks?"],
          tip: "A tribe you can come to every week is better than a perfect one you cannot.",
          shot: { cast: "member", path: "/tribe", ring: [{ text: "Meets" }, { text: "Where", exact: true }], tag: "Can you come?", alt: "The meeting day, time and place on a tribe card." },
        },
        {
          id: "choose-it",
          title: "Press Choose this tribe",
          do: ["When you know which one, press [[Choose this tribe]] under it."],
          shot: { cast: "member", path: "/tribe", ring: [{ role: "link", name: "Choose this tribe" }], tag: "Press", alt: "The Choose this tribe button under a tribe." },
        },
      ],
    },
    {
      title: "Join",
      blurb: "Read what you are agreeing to, then say yes.",
      steps: [
        {
          id: "success-picture",
          title: "Read the Success Picture",
          do: ["This is what the tribe is working toward by week 12.", "In week 1 you will refine it together."],
          shot: { cast: "member", path: "@choose-tribe", ring: [{ role: "heading", name: "The Success Picture" }], tag: "The goal", alt: "The tribe’s Success Picture: loving God, loving others, loving life." },
        },
        {
          id: "covenant",
          title: "Read the Tribe Covenant",
          do: ["Four promises you make to each other. Read them before you agree."],
          shot: { cast: "member", path: "@choose-tribe", ring: [{ role: "heading", name: "The Tribe Covenant" }], tag: "Four promises", alt: "The Tribe Covenant, with four numbered promises.", lead: 60, minHeight: 520 },
        },
        {
          id: "join",
          title: "Tick the box and join",
          do: ["Tick the box to agree.", "Press [[Join this tribe]]. Your leader sees your name, and your number only if you said yes to WhatsApp."],
          shot: { cast: "member", path: "@choose-tribe", ring: [{ role: "checkbox", name: /I agree/ }], second: [{ role: "button", name: "Join this tribe" }], tag: "Tick", alt: "The agreement box, with the Join this tribe button below it." },
        },
      ],
    },
    {
      title: "If it is not right",
      blurb: "You are not stuck with the first screen.",
      steps: [
        {
          id: "look-again",
          title: "Look again, or change your answers",
          do: ["Not what you hoped for? Press [[Look again]] to see the tribes again.", "Or press [[Change my answers]] to answer the form differently."],
          shot: { cast: "member", path: "/tribe", ring: [{ role: "button", name: "Look again" }, { role: "link", name: "Change my answers" }], tag: "Not right?", alt: "The Look again and Change my answers buttons at the bottom of the page." },
        },
      ],
    },
  ],
};
