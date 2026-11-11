import type { Guide } from "../types";

/**
 * L11. For tribe leaders (the assistant leader and the coach can read it too): the questions leaders ask most, in plain words, with the answer first.
 * It has no pictures: every answer is a few lines, and none of them depends on a screen that only exists when a switch is On.
 */
export const leaderQuestions: Guide = {
  code: "L11",
  slug: "leader-questions",
  title: "Questions leaders ask",
  lede: "Finishing your card, when you see your members, why a number is not showing yet, the WhatsApp group, and what to do when someone says no.",
  forWho: "For tribe leaders. The assistant leader and the coach can read it too",
  audience: ["leader"],
  seenBy: ["assistant_leader", "coach"],
  minutes: 5,
  art: "tribe",
  ready: [],
  ifDifferent: "If a screen looks different from what is described here, or a page says something this guide does not, ask your coach. Your coach would rather be asked than have you guess.",
  next: ["appointed-to-lead", "run-your-week", "ask-about-a-place"],
  parts: [
    {
      title: "Your card and your members",
      blurb: "When your tribe opens, and who you can see.",
      steps: [
        {
          id: "finish-card",
          title: "How do I finish my Tribe Card?",
          do: [
            "Open **Lead**. If your card is not finished, the box at the top says so and has one button that opens it.",
            "Fill in the four things only you can say: your story, the time you meet, how you meet (in person or online) and your area. Then send it in.",
            "A pastor reads it. Your tribe opens, and your weekly page with it, once the card is approved. If the pastor asks for a change, the card comes back to you with what to change.",
          ],
          tip: "You do not need to do it in one go. What you write is kept as you go.",
        },
        {
          id: "see-members",
          title: "When do I see my members?",
          do: [
            "You see every member the church places in your tribe by name, as soon as they are placed. They are on **My tribe**, **This week** and **Lead**.",
            "Each name says where the person is: **Placed by the church, yet to answer**, **Said yes**, **Details open**, **Details withheld** or **Not yet reached**.",
          ],
          why: "A new member has just been told they have a tribe. Their email address and WhatsApp number open for you one person at a time, as they answer, so nobody is contacted before they have heard from the church.",
        },
        {
          id: "number-missing",
          title: "Why is a number not showing yet?",
          do: [
            "A member's number and email open for you when they say yes, when they agreed on their form, or when about a day has passed after their own email went out.",
            "A member who chose **Don't share my details** is never opened, for you or anyone else. Their name stays on your list.",
            "**Not yet reached** means the church's email to them did not arrive. Their details do not open by themselves. Tell the office so they can fix the address.",
          ],
          careful: "Do not ask a member for a number the church is holding back. If you need to reach them, ask your coach or the office.",
        },
      ],
    },
    {
      title: "Your WhatsApp group and people who say no",
      steps: [
        {
          id: "whatsapp-group",
          title: "How do I admit people to the WhatsApp group?",
          do: [
            "Each member gets the group link in their own email from the church, once they have said yes, agreed on their form, or the wait has ended. They join by pressing it.",
            "If you have chosen to approve people before they join, do it in WhatsApp: open the group, tap its name, and look for the people waiting to join.",
            "Add only the people on your list on **This week**. If someone you do not know asks to join, leave them waiting and ask your coach.",
          ],
          careful: "Joining a WhatsApp group shows a member's number to everyone in it. Members are told this before they join. Never add someone who has not asked to be there.",
        },
        {
          id: "someone-declines",
          title: "What do I do when someone says no?",
          do: [
            "Thank them, and do not try to persuade them. A person who feels free to say no is more likely to come back.",
            "If they would like a different tribe, or you think a member's place should change, use **Ask about a member's place** on **My tribe**. A coach and the office decide, and you are told the answer.",
            "If someone has gone quiet, not said no, a call is kinder than a message. **People to call first** on **This week** lists them.",
          ],
          tip: "Nobody misses twice without a call. A short, warm message counts.",
        },
      ],
    },
  ],
};
