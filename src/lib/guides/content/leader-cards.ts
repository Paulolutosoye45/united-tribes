import type { Guide } from "../types";

/**
 * A5. For the admin, the director and the pastor (who can send the email again, tag a department, move the reminders and download the call sheet),
 * and the data lead (who can read the board and download the list for the heads of department): seeing where every leader's Tribe Card is, and
 * chasing the ones who have not started, kindly. The reminders start Off, so there are no pictures of them.
 */
export const leaderCards: Guide = {
  code: "A5",
  slug: "leader-cards",
  title: "See where every leader’s Tribe Card is, and chase it kindly",
  lede: "A leader’s tribe does not open until their Tribe Card is sent in. This shows who has not started, whether the email with their link arrived, and how to help.",
  forWho: "For the admin, the director and the pastor. The data lead can read the board",
  audience: ["admin"],
  seenBy: ["director", "pastor", "data_lead"],
  minutes: 6,
  art: "people",
  ready: ["A few minutes. If you want each head of department to get their own list, have the department each leader serves in to hand."],
  whoSees: [
    "A leader who is written to gets one short, kind email from the church office. It says where their card is and has one button that opens it. It never says they are late.",
    "A head of department who is given the downloaded list sees names, tribe and where each card is. Neither list for them has a phone number or an address. Only the call sheet does, and only the admin, a director and a pastor can download it.",
  ],
  ifDifferent: "If you cannot find Leader cards under People, you do not hold the admin, director, pastor or data lead role. Ask the admin to check your role.",
  next: ["contact-gaps"],
  parts: [
    {
      title: "See where every leader is",
      blurb: "One card for each leader this season.",
      steps: [
        {
          id: "open-board",
          title: "Open Leader cards",
          do: ["Open **Admin**, then **People**, and press [[Leader cards]]."],
        },
        {
          id: "read-boxes",
          title: "Read the boxes",
          do: [
            "The boxes at the top count the leaders by where their card is. **Not finished** is the one to watch: not started, in progress, or sent back with changes asked for.",
            "Press a box to see only those leaders. Press **Show everyone** to see all of them.",
          ],
          tip: "**Never signed in** is the leaders who have not opened the platform since they were made leaders.",
        },
        {
          id: "read-email",
          title: "Check the email reached them",
          do: [
            "On each leader’s card, **Email with the link** says it was sent, is waiting to go, or did not arrive. When it did not arrive, the reason is beside it, and the address on file is shown so you can see if it is wrong.",
          ],
          careful: "A leader whose email did not arrive cannot start, so they will look like someone who is slow. Sort those first.",
        },
      ],
    },
    {
      title: "Send the email again",
      blurb: "Kindly, and not too often.",
      steps: [
        {
          id: "send-one",
          title: "Send it to one leader",
          do: ["On their card, press [[Send the email again]]. It is the same kind of note, with the same button, and it says the first one may not have reached them."],
          why: "A leader is sent it at most three times, never twice in a day, and never once their card is sent in. Quiet hours hold, as for every message.",
        },
        {
          id: "send-all",
          title: "Send it to everyone it did not reach",
          do: ["If the board shows leaders who have not started and whose email did not arrive, press [[Send it again to everyone it did not reach]], then confirm."],
          careful: "It leaves out anyone whose address bounces or who asked for their data to be deleted, and it tells you who it left out and why.",
        },
        {
          id: "reach-by-hand",
          title: "If it still does not arrive",
          do: [
            "If the leader said yes to WhatsApp, press **Message** beside their name to open a chat with a friendly line ready, then say whether you sent it.",
            "Otherwise download the call sheet below and ring them. Ask for the best email address, and the admin can correct it.",
          ],
        },
      ],
    },
    {
      title: "Remind them on Thursday, Friday and Saturday",
      blurb: "Off until you move it.",
      steps: [
        {
          id: "rehearse",
          title: "Rehearse first",
          do: ["At the foot of the page, under [[Reminders]], choose **Rehearsal**, write why, and press [[Save reminders]]. It writes down who it would have written to and sends nothing."],
          why: "After a day, **This week** says how many it would have written to. If that is the number you expect, move to **On**.",
        },
        {
          id: "switch-on",
          title: "Turn it on",
          do: ["Choose **On**, check the days and the hour, write why, and press [[Save reminders]]. Each leader whose card is still open gets one kind email a day, and none once their card is sent in."],
          careful: "The reminders go out only when the church’s heartbeat is running every few minutes. If you have not set that up, ask the admin before you rely on them.",
        },
      ],
    },
    {
      title: "Give the heads of department their lists",
      blurb: "Names, not numbers.",
      steps: [
        {
          id: "tag-department",
          title: "Say which department each leader serves in",
          do: ["On each leader’s card, type the department in the **Department** box and press **Save**. The same words appear in the Department filter at the top."],
        },
        {
          id: "download-list",
          title: "Download the list for the heads of department",
          do: ["Press [[Download the list for the heads of department (spreadsheet)]]. It is grouped by department, with each leader’s tribe and where their card is. It has no numbers and no addresses."],
          tip: "To give one head of department only their own leaders, filter by their department first, or sort the spreadsheet by the Department column.",
        },
        {
          id: "call-sheet",
          title: "Download the call sheet when you need to ring",
          do: ["The admin, a director and a pastor can press [[Download the call sheet, with numbers and addresses (spreadsheet)]]. Keep it private, and do not forward it."],
          careful: "Every call sheet download is written to the log with who took it.",
        },
      ],
    },
  ],
};
