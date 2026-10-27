import type { Guide, Shot } from "../types";

/** L1. Applying to lead a tribe, screen by screen. */

const draft = (step: string, rest: Omit<Shot, "cast" | "path" | "arrange" | "frame">): Shot => ({
  cast: "applicant",
  path: "/lead/apply",
  arrange: `application-is:draft@${step}`,
  frame: "screen",
  ...rest,
});

export const applyToLead: Guide = {
  code: "L1",
  slug: "apply-to-lead",
  title: "Apply to lead a tribe",
  lede: "About fifteen minutes on your phone. Every answer saves as you go, so you can stop and come back.",
  forWho: "For members who want to lead",
  audience: ["member"],
  minutes: 15,
  art: "apply",
  ready: ["Fifteen minutes, in one go or in two.", "The names and numbers of two people who know you. One must be a pastor or unit head.", "Your own phone: a code goes to the people who speak for you, never to you."],
  ifDifferent: "The office can turn a question or a step on or off, so your screens may skip one of these. Do what yours asks. If something looks wrong, tell the church office.",
  shortcut: { label: "I have started. Take me to the people who speak for me", toStep: "ref1" },
  next: ["after-you-apply"],
  parts: [
    {
      title: "Start",
      blurb: "Four short screens, and you are in.",
      steps: [
        {
          id: "open-lead",
          title: "Open Lead",
          do: ["Press [[Lead]] at the bottom of your screen, then [[Start my application]]."],
          tip: "If you already lead one tribe, the button says Lead another tribe.",
          shot: { cast: "member", path: "/lead", ring: [{ role: "link", name: "Start my application" }], tag: "Press", alt: "The Lead a tribe page, with the Start my application button ringed.", lead: 40 },
        },
        {
          id: "welcome",
          title: "Read how it works, then agree",
          do: ["Read the five stages. Tick your agreement.", "Press [[I agree, start my application]]."],
          why: "Only the review panel sees your application, and you can delete it any time before you are approved.",
          shot: { cast: "member", path: "/lead/apply", frame: "screen", ring: [{ role: "button", name: "I agree, start my application" }], tag: "Tick, then press", alt: "The first screen: how it works, your agreement and the button to start." },
        },
        {
          id: "eligibility",
          title: "Answer seven quick questions",
          do: ["Tap **Yes** or **Not yet** on each.", "Every answer needs to be Yes to lead. If one is not yet, we will show you another way to serve."],
          shot: draft("eligibility", { ring: [{ role: "heading", name: "First, seven quick questions." }], tag: "Seven taps", alt: "Seven yes or not yet questions, such as: are you 21 or older?" }),
        },
        {
          id: "contact",
          title: "Give your WhatsApp number",
          do: ["Type the number the panel can reach you on, then press [[Continue]].", "It is used for your interview and the result. Nothing else, and no groups."],
          shot: draft("contact", { ring: [{ label: "WhatsApp number" }], tag: "Your number", alt: "The WhatsApp number box." }),
        },
      ],
    },
    {
      title: "Your calling",
      blurb: "Where you belong, and what God has done in you.",
      steps: [
        {
          id: "track",
          title: "Choose your stage of life",
          do: ["Tap the stage you are in. You will lead people in the same stage."],
          shot: draft("track", { ring: [{ role: "heading", name: "Which stage of life are you in?" }], tag: "Tap one", alt: "The stages of life to choose from, each with an age range." }),
        },
        {
          id: "community",
          title: "Choose your home community",
          do: ["Tap the community closest to your field or season."],
          shot: draft("community", { ring: [{ role: "heading", name: "Which community is home for you?" }], tag: "Tap one", alt: "The communities to choose from." }),
        },
        {
          id: "goal",
          title: "Choose a Season Goal",
          do: ["Tap the goal you could lead a tribe toward.", "Then say where you are with it: still pursuing it, or already further on."],
          shot: draft("goal", { ring: [{ role: "heading", name: "Which Season Goal could you lead a tribe toward?" }], tag: "Tap one", alt: "The Season Goals for your community." }),
        },
        {
          id: "goal-story",
          title: "Tell your story with this goal",
          do: ["In about five sentences: where you started, what happened, what you learned.", "Be specific. Names and places help. Or press the microphone and speak."],
          example: "In 2022 I was moved from analyst to team lead, with six people and no training. I micromanaged out of fear. I asked my manager for a weekly check-in and started asking my team what they needed. I learned that leading is mostly listening.",
          shot: draft("goal-story", { ring: [{ label: "Your story" }], tag: "In your words", alt: "A large box for your story with this goal." }),
        },
        {
          id: "why",
          title: "Say why you want to lead",
          do: ["Tell us what you hope for the people in your tribe.", "We read for who it is about: them or you."],
          shot: draft("why", { ring: [{ label: "Why you want to lead" }], tag: "In your words", alt: "A large box for why you want to lead." }),
        },
        {
          id: "walked",
          title: "Tell us about walking with someone",
          do: ["Think of a time you stayed with someone through a hard season.", "Say what you did, and what you chose **not** to do."],
          shot: draft("walked", { ring: [{ label: "A time you walked with someone" }], tag: "A real time", alt: "A large box for a time you walked with someone." }),
        },
        {
          id: "walk",
          title: "Rate your walk with God, honestly",
          do: ["Tap a number from 1 to 5, then say a little about why."],
          why: "Honest beats high. The panel is looking for honesty, not a perfect score.",
          shot: draft("walk", { ring: [{ role: "heading", name: "How is your walk with God right now?" }], tag: "Honest, not high", alt: "A one to five scale for your walk with God, and a box to say why." }),
        },
        {
          id: "obstacles",
          title: "Name what could get in the way",
          do: ["Work, travel, family, your own energy. Say what you would do about each."],
          tip: "Naming it helps us plan with you, and it will not count against you.",
          shot: draft("obstacles", { ring: [{ label: "What could get in the way" }], tag: "Be plain", alt: "A large box for what could get in the way of leading for twelve weeks." }),
        },
      ],
    },
    {
      title: "Your judgement",
      blurb: "Six situations, and a few quick taps.",
      steps: [
        {
          id: "situations",
          title: "Choose the best and the worst response",
          do: ["Each situation has four responses. Tap the **best**, then the **worst**.", "There are six. You are not graded on speed."],
          shot: draft("s1", { ring: [{ css: "main h1" }], tag: "Best and worst", alt: "A situation in a tribe, with four responses to choose from." }),
        },
        {
          id: "style",
          title: "This or that?",
          do: ["Six quick taps. There are no right answers.", "We use them to pair you with an assistant leader who balances you. They never count for or against you."],
          shot: draft("style", { ring: [{ role: "heading", name: "This or that?" }], tag: "Six taps", alt: "Six this-or-that choices." }),
        },
        {
          id: "lead-best",
          title: "Say how you lead best",
          do: ["Tap the one that sounds most like you."],
          tip: "Your assistant leader will be strong where you are not.",
          shot: draft("lead-best", { ring: [{ role: "heading", name: "I lead best by…" }], tag: "Tap one", alt: "Four ways of leading to choose from." }),
        },
      ],
    },
    {
      title: "People who know you",
      blurb: "Two people speak for you, and then you send it.",
      steps: [
        {
          id: "ref1",
          title: "Name the first person",
          do: ["Give their name, how you know them, and **their** phone or email, not yours.", "Tick the box if they are a pastor or unit head."],
          why: "After you send, we message them a private link and a code ourselves. They answer four short questions, and you never see what they say.",
          shot: draft("ref1", { ring: [{ role: "heading", name: "Who can speak for you?" }], tag: "Their details", alt: "The first person who can speak for you: name, how you know them, phone or email." }),
        },
        {
          id: "ref2",
          title: "Name a second person",
          do: ["Someone different, who knows you in another setting.", "One of your two must be a pastor or unit head."],
          shot: draft("ref2", { ring: [{ role: "heading", name: "And a second person." }], tag: "Their details", alt: "The second person who can speak for you." }),
        },
        {
          id: "review",
          title: "Read it through, then send",
          do: ["Read your application. Tap **Change** on anything you would like to fix.", "Press [[Send my application]]. After you send, your answers are locked."],
          careful: "Check the two phone numbers or emails. A wrong one means your referee never gets the link.",
          shot: draft("review", { ring: [{ role: "button", name: "Send my application" }], tag: "Last step", alt: "Your whole application, ready to read through, with the Send my application button." }),
        },
        {
          id: "sent",
          title: "You have sent it",
          do: ["You will see **Sent**. Press [[Ask my referees]] to go on.", "That is the next guide: how your two people are asked, and what comes after."],
          shot: draft("review", {
            before: [{ do: "click", on: { role: "button", name: "Send my application" } }, { do: "wait", on: { role: "heading", name: /^Sent,/ } }],
            ring: [{ role: "link", name: "Ask my referees" }],
            tag: "Press",
            alt: "The Sent screen, with the Ask my referees button.",
          }),
        },
      ],
    },
  ],
};
