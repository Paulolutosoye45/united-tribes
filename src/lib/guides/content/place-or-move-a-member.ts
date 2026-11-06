import type { Guide } from "../types";

/**
 * A4. For the admin and the director: putting one member in a tribe, moving one to another, undoing it, taking one out of a tribe (and putting them back), and asking the owner for what only the owner may allow.
 * The pages work only while the owner has Placement On, so there are no pictures.
 */
export const placeOrMoveAMember: Guide = {
  code: "A4",
  slug: "place-or-move-a-member",
  title: "Place or move a member in a tribe",
  lede: "Put a member who has no tribe into one, or move a member to another, with the same checks and the same emails as the church’s own placement.",
  forWho: "For the admin and the director. The owner has the same tool in God Mode",
  audience: ["admin", "director"],
  seenBy: ["pastor"],
  minutes: 8,
  art: "move",
  ready: ["The person’s name, e-mail or phone number, and the tribe you have in mind.", "Placement switched On by the owner. If it is Off or in Rehearsal, the pages say so and nobody can be placed from here."],
  whoSees: [
    "The member gets the same **Your tribe** email as in a church run, with a private link to say yes, keep their details private or look at other tribes. Their leader sees their name now, and their number only after they say yes.",
    "When you move someone, the leader they leave is told. Nobody else is.",
    "When you take someone out of a tribe, they are emailed kindly with other tribes to look at, and the tribe’s leader is told by first name only. Neither is told your reason.",
  ],
  ifDifferent: "If you cannot find Place or move a member in the Admin menu, you do not hold the admin or director role. If a page says Placement is Off, ask the owner to switch it On.",
  next: [],
  parts: [
    {
      title: "Place a member who has no tribe",
      blurb: "Find them, read the check, place them.",
      steps: [
        {
          id: "find-them",
          title: "Find the member",
          do: ["Open **Admin**, then **People and roles**, and use [[Find a member]]. Type part of a name, an e-mail or a phone number, and press **Find**.", "Press **Open · place** beside the right person."],
          tip: "A tribe leader is listed but cannot be chosen. A leader does not join a tribe as a member.",
        },
        {
          id: "read-check",
          title: "Choose a tribe and read what it says",
          do: ["Choose a tribe, best fit first. The page shows the fit, the seats taken, and what will happen.", "Anything in red cannot be done from here, by anyone. Anything in yellow needs your tick and a reason."],
          careful: "The check changes nothing. The member is not told until you press the button.",
        },
        {
          id: "place-them",
          title: "Place them",
          do: ["Press the button with their name. They are emailed, and the tribe’s leader is told in the usual way."],
        },
        {
          id: "undo-it",
          title: "Undo it if it was a mistake",
          do: ["Press [[Undo]] on the same page, or under **Last placement from Admin** on their page. It works until the tribe’s leader has been told."],
          why: "After that the leader has the name, so the page says it can no longer be undone here.",
        },
      ],
    },
    {
      title: "Move a member to another tribe",
      blurb: "For someone who already has a seat.",
      steps: [
        {
          id: "open-move",
          title: "Open their page",
          do: ["Find them as before. Their page now says **Move to another tribe**.", "Choose the new tribe. The page says they will leave the old one and the old leader will be told."],
        },
        {
          id: "move-them",
          title: "Move them, and undo if you must",
          do: ["Press the button. The old seat is given up, they are emailed **Your tribe** for the new one, and the old leader is told.", "[[Undo]] puts the old seat back, until the new tribe’s leader has been told."],
          careful: "If the old tribe has filled up since, Undo cannot put them back. Move them again instead.",
        },
      ],
    },
    {
      title: "Take a member out of a tribe",
      blurb: "From the tribe’s page or the member’s page, with a way back.",
      steps: [
        {
          id: "open-members",
          title: "Open the tribe",
          do: ["Open **Admin**, then **Place or move a member**, and press the tribe. Its **Members** list shows everyone in it, with [[Remove]] beside each.", "You can also open a member’s page and use **Remove from this tribe**."],
          tip: "A member with an open care matter, or a young person, has no button. Only the Care Lead changes that place.",
        },
        {
          id: "remove-them",
          title: "Say why, and confirm",
          do: ["Read what will happen, write a reason of 10 to 300 characters, and press the button with their name. [[Keep them]] closes it and changes nothing.", "They go back to the pile of people waiting to be placed. You can place them in another tribe at once; automatic placement leaves them alone for 3 days."],
          careful: "Only the church’s office reads your reason. It is never in an email, and it is cleared after 12 months. The same tribe is not offered to them again unless you put them back.",
        },
        {
          id: "put-them-back",
          title: "Put them back if it was a mistake",
          do: ["Under **Removed here lately** on the tribe’s page (and on the member’s page), press [[Put back]]. It works for 14 days, while the tribe is open, has room and they have not joined another.", "They are emailed that their place is back, and the leader is told."],
          why: "After 14 days, place them again instead, from the same pages.",
        },
        {
          id: "whatsapp-group",
          title: "Ask the leader to take them out of the group",
          do: ["The leader’s email reminds them to take the member out of any WhatsApp group they keep for the tribe. The site cannot do that for them, and the leader’s page lists who to take out."],
        },
      ],
    },
    {
      title: "When the owner has to allow it",
      blurb: "Some warnings are not yours to accept.",
      steps: [
        {
          id: "what-you-can-accept",
          title: "What you can accept yourself",
          do: ["You can accept three things, with a tick and a reason: joining has closed, the member has not agreed to matching, and a hold the church put there after a removal.", "For **has not agreed to matching** you also tick that they told you they agree. It is kept as your word, with your name and the time. It does not give their consent."],
        },
        {
          id: "ask-the-owner",
          title: "Ask the owner for the rest",
          do: ["A full tribe, a fit below the bar, no fit score, another age group or a hold the owner put there are the owner’s to allow. The page says so and offers [[Ask the owner]].", "Tick, give your reason, and press it. Nothing happens to the member until the owner answers."],
          tip: "You see your own requests under **Admin → Place or move a member**, and can take one back until it is answered. It lapses after 7 days.",
        },
        {
          id: "the-answer",
          title: "Read the answer",
          do: ["When the owner approves, the member is placed as your placement. When the owner declines, you are told, with a word from the owner. The notice reaches you once the owner has switched the admin notices On."],
          careful: "You can place 30 people a day at most. The owner’s approvals do not count.",
        },
      ],
    },
  ],
};
