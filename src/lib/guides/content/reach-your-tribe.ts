import type { Guide } from "../types";

/**
 * L10. For tribe leaders (and the assistant leader and coach, who can read the same box): asking the members they cannot reach on WhatsApp, following one up
 * themselves, and writing to the whole tribe by email. The box appears on the Lead page only once the owner has switched Reach series on (and the note
 * button once Tribe note is on), so there are no pictures.
 */
export const reachYourTribe: Guide = {
  code: "L10",
  slug: "reach-your-tribe",
  title: "Reach the members you cannot message on WhatsApp",
  lede: "You can only message a member on WhatsApp if they have added a number and said yes. One button asks the ones who have not, by email, in your name.",
  forWho: "For tribe leaders. The assistant leader and the coach can read the same box",
  audience: ["leader"],
  seenBy: ["assistant_leader", "coach"],
  minutes: 4,
  art: "people",
  ready: ["A minute to write one kind sentence, if you would like to add your own words"],
  whoSees: [
    "A member gets an email from the church office that says you would like to reach them, who can see a number, and that the choice is theirs. A private link opens a one-minute page, and they do not need to sign in.",
    "You see first names and where each person is. You never see a number unless the member ticked WhatsApp. Nobody is moved out of your tribe by any of this.",
  ],
  ifDifferent: "If you do not see **Reaching your tribe** on the Lead page, the church has not switched it on yet, or everyone in your tribe can already be messaged. Your members still get their weekly messages by email.",
  next: ["be-reached"],
  parts: [
    {
      title: "Ask the members you cannot reach",
      blurb: "One button, and four short emails over six days.",
      steps: [
        {
          id: "read-line",
          title: "Read how many you can reach",
          do: ["Open **Lead**. Under **Who has joined**, **Reaching your tribe** says how many of your adults can be messaged on WhatsApp, and lists the first names of the rest."],
          tip: "Under each name it says where they are: **Not asked yet**, **Email 2 of 4 sent**, **Wants email only**, and so on.",
        },
        {
          id: "ask-members",
          title: "Press Ask my members",
          do: ["Press [[Ask my members]]. Add a line of your own if you like, then press the button that says how many will be emailed."],
          example: "Please add it today. It helps me look after you.",
          why: "The email quotes your line in your name. It is the part members are most likely to answer.",
          careful: "No links in your line. If you do nothing, the church sends the first email for you after a day, then three more over the following days.",
        },
        {
          id: "wait-days",
          title: "Let the four emails do their work",
          do: ["Each person is emailed on day 0, 2, 4 and 5, and the series closes on day 6. Anyone who puts it right stops getting emails, and drops off your list."],
          timeline: [
            { when: "Day 0", what: "Email 1, in your name, with your line" },
            { when: "Day 2", what: "A reminder from the church" },
            { when: "Day 4", what: "Email 3, in your name" },
            { when: "Day 5", what: "The last of four, which says so plainly" },
          ],
        },
      ],
    },
    {
      title: "Follow one person up yourself",
      blurb: "For the person you will see on Sunday.",
      steps: [
        {
          id: "follow-up",
          title: "Press I’ll follow this up myself",
          do: ["Beside a name, press [[I’ll follow this up myself]]. That person is not emailed for three days, and you can do it once for each person."],
          careful: "A person who chose email only is never asked again this season. Their name says **Wants email only**.",
        },
      ],
    },
    {
      title: "Write to the whole tribe",
      blurb: "One email in your name, two a week at most.",
      steps: [
        {
          id: "write-note",
          title: "Write your note",
          do: ["Press [[Write to my tribe]], type your note, and press [[Send the note]]. It goes to everyone in your tribe who can be emailed."],
          why: "A member who still has no number finds a button under your words to add it. Everyone else just reads your note.",
          careful: "Up to 600 characters, and no links. The box says how many notes you have sent this week.",
        },
      ],
    },
  ],
};
