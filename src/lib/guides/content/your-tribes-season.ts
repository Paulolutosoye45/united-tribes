import type { Guide, Shot } from "../types";

/** L5. A leader reading how their tribe's season is going. */

const season = (rest: Omit<Shot, "cast" | "arrange" | "path">): Shot => ({ cast: "leader", arrange: "leader-week", path: "/lead/progress", ...rest });

export const yourTribesSeason: Guide = {
  code: "L5",
  slug: "your-tribes-season",
  title: "Your tribe’s season",
  lede: "One page that shows how your tribe is doing: who came, who took their step, and where to put your care this week.",
  forWho: "For tribe leaders",
  audience: ["leader"],
  seenBy: ["assistant_leader"],
  minutes: 5,
  art: "season",
  ready: ["A few minutes, once a week, after you have logged the meeting."],
  ifDifferent: "Some figures wait until enough members have answered. That protects each person’s answer, and the page tells you when each will show.",
  next: [],
  parts: [
    {
      title: "Reading the page",
      blurb: "Open it, and read it from the top.",
      steps: [
        {
          id: "open-season",
          title: "Open the season so far",
          do: ["On **This week**, press [[The season so far]]."],
          shot: { cast: "leader", arrange: "leader-week", path: "/lead/week", frame: "screen", ring: [{ role: "link", name: "The season so far" }], tag: "Press", alt: "The top of This week, with The season so far button." },
        },
        {
          id: "headline",
          title: "Read the headline",
          do: ["The top names your tribe, the season and the week.", "A word may sit beside it: **On course**, **Close**, **At risk**, or **Too early**. It looks at how many members are on pace to thrive."],
          why: "Too early is normal for the first three weeks. A word that needs more answers waits until there are enough.",
          shot: season({ ring: [{ role: "heading", name: "Your tribe’s season" }], tag: "Your season", alt: "The top of Your tribe’s season: the tribe’s name, the week, and a short line about how the season stands.", minHeight: 360, lead: 120 }),
        },
        {
          id: "numbers",
          title: "Read the three numbers",
          do: ["**Came** is how many members were at the meetings logged so far.", "**Steps done** is how many chose a step and did it. **Success Picture** is how far your members say they have moved toward your three lines."],
          shot: season({ ring: [{ css: "dl" }], tag: "Three numbers", alt: "Three boxes: Came, Steps done, and Success Picture.", minHeight: 420, lead: 40 }),
        },
        {
          id: "week-by-week",
          title: "Look week by week",
          do: ["Each week has two bars: how many came, and how many did their step. The dashed line is the pace that reaches the thriving bar."],
          tip: "A dip in one week is ordinary. Two dips in a row is a reason to call.",
          shot: season({ ring: [{ css: "figure" }], tag: "Week by week", alt: "A bar for each of the twelve weeks, showing who came and who took their step.", minHeight: 420, lead: 40 }),
        },
        {
          id: "people",
          title: "See your people",
          do: ["Under **Your people**, each member shows how many meetings they came to and how many steps they finished.", "**On pace** and **Behind** look at meetings only. How someone feels about the tribe stays private."],
          careful: "If a member says they do not belong, they appear on your call list on This week. They never appear here with their answer.",
          shot: season({ ring: [{ role: "heading", name: "Your people" }], tag: "Your people", alt: "A row for each member with their meetings, their steps, and On pace or Behind.", minHeight: 640, lead: 40 }),
        },
        {
          id: "back",
          title: "Go back and act on it",
          do: ["Press [[Back to this week]] and call anyone who is behind."],
          shot: season({ ring: [{ role: "link", name: "Back to this week" }], tag: "Press", alt: "The Back to this week button at the bottom of the page.", minHeight: 360, lead: 160 }),
        },
      ],
    },
  ],
};
