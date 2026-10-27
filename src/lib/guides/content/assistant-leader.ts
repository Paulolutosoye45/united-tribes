import type { Guide, Shot } from "../types";

/** L7. For an assistant leader: the week, the care tasks that are theirs, and helping the leader. */

/** Dara, the assistant leader of Segun’s tribe, with two care tasks waiting for her. */
const dara = (rest: Omit<Shot, "cast" | "arrange">): Shot => ({ cast: "assistant", arrange: "assistant-has-tribe", ...rest });

export const assistantLeader: Guide = {
  code: "L7",
  slug: "assistant-leader",
  title: "Assistant leader: your part",
  lede: "You stand beside the leader. You see the week, you take the practical care tasks, and you can log a meeting when the leader asks you to.",
  forWho: "For assistant leaders",
  audience: ["assistant_leader"],
  seenBy: ["leader"],
  minutes: 6,
  art: "assist",
  ready: ["A few minutes a week, and a little more when a care task comes in."],
  ifDifferent: "What you see depends on what the church has switched on for your tribe. Your leader or the church office can tell you what is different.",
  next: ["run-your-week", "your-tribes-season"],
  parts: [
    {
      title: "Your place in the tribe",
      blurb: "Two leaders who lead in different ways make a steadier tribe.",
      steps: [
        {
          id: "role",
          title: "What an assistant leader does",
          do: ["The church pairs you with a tribe whose leader leads in a different way from you, so the two of you balance each other.", "You can read the week, take the care tasks that are practical, and log the meeting when the leader asks you to."],
          why: "Care is shared on purpose. Practical needs come to you, pastoral ones go to the coach, and urgent ones go to the Care Lead the same day.",
        },
        {
          id: "open-week",
          title: "Open this week",
          do: ["On **Home**, find **Your tribe this week**. Press [[Open this week]]."],
          tip: "The same box has **The season so far**, which shows how the whole tribe is doing.",
          shot: dara({ path: "/home", ring: [{ role: "link", name: "Open this week" }], tag: "Press", alt: "Home, with the Your tribe this week box and its Open this week button.", lead: 230, minHeight: 520 }),
        },
        {
          id: "top",
          title: "Read the top of the page",
          do: ["The top says which week it is, when the tribe meets, and how the week stands.", "Under it are four numbers: members, the steps they chose, who to call, and testimonies waiting for the leader."],
          shot: dara({ path: "/lead/week", frame: "screen", ring: [{ css: "#lw-heading" }], tag: "This week", alt: "The top of This week for an assistant leader: the week number, the meeting time and the status." }),
        },
      ],
    },
    {
      title: "Care tasks",
      blurb: "When the leader flags someone, the right person gets a task and a date. Practical needs are yours.",
      steps: [
        {
          id: "open-care",
          title: "Open your care tasks",
          do: ["On **Home**, press [[Open care tasks]]. You can also press [[Care]] at the bottom of your screen."],
          tip: "The box on Home says how many people are waiting for you, and when the soonest is due.",
          shot: dara({ path: "/home", ring: [{ role: "link", name: "Open care tasks" }], tag: "Press", alt: "Home, with the Care tasks box and its Open care tasks button.", lead: 190, minHeight: 420 }),
        },
        {
          id: "read-task",
          title: "Read what is waiting for you",
          do: ["Each card under **Waiting for you** says who it is for, what the leader wrote, and how many days are left.", "Under the note is a line of advice. For a practical need it is to help in a real, small way: a meal, a lift, a form, a job lead."],
          shot: dara({ path: "/care", ring: [{ role: "heading", name: "Waiting for you" }], tag: "Your tasks", alt: "The Care tasks page: a card for a practical need, with the leader’s note and the days left.", minHeight: 640, lead: 40 }),
        },
        {
          id: "mark-done",
          title: "Say when it is done",
          do: ["When you have helped, press [[Mark done]]. Say in a line what you did, then press [[Save as done]].", "The leader can see that it is done."],
          example: "Arranged a lift with Tayo for Wednesday.",
          shot: dara({
            path: "/care",
            before: [
              { do: "click", on: { role: "button", name: "Mark done" } },
              { do: "fill", on: { label: "What did you do? (optional)" }, value: "Arranged a lift with Tayo for Wednesday." },
              { do: "wait", on: { role: "button", name: "Save as done" } },
            ],
            ring: [{ role: "button", name: "Save as done" }],
            second: [{ role: "button", name: "Mark done" }],
            tag: "Press",
            alt: "A care task with Mark done pressed, a line saying what was done, and the Save as done button.",
            minHeight: 520,
            lead: 200,
          }),
        },
        {
          id: "not-needed",
          title: "If it is not needed",
          do: ["If the need was met some other way, press [[Not needed]], say why in a line, and press [[Close this task]]."],
          careful: "Choose this only when the need has gone. If you simply cannot help, tell the leader so the task can go to someone who can.",
          shot: dara({
            path: "/care",
            before: [{ do: "click", on: { role: "button", name: "Not needed" } }, { do: "wait", on: { role: "button", name: "Close this task" } }],
            ring: [{ role: "button", name: "Close this task" }],
            second: [{ role: "button", name: "Not needed" }],
            tag: "Press",
            alt: "A care task with Not needed pressed, a box asking why, and the Close this task button.",
            minHeight: 520,
            lead: 200,
          }),
        },
      ],
    },
    {
      title: "Beside the leader",
      blurb: "Agree with the leader who does what, so nobody is called twice and nobody is missed.",
      steps: [
        {
          id: "calls",
          title: "Call someone, with the leader’s agreement",
          do: ["**People to call first** works the same for you. Press [[Message on WhatsApp]] or [[Call]], then [[Record the call]] so the leader sees it.", "Ask the leader first, so you do not both call the same person."],
          shot: dara({ path: "/lead/week", ring: [{ role: "heading", name: "People to call first" }], tag: "Call first", alt: "The list of people to call first, with a reason for each and buttons to message or call.", minHeight: 560, lead: 40 }),
        },
        {
          id: "log",
          title: "Log the meeting when the leader asks",
          do: ["Open **This week**, choose [[We met]], and mark each person **Here**, **Away** or **Excused**.", "Write one highlight, then press [[Save the log]]. The leader’s guide, Run your week, shows each step."],
          shot: dara({ path: "/lead/week", ring: [{ role: "radiogroup", name: "Did the tribe meet?" }], second: [{ css: "#log ul li" }], tag: "Who came", alt: "The log: We met, and a row for each member to mark Here, Away or Excused.", minHeight: 620, lead: 140 }),
        },
      ],
    },
    {
      title: "Every week",
      steps: [
        {
          id: "rhythm",
          title: "The rhythm of your week",
          do: ["A few minutes, most weeks. More when a task comes in."],
          timeline: [
            { when: "Before the meeting", what: "Open This week. Ask the leader what they would like you to take." },
            { when: "After the meeting", what: "Ask the leader if anyone needs a call, and who will make it." },
            { when: "Through the week", what: "Open Care tasks. Do the practical ones before the date on the card." },
            { when: "When you have helped", what: "Press Mark done, and say what you did in a line." },
          ],
        },
      ],
    },
  ],
};
