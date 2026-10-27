import type { Action, Guide, Shot } from "../types";

/** O2. For a parent or guardian: the private link in the email when a young person asks to join a tribe. */

const parent = (rest: Omit<Shot, "cast" | "path"> & { path?: string }): Shot => ({ cast: "parent", path: "@guardian", ...rest });
const ticked: Action[] = [{ do: "check", on: { role: "checkbox", name: /I am this young person’s parent or legal guardian/ } }];

export const parentPermission: Guide = {
  code: "O2",
  slug: "parent-permission",
  title: "Give permission for a young person",
  lede: "A young person you look after has asked to join a tribe. Read what you are agreeing to, then say yes or no. You can change your mind at any time, with the same link.",
  forWho: "For a parent or guardian",
  audience: ["member"],
  seenBy: ["leader", "care_lead", "director", "admin"],
  public: true,
  minutes: 4,
  art: "consent",
  ready: ["The email from The Covenant Nation, with your private link", "A few minutes to read the nine points"],
  ifDifferent: "If the page says the link has expired, ask your child to send you a new one from their tribe page. The Care Team can also help.",
  next: [],
  parts: [
    {
      title: "Read before you answer",
      blurb: "Nothing is decided until you press a button, and you can come back to the link later.",
      steps: [
        {
          id: "open",
          title: "Open the link in your email",
          do: ["Open the link in the email we sent you. It names your child, and you do not need an account.", "The top says who has asked: **would like to join a tribe**, with their first name."],
          shot: parent({ frame: "screen", ring: [{ role: "heading", name: /would like to join a tribe/ }], tag: "Your child", alt: "The permission page, with the heading naming the young person who would like to join a tribe." }),
        },
        {
          id: "read",
          title: "Read what you are agreeing to",
          do: ["**What you are agreeing to** has nine short points. They cover who leads the tribe, that your child is only placed with their own age group, and who sees their details.", "Take your time. The last points say how to take your permission back."],
          shot: parent({ ring: [{ role: "heading", name: "What you are agreeing to" }], tag: "Nine points", alt: "What you are agreeing to: the first of nine points, about a small group, two adult leaders and their own age group.", minHeight: 700, lead: 24 }),
        },
        {
          id: "care-team",
          title: "Know that we will speak to you",
          do: ["A member of the Care Team will phone or write to you, using the details we were given, to check that the answer is really yours.", "Your child cannot be placed in a tribe until we have spoken to you."],
          shot: parent({ ring: [{ text: "A member of our Care Team will phone or write to you" }], tag: "We will call", alt: "The sixth point: a member of the Care Team will phone or write to you before your child is placed.", minHeight: 520, lead: 160 }),
        },
      ],
    },
    {
      title: "Your answer",
      blurb: "Say that you are their parent or guardian, then yes or no.",
      steps: [
        {
          id: "confirm",
          title: "Say that you are their parent or guardian",
          do: ["Tick the box that starts **I am this young person’s parent or legal guardian**.", "The yes button stays grey until you have ticked it."],
          shot: parent({ before: ticked, ring: [{ role: "checkbox", name: /I am this young person’s parent or legal guardian/ }], tag: "Tick", alt: "The box that says you are the parent or legal guardian, ticked.", minHeight: 420, lead: 140 }),
        },
        {
          id: "note",
          title: "Add a note if you like",
          do: ["Under [[Anything you would like us to know]], you can write what will help, such as the best time to phone you.", "Only the Care Team can read it."],
          example: "Please phone after 6pm.",
          shot: parent({ before: [...ticked, { do: "fill", on: { label: "Anything you would like us to know" }, value: "Please phone after 6pm." }], ring: [{ label: "Anything you would like us to know" }], tag: "Optional", alt: "A box for anything you would like us to know, with a note written in it.", minHeight: 420, lead: 120 }),
        },
        {
          id: "answer",
          title: "Say yes or no",
          do: ["Press [[Yes, I give my permission]], or [[No, I do not]].", "Either answer is welcome. You can change your mind later, using this same link."],
          shot: parent({
            before: [...ticked, { do: "fill", on: { label: "Anything you would like us to know" }, value: "Please phone after 6pm." }],
            ring: [{ role: "button", name: "Yes, I give my permission" }],
            second: [{ role: "button", name: "No, I do not" }],
            tag: "Your answer",
            alt: "The two buttons at the bottom: Yes, I give my permission, and No, I do not.",
            minHeight: 420,
            lead: 260,
          }),
        },
        {
          id: "thanks",
          title: "What happens next",
          do: ["After you press yes you will see **Thank you**, with your name.", "You can close the page. The same link stays yours, to take your permission back at any time."],
          timeline: [
            { when: "At once", what: "Your answer is recorded. Your child cannot be placed in a tribe yet." },
            { when: "Next", what: "A member of the Care Team phones or writes to check that the answer is yours." },
            { when: "After that", what: "Your child can be placed in a tribe for their own age group, with two adult leaders present." },
            { when: "Once they have a place", what: "Your link shows their tribe’s leaders and the day, time and place it meets." },
          ],
          shot: parent({
            before: [...ticked, { do: "click", on: { role: "button", name: "Yes, I give my permission" } }, { do: "wait", on: { role: "heading", name: /^Thank you/ } }],
            frame: "screen",
            ring: [{ role: "heading", name: /^Thank you/ }],
            tag: "Done",
            alt: "The Thank you screen after permission is given.",
          }),
        },
      ],
    },
    {
      title: "Afterwards",
      blurb: "The same link, whenever you want to look again.",
      steps: [
        {
          id: "their-tribe",
          title: "See where your child meets",
          do: ["Once your child has a place, the link shows **their tribe**: who leads it, and the day, time and place it meets."],
          shot: parent({ path: "@guardian-approved", ring: [{ role: "heading", name: /’s tribe$/ }], tag: "Their tribe", alt: "Your child’s tribe: its leaders, and the day, time and place it meets.", minHeight: 460, lead: 40 }),
        },
        {
          id: "take-back",
          title: "Take your permission back",
          do: ["To stop, press **I want to take my permission back**, then press [[Yes, take it back]]. Your child leaves the tribe straight away.", "Press [[Keep my permission]] if you change your mind. You can add a note for the Care Team first."],
          careful: "Taking it back cannot be undone from this page. To open it again, ask the Care Team.",
          shot: parent({
            path: "@guardian-approved",
            before: [{ do: "click", on: { role: "button", name: "I want to take my permission back" } }, { do: "wait", on: { role: "button", name: "Yes, take it back" } }],
            ring: [{ role: "button", name: "Yes, take it back" }],
            second: [{ role: "button", name: "Keep my permission" }],
            tag: "Only if you wish",
            alt: "The question about taking your permission back, with Yes, take it back and Keep my permission.",
            minHeight: 520,
            lead: 260,
          }),
        },
      ],
    },
  ],
};
