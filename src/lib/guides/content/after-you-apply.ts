import type { Guide, Shot } from "../types";

/** L2. What happens after an application is sent: the referees, the interview, and the decision. */

const at = (where: string, rest: Omit<Shot, "cast" | "path" | "arrange">): Shot => ({
  cast: "applicant",
  path: "/lead",
  arrange: `application-is:${where}`,
  ...rest,
});

export const afterYouApply: Guide = {
  code: "L2",
  slug: "after-you-apply",
  title: "After you apply: your referees, your interview, the decision",
  lede: "Your application is with the panel. Here is what you do next, and what to expect at each step.",
  forWho: "For members who have applied to lead",
  audience: ["member"],
  minutes: 6,
  art: "wait",
  ready: ["Your phone, and your two referees’ numbers or emails, in case one needs to be changed."],
  ifDifferent: "The office can turn the references or the interview off, so your page may skip a stage. Your Lead page always shows where you are.",
  next: ["leader-academy"],
  parts: [
    {
      title: "Your two referees",
      blurb: "They answer four short questions. You never see what they say.",
      steps: [
        {
          id: "where-it-stands",
          title: "See where it stands",
          do: ["Press [[Lead]] any time. The top says where your application is, and the list under it shows each stage."],
          shot: at("submitted", { frame: "screen", ring: [{ role: "heading", name: "With the review panel" }], tag: "Your stage", alt: "The Lead page after sending: With the review panel." }),
        },
        {
          id: "send-requests",
          title: "Ask each referee",
          do: ["Under **Your referees**, press the button with their name on it.", "We send each of them a private link and a code, straight to their own phone or email."],
          careful: "If a number or email is wrong, press [[Change this person]] and fix it before you send.",
          shot: at("submitted", { ring: [{ role: "button", name: /^Send request to/ }], tag: "Press, once each", alt: "The Your referees box, with a Send request button for each person." }),
        },
        {
          id: "watch",
          title: "Watch how each one is going",
          do: ["A small bar fills as they open the link, confirm it is them, and answer. The words say the same.", "If one is slow, press **Give … a heads-up**. It is a short note from you, with no link in it."],
          shot: at("submitted", {
            before: [{ do: "click", on: { role: "button", name: /^Send request to/ } }, { do: "wait", on: { role: "button", name: "Send again" } }],
            ring: [{ role: "button", name: "Send again" }],
            tag: "Sent",
            alt: "After sending: the progress bar for the first referee, with Send again.",
          }),
        },
      ],
    },
    {
      title: "The interview",
      blurb: "Twenty minutes with two panelists.",
      steps: [
        {
          id: "invited",
          title: "Choose your time",
          do: ["When you are invited, **Choose your interview time** appears on your Lead page.", "Tap a time that suits you. Times are in Lagos time."],
          shot: at("interview_invited", { ring: [{ role: "heading", name: "Choose your interview time" }], tag: "You are invited", alt: "A list of interview times to choose from.", lead: 24 }),
        },
        {
          id: "book",
          title: "Book it",
          do: ["Press [[Book this time]]."],
          tip: "You can cancel and choose another time up to a day before.",
          shot: at("interview_invited", {
            before: [{ do: "click", on: { css: "label.choice:has(input[name=slot])" } }],
            ring: [{ role: "button", name: "Book this time" }],
            tag: "Press",
            alt: "A time chosen, with the Book this time button.",
          }),
        },
        {
          id: "booked",
          title: "Come as you are",
          do: ["**Your interview** shows the day, time and place. Two panelists will ask five questions about your story and how you would lead.", "Nothing to prepare. Be honest."],
          shot: at("interview_booked", { ring: [{ role: "heading", name: "Your interview" }], tag: "Booked", alt: "Your interview: the day, the time, the place.", lead: 24 }),
        },
      ],
    },
    {
      title: "The decision",
      blurb: "A pastor decides, and you see it here.",
      steps: [
        {
          id: "approved",
          title: "If you are approved",
          do: ["The top of your Lead page says **Approved as a leader**. The buttons under it are your next steps: your training, your Tribe Card, and your week."],
          shot: { cast: "leader-in-training", path: "/lead", arrange: "application-is:approved_leader", frame: "screen", ring: [{ role: "heading", name: "Approved as a leader" }], tag: "Welcome", alt: "Approved as a leader, with the buttons for the next steps." },
        },
        {
          id: "offer",
          title: "If the church offers you a place",
          do: ["You may see **An offer for you**: a tribe where members are already waiting.", "Press [[Yes, I’ll lead it]] and your Tribe Card starts with the goal chosen. Or press [[Not this time]]. Nothing changes if you say no."],
          shot: { cast: "leader-in-training", path: "/lead", arrange: "application-is:approved_leader+offer", ring: [{ role: "button", name: "Yes, I’ll lead it" }], second: [{ role: "button", name: "Not this time" }], tag: "Your answer", alt: "An offer to lead a tribe where members are waiting." },
        },
        {
          id: "not-approved",
          title: "If it is not this time",
          do: ["You will see **Not approved this time** and **A note from the pastor**. It is kind, and it says what to do next.", "**Ways to serve now** lists places you can serve while you wait."],
          shot: at("not_approved", { ring: [{ role: "heading", name: "A note from the pastor" }], tag: "A note for you", alt: "A note from the pastor, and ways to serve now." }),
        },
      ],
    },
  ],
};
