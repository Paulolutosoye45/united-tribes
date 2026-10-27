import type { Guide } from "../types";
import { formTo } from "./_form";

const choice = (name: string, value: string) => ({ css: `label.choice:has(input[name="${name}"][value="${value}"])` });

/** M1. The form every member fills in once. */
export const findYourTribe: Guide = {
  code: "M1",
  slug: "find-your-tribe",
  title: "Find your tribe: the form",
  lede: "A few questions about your season and your goal, and we show you three tribes that fit.",
  forWho: "For every member",
  audience: ["member"],
  minutes: 5,
  art: "form",
  ready: [
    "About **four minutes**. Your answers save as you go, so you can stop and come back.",
    "An idea of what you want to move forward this season.",
    "A quiet moment. You can speak your story instead of typing it.",
  ],
  ifDifferent: "If a question on your screen is not in this guide, answer it the same way: there is no test and no wrong answer. If something looks broken, ask your tribe leader or the church office.",
  next: ["join-your-tribe", "your-week"],
  parts: [
    {
      title: "Answer the questions",
      blurb: "One question to a screen. Tap, type or speak.",
      steps: [
        {
          id: "start",
          title: "Open Find your tribe",
          do: ["On **Home** or **My tribe**, press [[Start]]."],
          shot: { cast: "new-member", path: "/tribe", ring: [{ role: "link", name: "Start" }], tag: "Press", alt: "The Find your tribe page, with the Start button ringed." },
        },
        {
          id: "agree",
          title: "Say what you agree to",
          do: ["Read who sees what.", "Tick the first box. It is needed to go on. The second is up to you.", "Press [[I agree, let’s begin]]."],
          tip: "You can change either choice later, in Privacy and my data.",
          why: "What you say about needing extra care is locked, so only you can read it.",
          shot: {
            cast: "new-member",
            path: "/join",
            frame: "screen",
            ring: [choice("consent-matching", "yes")],
            second: [{ role: "button", name: "I agree, let’s begin" }],
            tag: "Tick this",
            alt: "The agreement, with the first box ringed and the Begin button below it.",
          },
        },
        {
          id: "age",
          title: "Choose your age group",
          do: ["Tap the group you are in.", "Tick the extra box if you would also be happy in the group before or after."],
          shot: { cast: "new-member", path: "/join", before: formTo("age"), frame: "screen", ring: [{ role: "heading", name: "How old are you?" }, choice("age", "33-40")], tag: "Your age", alt: "The age question, with the age groups ringed." },
        },
        {
          id: "where",
          title: "Say where you live",
          do: ["Start typing your area, such as **Yaba**.", "Pick it from the list. Your zone fills in by itself."],
          shot: {
            cast: "new-member",
            path: "/join",
            before: [...formTo("where"), { do: "fill", on: { role: "combobox", name: /./ }, value: "Yab" }, { do: "wait", on: { role: "option", name: /Yaba/ } }],
            frame: "screen",
            ring: [{ role: "combobox", name: /./ }],
            tag: "Type here",
            alt: "The area box, with the first letters typed and Yaba offered in a list.",
          },
        },
        {
          id: "story",
          title: "Tell us about your season",
          do: ["Write a few sentences about your life right now: family, work, what is hard, what you hope for.", "Or press the microphone and talk for up to a minute. It is turned into words for you."],
          tip: "Short is fine. There is no right answer.",
          shot: {
            cast: "new-member",
            path: "/join",
            before: formTo("story"),
            frame: "screen",
            ring: [{ css: "textarea[name=story]" }],
            second: [{ role: "button", name: /Record a voice note/ }],
            tag: "Your words",
            alt: "The story box, with the voice note button beside it.",
          },
        },
        {
          id: "heard",
          title: "Check what we heard",
          do: ["We tick what we think you said. Change anything that is wrong.", "Hard answers are there to choose, but we never choose them for you."],
          shot: { cast: "new-member", path: "/join", before: formTo("heard"), frame: "screen", ring: [{ role: "heading", name: "Here is what we heard." }], tag: "Check", alt: "The Here is what we heard screen, with ticked answers." },
        },
        {
          id: "community",
          title: "Choose your community",
          do: ["Choose the community that feels like home right now.", "Then pick a second one, in case your first has no room."],
          shot: { cast: "new-member", path: "/join", before: formTo("community"), frame: "screen", ring: [choice("community", "professionals")], tag: "Your choice", alt: "The list of communities, with one ringed." },
        },
        {
          id: "goal",
          title: "Pick your goal for the season",
          do: ["Choose what you most want to move forward over the next twelve weeks.", "Your tribe is built round this goal."],
          shot: { cast: "new-member", path: "/join", before: formTo("goal"), frame: "screen", ring: [choice("goal", "step-into-a-leadership-role")], tag: "Your goal", alt: "The list of goals, with one ringed." },
        },
        {
          id: "rhythm",
          title: "Say when you can meet",
          do: ["Choose how you would like to meet: online, in person, or either works.", "Tick every time that could work. More times means better matches."],
          shot: { cast: "new-member", path: "/join", before: formTo("rhythm"), frame: "screen", ring: [{ role: "radiogroup", name: "How you would like to meet" }], second: [{ role: "heading", name: "When could you meet?" }], tag: "How, then when", alt: "The question about how and when you could meet: online, in person or either, and the times." },
        },
        {
          id: "care",
          title: "Tell us what you need, privately",
          do: ["Tick anything you would like us to know, and write a note for the office or for your leader.", "Only you can read what you say about needing extra care. Your leader sees only the note you write for them."],
          careful: "Write nothing here you would not want your leader to read, except in the box marked for the office.",
          shot: { cast: "new-member", path: "/join", before: formTo("care"), frame: "screen", ring: [{ role: "heading", name: "Anything you would like us to know?" }], tag: "Private", alt: "The screen where you can tell us what you need, privately." },
        },
        {
          id: "save",
          title: "Check, then save",
          do: ["Look through your answers.", "Press [[Save my answers]]."],
          shot: { cast: "new-member", path: "/join", before: formTo("review"), frame: "screen", ring: [{ role: "button", name: "Save my answers" }], tag: "Press", alt: "The last screen, with the Save my answers button ringed." },
        },
      ],
    },
    {
      title: "What happens next",
      blurb: "You do not wait for anyone.",
      steps: [
        {
          id: "three-tribes",
          title: "You see three tribes that fit",
          do: ["You land on **Three tribes that fit you**, each with its own percentage.", "Choose the one you want to walk with for twelve weeks."],
          timeline: [
            { when: "At once", what: "Three tribes appear, best fit first. Each percentage is for that tribe alone." },
            { when: "Your next step", what: "Choose one and join it. The next guide shows you how." },
          ],
          shot: { cast: "member", path: "/tribe", ring: [{ role: "heading", name: "Three tribes that fit you" }], tag: "Your tribes", alt: "The page that shows three tribes that fit you.", minHeight: 640 },
        },
      ],
    },
  ],
};
