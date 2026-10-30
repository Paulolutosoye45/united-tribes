import type { Guide, Shot } from "../types";

/**
 * C1. For a coach or the Care Lead (and the pastor, director and admin who can read or decide the same requests): reading a leader’s request about a member’s
 * place, and deciding it. The screen exists only once the owner has opened leader removal requests, so every picture says so.
 */
const board = (rest: Omit<Shot, "cast" | "path" | "features" | "arrange" | "device"> & { path?: string }): Shot => ({
  cast: "coach",
  path: "/growth/removals",
  arrange: "removal-is:asked",
  features: ["removal_requests"],
  device: "desktop",
  ...rest,
});

const chosen: NonNullable<Shot["before"]> = [
  { do: "click", on: { css: 'label:has(input[type="radio"][value="decline"])' } },
  { do: "fill", on: { label: "Your note" }, value: "A tribe that meets on another evening would suit Bukola better. Please help her find one." },
];

export const decideAPlaceChange: Guide = {
  code: "C1",
  slug: "decide-a-place-change",
  title: "Decide a request about a member’s place",
  lede: "A tribe leader has asked the church to look at a member’s place. You read what they wrote, and you approve it, decline it, or ask them a question. Nobody is removed by silence.",
  forWho: "For coaches and the Care Lead, and the pastors, directors and admins who read the same requests",
  audience: ["coach", "care_lead"],
  seenBy: ["director", "pastor", "admin"],
  minutes: 6,
  art: "decide",
  ready: ["Ten minutes where you will not be interrupted", "A call to the leader, if what they wrote leaves you unsure"],
  whoSees: [
    "The leader reads your note and is told what you decided. The member never reads it.",
    "If you approve, the member is told kindly that their place has changed and is offered other tribes. Their attendance and everything they wrote stays.",
    "If you decline, the member is told nothing.",
  ],
  ifDifferent: "If you cannot find Removal requests under Growth, the church has not opened them yet. The owner opens them from God Mode, under Features.",
  next: [],
  parts: [
    {
      title: "Read the request",
      blurb: "What is waiting, and what the leader wrote.",
      steps: [
        {
          id: "open-board",
          title: "Open the requests",
          do: ["Open **Growth**, then press [[Removal requests]]. **Waiting for you** lists what needs your decision."],
          tip: "Anything about safety or conduct, a young person, or someone the Care Team is already caring for says **Care Team decides**. A coach can read it but only the Care Lead, a director or an admin can decide it.",
          shot: board({ path: "/growth", ring: [{ role: "link", name: /^Removal requests/ }], tag: "Press", alt: "The Growth page, with Removal requests ringed." }),
        },
        {
          id: "read-request",
          title: "Read what the leader wrote",
          do: [
            "Each card names the member, the tribe, who asked, and the main reason.",
            "Under it, **What the leader wrote** is their own account, with the member’s attendance in this tribe.",
          ],
          careful: "Under 18: the Care Lead speaks to their parent or guardian. They are not emailed.",
          shot: board({ ring: [{ role: "heading", name: /^Waiting for you/ }, { text: "What the leader wrote:" }], tag: "Read it all", alt: "A request, with the member, the tribe, the reason, what the leader wrote, and attendance.", minHeight: 420 }),
        },
      ],
    },
    {
      title: "Decide",
      blurb: "Three answers. Any of them is kind if it is careful.",
      steps: [
        {
          id: "choose",
          title: "Choose your decision",
          do: [
            "Under [[Your decision]], choose **Approve: release their place**, **Decline: they stay**, or **Ask the leader a question**.",
            "Each one says in a line what will happen when you send it.",
          ],
          why: "If you are not sure, ask. Nothing is decided until you choose Approve or Decline.",
          shot: board({ ring: [{ role: "group", name: "Your decision" }], tag: "Your choice", alt: "The three choices: approve, decline, or ask the leader a question.", minHeight: 420 }),
        },
        {
          id: "note",
          title: "Write your note, then send",
          do: ["Write your reason under [[Your note]]. At least ten characters. The leader reads it. The member never does.", "Press [[Send my decision]]."],
          example: "A tribe that meets on another evening would suit Bukola better. Please help her find one.",
          shot: board({
            before: chosen,
            ring: [{ role: "button", name: "Send my decision" }],
            second: [{ label: "Your note" }],
            tag: "Press",
            alt: "A decision chosen and a note written, with the Send my decision button.",
            minHeight: 420,
          }),
        },
      ],
    },
    {
      title: "Afterwards",
      blurb: "A decision can be looked at again.",
      steps: [
        {
          id: "afterwards",
          title: "If they ask for it to be looked at again",
          do: [
            "A member whose place was released can ask, for **14 days**, for it to be looked at again. The card then says **They have asked for it to be looked at again**.",
            "Write your note, then press [[Put their place back]] if there is room, or [[Keep the decision]] if it stands.",
          ],
          timeline: [
            { when: "At once", what: "Your decision is kept with your note, and the leader is told." },
            { when: "If you approved", what: "The member is told kindly, offered other tribes, and given a way to ask for it to be looked at again." },
            { when: "Within 14 days", what: "They may ask. The Care Team looks again, and the member is told the answer." },
            { when: "After twelve months", what: "The leader’s words are cleared. The date and the decision are kept." },
          ],
        },
      ],
    },
  ],
};
