import type { Guide } from "../types";

/**
 * M7. For everyone: choosing how you are reached (a number, WhatsApp, email, text), and for a tribe leader, asking a member who has not added one. The notice
 * and the leader's button appear only once the owner has switched Contact gaps on, so there are no pictures.
 */
export const beReached: Guide = {
  code: "M7",
  slug: "be-reached",
  title: "Choose how you are reached",
  lede: "Your leader can only message you where you have said you are happy to be messaged. You decide, and you can change it any time.",
  forWho: "For every member. The last part is for tribe leaders",
  audience: ["member"],
  minutes: 3,
  art: "privacy",
  ready: ["Your phone number, if you would like to share it"],
  whoSees: [
    "Only your tribe’s leader, their assistant and your coach can see your number, and only if WhatsApp is ticked. Other members never see it.",
    "If you leave a box unticked, nobody is told. The church simply uses the ways you have said yes to.",
  ],
  ifDifferent: "If you do not see a note about how to be reached, there is nothing to put right, or the church has not switched it on yet. Your profile always has the boxes.",
  next: [],
  parts: [
    {
      title: "Say how you would like to be reached",
      blurb: "Every part is your choice.",
      steps: [
        {
          id: "open-contact",
          title: "Open how we reach you",
          do: ["Open **Profile**. If the church has a note for you, press [[Choose how I am reached]]. Otherwise scroll to **How we reach you**."],
          tip: "Press [[Not now]] on the note and it stays away for a week.",
        },
        {
          id: "add-number",
          title: "Add a number, if you are happy to",
          do: ["Type your number in **Phone number**. If you sign in with a number, you may see a button to use that one. It only fills the box."],
          careful: "Nothing is saved until you press **Save**, and WhatsApp stays unticked until you tick it yourself.",
        },
        {
          id: "tick-ways",
          title: "Tick the ways you say yes to",
          do: ["Under **You can message me by**, tick **WhatsApp**, **Email** and **Text message** as you like, then press **Save**."],
          why: "A leader can message you on WhatsApp only if you add a number and tick WhatsApp. Leave either out and your leader will use email.",
        },
      ],
    },
    {
      title: "If you lead a tribe",
      blurb: "Asking someone to add a number, kindly.",
      steps: [
        {
          id: "see-who",
          title: "See who you cannot reach",
          do: ["On **Lead**, under **Who has joined**, **People whose number you cannot see** lists their first names. It never shows a number."],
          tip: "If you see **Reaching your tribe** instead, the church has switched on the four-email series. Open **Reach the members you cannot message on WhatsApp**.",
        },
        {
          id: "ask-them",
          title: "Ask them by email",
          do: ["Press **Ask … to add it** beside a name. They get one short email from the church that says you would like to reach them and that the choice is theirs."],
          careful: "You can ask a person once every two weeks, and no more than three times. If they cannot be emailed, the list says **Please ask in person**.",
        },
      ],
    },
  ],
};
