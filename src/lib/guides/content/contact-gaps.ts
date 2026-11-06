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
      title: "The four-email series",
      blurb: "Only once the owner has switched Reach series on. It asks for you, and moves nobody.",
      steps: [
        {
          id: "series-stages",
          title: "See where everyone is in it",
          do: ["Under **The contact series**, press a stage to see only those people, or use the **Series** filter. The **Series** column says where each person is, and how many emails they have had."],
          tip: "**Chose email** and **Leader is following up** are the two you leave alone.",
        },
        {
          id: "series-pause",
          title: "Pause it, or stop it for one person",
          do: ["Press [[Pause the series for everyone]] and give a reason, and no more emails go until you press [[Resume the series]]. Beside a name, press **Stop**, give a reason, and that person is not emailed again."],
          careful: "Both need a reason of at least five letters, and both are kept in the log. Nobody is moved or removed by the series.",
        },
      ],
    },
    {
      title: "Nudge the members we placed",
      blurb: "Only once the owner has switched Placed nudge on. It writes to members the church placed who have not yet said yes.",
      steps: [
        {
          id: "nudge-open",
          title: "See who is waiting",
          do: ["On **Today**, under **Placed members waiting**, press [[Nudge them]]. Or press [[Nudge the members we placed]] on this page. The announcement opens already pointed at the members who are waiting, with the count of who will get it."],
          why: "The count leaves out anyone placed less than a day ago, anyone who pressed Don’t share my details, anyone nudged in the last three days and anyone already nudged twice.",
        },
        {
          id: "nudge-write",
          title: "Use the nudge wording",
          do: ["On the second step, press [[Use the nudge wording]] and change the words if you like.", "The three answers and a line about who can see a number are added for you. They cannot be changed."],
          tip: "Send a test to yourself first. It has links that open nothing, so you can press them freely.",
          careful: "While it says Rehearsal, you can count and send yourself a test, but nothing goes to a member.",
        },
        {
          id: "nudge-answer",
          title: "What the member sees",
          do: ["Each member gets their own private link. The page has two buttons that both say yes to the tribe: one also lets their leader message them on WhatsApp, and one is email only. Nothing is saved until they press one."],
          why: "A leader sees a line under a member’s name when the church has reminded them, and Contact gaps shows whose number is confirmed. A number is confirmed when it is the one the member signs in with.",
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
          do: ["Press [[Download the whole list (spreadsheet)]]. It has names, tribe, leader, the reason, how often each was asked, and where each is in the series. It has no phone numbers."],
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
