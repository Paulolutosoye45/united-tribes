import type { Guide, Shot } from "../types";

/** L4. A leader's week: prepare, meet, log, call, and read testimonies. */

/** Segun, who leads a tribe whose season is under way (week 2), with six members and a few things to do. */
const week = (rest: Omit<Shot, "cast" | "arrange">): Shot => ({ cast: "leader", arrange: "leader-week", ...rest });

export const runYourWeek: Guide = {
  code: "L4",
  slug: "run-your-week",
  title: "Run your week",
  lede: "One page holds your whole week: what to prepare, who to call, how to log the meeting, and what members have written.",
  forWho: "For tribe leaders",
  audience: ["leader"],
  seenBy: ["assistant_leader"],
  minutes: 9,
  art: "run",
  ready: ["Your tribe’s meeting time. It is at the top of the page.", "Two minutes after each meeting, while it is fresh."],
  ifDifferent: "Before your season begins, this page shows the first week so you can prepare. The log and the call list open when the week starts.",
  next: ["your-tribes-season"],
  parts: [
    {
      title: "Before the meeting",
      blurb: "Open the week, and read the plan once.",
      steps: [
        {
          id: "open-week",
          title: "Open this week",
          do: ["On **Home**, find **Your tribe this week**. Press [[Open this week]]."],
          tip: "The same button is on your Lead page, under the name This week.",
          shot: week({ path: "/home", ring: [{ role: "link", name: "Open this week" }], tag: "Press", alt: "Home, with the Your tribe this week box and its Open this week button.", lead: 230, minHeight: 520 }),
        },
        {
          id: "top",
          title: "Read the top of the page",
          do: ["The top says which week it is, when you meet, and how the week stands: **Upcoming**, **Not logged yet**, **On track**, **Keep an eye** or **Needs attention**.", "Under it, four numbers: your members, the steps they chose, who to call, and testimonies waiting."],
          shot: week({ path: "/lead/week", frame: "screen", ring: [{ css: "#lw-heading" }], tag: "This week", alt: "The top of This week: the week number, the meeting time and the status." }),
        },
        {
          id: "prepare",
          title: "Prepare the meeting",
          do: ["Scroll to **Prepare week …**. It has the big idea, the passage, and the 75 minutes in five parts with the time for each.", "Read **Questions for the tribe**, and **A word for you as leader**."],
          tip: "Ten minutes of reading the night before is enough.",
          shot: week({ path: "/lead/week", ring: [{ css: "#prep-heading" }], tag: "The plan", alt: "The week’s plan: its big idea and the 75 minutes in five parts.", minHeight: 600, lead: 80 }),
        },
      ],
    },
    {
      title: "After the meeting",
      blurb: "Two minutes. Your coach and the pastorate read this, and it is how your tribe is looked after.",
      steps: [
        {
          id: "log-open",
          title: "Open the log",
          do: ["Press [[Log the meeting]] at the top. It takes you to the log."],
          shot: week({ path: "/lead/week", frame: "screen", ring: [{ role: "link", name: "Log the meeting" }], tag: "Press", alt: "The top of This week, with the Log the meeting button." }),
        },
        {
          id: "log-marks",
          title: "Mark who was there",
          do: ["Choose [[We met]], then mark each person **Here**, **Away** or **Excused**. Everyone starts as Here.", "If you did not meet, choose [[We did not meet]] and say what happened."],
          shot: week({ path: "/lead/week", ring: [{ role: "radiogroup", name: "Did the tribe meet?" }], second: [{ css: "#log ul li" }], tag: "Who came", alt: "The log: We met, and a row for each member to mark Here, Away or Excused.", minHeight: 620, lead: 140 }),
        },
        {
          id: "log-highlight",
          title: "Write one highlight",
          do: ["Under **One highlight from the meeting**, write a line or two about how it felt.", "Leave out private details. Your coach can read this."],
          example: "Two people shared for the first time. Kemi prayed out loud.",
          shot: week({ path: "/lead/week", ring: [{ label: "One highlight from the meeting" }], tag: "A line or two", alt: "A box for one highlight from the meeting.", minHeight: 420 }),
        },
        {
          id: "log-save",
          title: "Save the log",
          do: ["Press [[Save the log]]. You will see **Saved. Thank you.**", "You can change it until the week closes."],
          shot: week({
            path: "/lead/week",
            before: [{ do: "fill", on: { label: "One highlight from the meeting" }, value: "Two people shared for the first time. Kemi prayed out loud." }],
            ring: [{ role: "button", name: "Save the log" }],
            tag: "Press",
            alt: "The log filled in, with the Save the log button.",
            minHeight: 420,
            lead: 300,
          }),
        },
      ],
    },
    {
      title: "Looking after your people",
      blurb: "Nobody misses twice without a call.",
      steps: [
        {
          id: "calls",
          title: "See who needs a call",
          do: ["**People to call first** lists anyone the app has noticed, with the reason and a line of advice.", "Press [[Message on WhatsApp]] for a short, warm message, or [[Call]]."],
          shot: week({ path: "/lead/week", ring: [{ role: "heading", name: "People to call first" }], tag: "Call first", alt: "The list of people to call first, with a reason for each and buttons to message or call.", minHeight: 560, lead: 40 }),
        },
        {
          id: "record-call",
          title: "Record the call",
          do: ["Press [[Record the call]], then choose how it went.", "Add a line for your records if you like. Only you, your coach and the care team can read it."],
          why: "If someone needs more help than you can give, choose that one. The care team takes it from there.",
          shot: week({
            path: "/lead/week",
            before: [{ do: "click", on: { role: "button", name: "Record the call" } }, { do: "wait", on: { role: "radiogroup", name: "How the call went" } }],
            ring: [{ role: "radiogroup", name: "How the call went" }],
            tag: "Choose one",
            alt: "Three choices for how the call went.",
            minHeight: 520,
          }),
        },
        {
          id: "worried",
          title: "Add someone you are worried about",
          do: ["Press [[Someone I am worried about]], choose the member, and say what you have noticed.", "They go on your call list, and your coach can see it."],
          shot: week({ path: "/lead/week", ring: [{ role: "button", name: "Someone I am worried about" }], tag: "Press", alt: "The Someone I am worried about button under the call list.", minHeight: 460, lead: 220 }),
        },
      ],
    },
    {
      title: "Testimonies and your Success Picture",
      steps: [
        {
          id: "testimonies",
          title: "Read the testimonies",
          do: ["Under **Testimonies to read**, press [[Approve]] to share one with your tribe, or [[Decline]] with a kind note.", "Nothing reaches the tribe until you approve it. Choose up to three tags so it can be found later."],
          shot: week({ path: "/lead/week", ring: [{ role: "heading", name: "Testimonies to read" }], tag: "Your decision", alt: "A testimony waiting for you, with Approve and Decline.", minHeight: 640, lead: 40 }),
        },
        {
          id: "success-picture",
          title: "Settle your Success Picture",
          do: ["In the first two weeks, agree the three lines with your tribe, then press [[Save the final version]].", "Members see it on their page, and answer their halfway and final check-ins against it."],
          careful: "After week 2 the lines are closed. Say each line aloud with your tribe first, so everyone can.",
          shot: week({ path: "/lead/week", ring: [{ role: "heading", name: "Settle your Success Picture" }], tag: "By week 2", alt: "Three boxes for Loving God, Loving Others and Loving Life, and the Save the final version button.", minHeight: 640, lead: 40 }),
        },
      ],
    },
    {
      title: "Every week",
      steps: [
        {
          id: "rhythm",
          title: "The rhythm of your week",
          do: ["The same five things, every week. Most take a few minutes."],
          timeline: [
            { when: "The day before", what: "Read the plan under Prepare. Look at People to call first." },
            { when: "The meeting", what: "Run the 75 minutes. Ask more than you tell." },
            { when: "Within a day", what: "Press Log the meeting. Mark who was there, and write one highlight." },
            { when: "Within two days", what: "Call or message anyone who was Away. Record the call." },
            { when: "Through the week", what: "Read testimonies as they come, and approve what is ready to share." },
          ],
        },
      ],
    },
  ],
};
