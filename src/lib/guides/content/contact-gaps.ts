import type { Guide } from "../types";

/**
 * A3. For the admin, the director and the data lead (who can ask people and download the list), and the pastor and care lead (who can read it): finding the
 * members a leader cannot reach on WhatsApp, and asking them by email. The page exists only once the owner has switched Contact gaps on, so there are no pictures.
 */
export const contactGaps: Guide = {
  code: "A3",
  slug: "contact-gaps",
  title: "Find the members a leader cannot reach, and ask them",
  lede: "A leader can only message a member on WhatsApp if the member has added a number and said yes to WhatsApp. This shows who has not, and why.",
  forWho: "For the admin, the director and the data lead. The pastor and care lead can read the list",
  audience: ["admin"],
  seenBy: ["director", "data_lead", "pastor", "care_lead"],
  minutes: 5,
  art: "people",
  ready: ["A few minutes, and nothing else. No phone number is shown on this page, so there is nothing to keep private."],
  whoSees: [
    "A member who is asked gets one short email from the church office. It says their leader would like to reach them, who can see a number, and that the choice is theirs.",
    "A leader sees the first names of the people in their own tribe who can be asked, and whether each was asked. They never see a number unless the member said yes to WhatsApp.",
  ],
  ifDifferent: "If you cannot find Contact gaps under People, the owner has not switched it on yet. Until then nobody is asked and no member sees a prompt.",
  next: [],
  parts: [
    {
      title: "See who cannot be reached",
      blurb: "Names only, with the reason beside each.",
      steps: [
        {
          id: "open-gaps",
          title: "Open Contact gaps",
          do: ["Open **Admin**, then **People**, and press [[Contact gaps]]."],
        },
        {
          id: "read-reasons",
          title: "Read the reasons",
          do: [
            "The boxes at the top count the adults in a tribe by the reason a leader cannot reach them. **No number saved** and **Number saved, WhatsApp not agreed** are the two the church can ask about.",
            "**No way to be reached** means there is no number and email is switched off. Only a person can ask them, in person.",
          ],
          tip: "Press a box to see only those people. Press it again to see everyone.",
        },
        {
          id: "leave-alone",
          title: "Leave some people alone",
          do: ["**Said “Don’t share”** is the member’s own choice, and **Contact not open yet** opens by itself. Neither is ever asked."],
          careful: "Nobody is asked more than three times, or twice in two weeks. The list says when each person was last asked.",
        },
      ],
    },
    {
      title: "Ask them",
      blurb: "One email, from the office, that leaves the choice with them.",
      steps: [
        {
          id: "write-to-them",
          title: "Write to the people who can be asked",
          do: ["Press [[Write to the people who can be asked]]. The announcement opens already pointed at them, with the count of who will be written to."],
          why: "The count leaves out anyone asked recently, anyone already asked three times, and anyone who has put it right since the list was made.",
        },
        {
          id: "pick-note",
          title: "Start from a note",
          do: ["On the second step, choose **Add your number** or **Tick WhatsApp if you are happy**. Change the words if you like, then send it as you would any announcement."],
          tip: "To remind everyone how to choose how they are reached, write to **Everyone** and start from **How would you like to be reached?**",
        },
      ],
    },
    {
      title: "Keep a copy, and watch it improve",
      blurb: "For the data lead, the director and the admin.",
      steps: [
        {
          id: "download",
          title: "Download the list",
          do: ["Press [[Download the whole list (spreadsheet)]]. It has names, tribe, leader, the reason and how often each was asked. It has no phone numbers."],
        },
        {
          id: "trend",
          title: "Check it is getting better",
          do: ["Under **Is it getting better?** the bars show how many cannot be reached, each day the list was opened."],
        },
      ],
    },
  ],
};
