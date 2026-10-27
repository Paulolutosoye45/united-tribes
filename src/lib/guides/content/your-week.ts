import type { Guide } from "../types";

/** M3. What a member does each week once the season has begun. */
export const yourWeek: Guide = {
  code: "M3",
  slug: "your-week",
  title: "Your week in your tribe",
  lede: "Each week your tribe’s page tells you what to do. It takes about ten minutes, and a few more in the Word.",
  forWho: "For every member",
  audience: ["member"],
  minutes: 5,
  art: "week",
  ready: ["You have joined a tribe (see the guide on joining).", "Your phone, once a day, for a minute."],
  ifDifferent: "Your tribe’s page changes a little each week, and some boxes appear only when they are needed. Do what the top of the page asks and you are right.",
  next: ["share-a-testimony"],
  parts: [
    {
      title: "Each week",
      blurb: "The page at the top tells you what to do first.",
      steps: [
        {
          id: "open-tribe",
          title: "Open your tribe",
          do: ["Press [[My tribe]] at the bottom of your screen. Once the season has begun, this page is your week."],
          shot: { cast: "tribe-member", path: "/home", frame: "screen", ring: [{ role: "link", name: "My tribe" }], tag: "Press", alt: "The bottom menu, with My tribe ringed." },
        },
        {
          id: "this-week",
          title: "See which week it is",
          do: ["The top of the page gives the week, its theme, and when your tribe meets."],
          shot: { cast: "tribe-member", path: "/tribe", ring: [{ css: "#week-heading" }], tag: "This week", alt: "The top of the tribe page: the week, its theme and the meeting time.", lead: 60 },
        },
        {
          id: "for-you-now",
          title: "Do what it asks first",
          do: ["Under **For you right now** are the one or two things waiting for you. Each has a button."],
          shot: { cast: "tribe-member", path: "/tribe", ring: [{ role: "heading", name: "For you right now" }, { role: "link", name: "Choose my step" }], tag: "Start here", alt: "The For you right now box, with its buttons." },
        },
        {
          id: "where-starting",
          title: "Say where you are",
          do: ["Answer five quick questions about how you feel in your tribe and in your walk.", "Press [[Send my answers]]."],
          why: "Your leader sees these to know how to help. Nothing you write is shared beyond them.",
          shot: { cast: "tribe-member", path: "/tribe", ring: [{ role: "heading", name: "Where are you starting?" }], tag: "Five taps", alt: "The Where are you starting questions, as one to five scales." },
        },
        {
          id: "your-step",
          title: "Choose one small step",
          do: ["Write **when** you will do it and **what** you will do.", "Press [[Save my step]]. Small enough for your worst day."],
          example: "When I get into the car in the morning, I will read one chapter and pray for two minutes.",
          shot: { cast: "tribe-member", path: "/tribe", ring: [{ role: "heading", name: "Your step this week" }, { role: "button", name: "Save my step" }], tag: "Your step", alt: "The step box: when I will do it and what I will do." },
        },
        {
          id: "word-days",
          title: "Count your days in the Word",
          do: ["Tap how many days this week you read or prayed with the Word.", "Be honest. It is your number, not a score."],
          shot: { cast: "tribe-member", path: "/tribe", ring: [{ role: "heading", name: "In the Word this week" }], tag: "Tap a number", alt: "Buttons for 0 to 7 days in the Word." },
        },
        {
          id: "come-ready",
          title: "Read what the week is about",
          do: ["Under **What this week is about** are the questions your tribe will talk about.", "Look at them before you meet."],
          shot: { cast: "tribe-member", path: "/tribe", ring: [{ role: "heading", name: "What this week is about" }], tag: "Before you meet", alt: "The questions to come ready to talk about, and this week’s practice." },
        },
      ],
    },
    {
      title: "Over the twelve weeks",
      blurb: "You can see where you are, and ask for a change.",
      steps: [
        {
          id: "twelve-weeks",
          title: "Watch your twelve weeks",
          do: ["**Your twelve weeks** shows each week. Tap one to read it.", "**Your season so far** shows your own numbers, once there are a few weeks."],
          shot: { cast: "tribe-member", path: "/tribe", ring: [{ role: "heading", name: "Your twelve weeks" }], tag: "Tap a week", alt: "The twelve weeks, with this week marked." },
        },
        {
          id: "different-tribe",
          title: "If it is not the right tribe",
          do: ["Press [[Ask for a different tribe]]. Your leader will not be told why."],
          tip: "In the first 4 weeks you can ask. Later, speak to your coach or the church office.",
          shot: { cast: "tribe-member", path: "/tribe", ring: [{ role: "button", name: "Ask for a different tribe" }], tag: "If needed", alt: "The Ask for a different tribe button at the bottom of the page." },
        },
      ],
    },
  ],
};
