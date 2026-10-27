import type { Guide, Shot } from "../types";

/** L3. The Leader Academy: six modules, the safeguarding declaration, two workshops and a practice session. */

/** Folake, once a pastor has approved her, at a named place in her training ("academy-is:<where>"). */
const at = (where: string, rest: Omit<Shot, "cast" | "arrange">): Shot => ({
  cast: "leader-in-training",
  arrange: `academy-is:${where}`,
  ...rest,
});

export const leaderAcademy: Guide = {
  code: "L3",
  slug: "leader-academy",
  title: "Your training: the Academy and the safeguarding declaration",
  lede: "Six short modules, one declaration, two live workshops and a practice session. Here is how to move through them, and what each screen tells you.",
  forWho: "For leaders who have been approved",
  audience: ["leader", "assistant_leader"],
  minutes: 8,
  art: "learn",
  ready: ["About ten hours across a few weeks. You can stop in the middle of a module and come back.", "A phone or a computer. Both work the same."],
  ifDifferent: "The church can ask for fewer things (for example the declaration only), so your training page may list fewer steps. Do what yours lists.",
  next: ["run-your-week"],
  parts: [
    {
      title: "The six modules",
      blurb: "Read a short lesson, then a short quiz. 80% or better passes.",
      steps: [
        {
          id: "open-training",
          title: "Open your training",
          do: ["Press [[Lead]] at the bottom of your screen, then [[Open my training]]."],
          shot: { cast: "leader-in-training", path: "/lead", arrange: "academy-is:fresh", ring: [{ role: "link", name: "Open my training" }], tag: "Press", alt: "The Lead page after you are approved, with the Open my training button ringed.", lead: 250, minHeight: 560 },
        },
        {
          id: "what-it-needs",
          title: "See what certification needs",
          do: ["The top says how many parts are done, for example **0 of 4 done**, and the one thing to do next.", "The list under **What certification needs** ticks itself as you go."],
          shot: at("fresh", { path: "/lead/academy", ring: [{ role: "heading", name: "What certification needs" }], tag: "Your list", alt: "The training page: how many parts are done, and the list of what certification needs.", minHeight: 520, lead: 380 }),
        },
        {
          id: "start-module",
          title: "Start module 1",
          do: ["Press the big button at the top. It always takes you to the next thing you need to do.", "You can also open any module from the grid further down."],
          shot: at("fresh", { path: "/lead/academy", frame: "screen", ring: [{ role: "link", name: "Start", exact: true }], tag: "Press", alt: "The training page, with the Start button for module 1." }),
        },
        {
          id: "read",
          title: "Read the lesson",
          do: ["Each module has a few short sections and a small thing to try. Read at your own pace.", "Come back to the lesson whenever you like, even after the quiz."],
          shot: at("fresh", { path: "/lead/academy/the-why", ring: [{ css: "main h1" }], tag: "Module 1", alt: "The first module, The why: its title and what you will be able to do after it.", minHeight: 420, lead: 40 }),
        },
        {
          id: "quiz-start",
          title: "Start the quiz",
          do: ["When you have read the lesson, press [[Start the quiz]] at the bottom. 80% passes, and you can read the lesson again whenever you like."],
          why: "The quiz is there to help you remember, not to catch you out.",
          shot: at("fresh", { path: "/lead/academy/the-why", ring: [{ role: "button", name: "Start the quiz" }], tag: "Press", alt: "The bottom of a module, with the Start the quiz button.", minHeight: 360, lead: 110 }),
        },
        {
          id: "quiz",
          title: "Answer, one at a time",
          do: ["Tap one answer, then press [[Next]]. After the last question, press **Check my answers**.", "If you miss, we show you what to read again, and you can try again straight away."],
          shot: at("fresh", {
            path: "/lead/academy/the-why",
            before: [{ do: "click", on: { role: "button", name: "Start the quiz" } }, { do: "wait", on: { role: "button", name: "Next" } }],
            frame: "screen",
            ring: [{ css: "fieldset" }],
            second: [{ role: "button", name: "Next" }],
            tag: "Tap one",
            alt: "A quiz question with its answers, and the Next button.",
          }),
        },
        {
          id: "badges",
          title: "Watch the badges fill in",
          do: ["Each module you pass shows **Passed** with your best score. A module you have not passed shows **Not started** or **Started**.", "Do them in any order, but the safeguarding module comes before the declaration."],
          shot: at("five-passed", { path: "/lead/academy", ring: [{ role: "heading", name: "Six modules" }, { css: "#modules ol li" }], tag: "Five passed", alt: "The six modules, five of them marked Passed with a score, one not started.", minHeight: 420, lead: 60 }),
        },
      ],
    },
    {
      title: "The safeguarding declaration",
      blurb: "Eight promises to the people in your tribe. It takes a minute, and you mean every word.",
      steps: [
        {
          id: "declaration-opens",
          title: "Find it when the modules are done",
          do: ["When the last module is passed, the top of your training page changes to **Sign the safeguarding declaration**.", "Press [[Read and sign]]."],
          shot: at("all-passed", { path: "/lead/academy", frame: "screen", ring: [{ role: "link", name: "Read and sign" }], tag: "Press", alt: "The training page when all six modules are passed, with the Read and sign button." }),
        },
        {
          id: "declaration-read",
          title: "Read the eight promises",
          do: ["Read them slowly. They protect the people in your tribe, and you.", "Your coach has the same words."],
          shot: at("all-passed", { path: "/lead/academy/declaration", ring: [{ css: "main h1" }], tag: "Eight promises", alt: "The eight safeguarding promises, numbered.", minHeight: 600, lead: 40 }),
        },
        {
          id: "declaration-sign",
          title: "Tick the box, type your name, sign",
          do: ["Tick that you have read them and you make them.", "Type your first and last name, then press [[Sign the declaration]]."],
          careful: "Your first **and** last name, with a space between. The button stays grey until both are in.",
          shot: at("all-passed", {
            path: "/lead/academy/declaration",
            before: [
              { do: "check", on: { role: "checkbox", name: /I have read these eight promises/ } },
              { do: "fill", on: { label: "Type your first and last name to sign" }, value: "Folake Example" },
              { do: "wait", on: { role: "button", name: "Sign the declaration" } },
            ],
            frame: "screen",
            ring: [{ role: "button", name: "Sign the declaration" }],
            second: [{ label: "Type your first and last name to sign" }],
            tag: "Press",
            alt: "The tick box, the name box filled in, and the Sign the declaration button.",
          }),
        },
        {
          id: "declaration-signed",
          title: "You have signed",
          do: ["You will see **Signed. Thank you.** The checklist on your training page now shows the declaration as signed."],
          shot: at("all-passed", {
            path: "/lead/academy/declaration",
            before: [
              { do: "check", on: { role: "checkbox", name: /I have read these eight promises/ } },
              { do: "fill", on: { label: "Type your first and last name to sign" }, value: "Folake Example" },
              { do: "click", on: { role: "button", name: "Sign the declaration" } },
              { do: "wait", on: { role: "heading", name: "Signed. Thank you." } },
            ],
            ring: [{ role: "heading", name: "Signed. Thank you." }],
            tag: "Done",
            alt: "The Signed. Thank you. screen, with the button back to your training.",
            minHeight: 360,
          }),
        },
      ],
    },
    {
      title: "Workshops and practice",
      blurb: "Two live sessions, and one practice meeting with a coach watching.",
      steps: [
        {
          id: "workshops",
          title: "Choose your two workshops",
          do: ["Under **Two live workshops**, each workshop shows the dates the office has opened.", "Press [[Book]] on a date that suits you. You can change it later with **Cancel**."],
          shot: at("signed+workshops", { path: "/lead/academy", ring: [{ role: "heading", name: "Two live workshops" }], tag: "Two workshops", alt: "The two workshops, each with dates and a Book button.", minHeight: 560, lead: 40 }),
        },
        {
          id: "booked",
          title: "See it booked",
          do: ["A booked workshop shows **Booked**, with the place, and a Cancel button in case you need to change."],
          shot: at("signed+workshops", {
            path: "/lead/academy",
            before: [{ do: "click", on: { role: "button", name: "Book" } }, { do: "wait", on: { role: "button", name: "Cancel" } }],
            ring: [{ role: "button", name: "Cancel" }],
            tag: "Booked",
            alt: "A workshop booked, with its place and the Cancel button.",
            minHeight: 520,
          }),
        },
        {
          id: "practice",
          title: "Your practice session",
          do: ["After the first workshop your coach arranges a practice meeting with you, about 75 minutes. There is nothing to book.", "When you can run a meeting with care, your coach marks you ready. You will see their note here."],
          shot: at("signed", { path: "/lead/academy", ring: [{ role: "heading", name: "Practice session" }], tag: "From your coach", alt: "The practice session box: your coach arranges it, and their note appears here.", minHeight: 400 }),
        },
        {
          id: "then-card",
          title: "Then your Tribe Card",
          do: ["Certification also needs a Tribe Card a pastor approves. Press [[My Tribe Card]] on your Lead page when you are ready.", "The next guide shows how a week runs once your tribe has begun."],
          shot: { cast: "leader-in-training", path: "/lead", arrange: "academy-is:signed", ring: [{ role: "link", name: "My Tribe Card" }], tag: "Next", alt: "The Lead page, with My Tribe Card ringed.", lead: 330, minHeight: 560 },
        },
      ],
    },
  ],
};
