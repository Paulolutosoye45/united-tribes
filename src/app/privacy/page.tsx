import type { Metadata } from "next";
import Link from "next/link";
import { Crest } from "@/components/brand/Crest";

export const metadata: Metadata = { title: "Privacy notice" };

const SECTIONS = [
  {
    title: "Who we are",
    body: [
      "United Tribes is a small-group programme of The Covenant Nation, Iganmu, Lagos. The Covenant Nation decides how and why your information is used.",
    ],
  },
  {
    title: "What we collect",
    body: [
      "Your name and email address when you sign in. If you fill in the form: your age range, optional birthday (day and month only), gender, where you are based, your community and goal, where you are on your walk with God, how and when you could meet, how you like to be in a group, an optional photo, and optional notes, such as anything that would help us care for you or a WhatsApp number.",
      "Once you are in a tribe: whether you came to each meeting, the small step you chose each week and how it went, a short check-in on how you are doing, and any testimony you choose to share.",
      "Some of this, including your faith journey and anything you tell us about your wellbeing, is sensitive. We only use it with your agreement, and only for the reasons below.",
    ],
  },
  {
    title: "Signing in with WhatsApp",
    body: [
      "If you choose to sign in with a code on WhatsApp, you add your WhatsApp number to your account and we send a six-digit code to it each time you sign in. The number is held by our sign-in service and by the company that delivers the message (WhatsApp, which belongs to Meta). It is used only to send you sign-in codes. It is not copied into your answers and your leader and tribe never see it. You can change the number at any time from Privacy and my data, and you can always sign in with Google or an email code instead.",
    ],
  },
  {
    title: "Why we use it",
    body: [
      "To match you with a small group, to help your leader welcome you and look after the tribe, to remind you about meetings if you ask, and to see how the programme is doing overall (for example how many people came, how many are doing well and how long the form took).",
    ],
  },
  {
    title: "Who can see it",
    body: [
      "Your leader sees what helps them welcome you and look after the tribe: your name, how you like to be in a group, whether you came to each meeting, whether you did your weekly step (not what you wrote about it), and any note you chose to write for them. Your check-in answers are never shown to the tribe. The notes you write about needing extra care, and the note to your leader, are locked with a key that is kept apart from our database, so a copy of the database cannot read them. If a check-in or a leader’s note shows you may need help, your leader or the small care team is told, so that someone can reach out.",
      "A few people in the church office (admins and directors, and pastors and data leads for the parts of their work) see programme-wide numbers. These are counts and rates, not your answers. For reports, we keep a separate copy of the numbers in which each person is a code, with no name, email address, phone number or written notes.",
      "Nobody outside the programme sees your answers, and we do not sell or share them for advertising.",
    ],
  },
  {
    title: "Messages we send you",
    body: [
      "If you agree, we send reminders and messages from your tribe by WhatsApp, email or text message. We send nothing between 10 pm and 6 am except an urgent care alert. You choose the ways we may reach you and can change them at any time; on WhatsApp you can reply STOP. Our message providers (for example Meta for WhatsApp, an email service and a text-message service) handle the number or address in order to deliver the message.",
    ],
  },
  {
    title: "Voice notes",
    body: [
      "If voice notes are switched on, you can record about a minute about your season. The recording is sent to a speech-to-text service to be turned into words and is not stored by us. You can type instead.",
    ],
  },
  {
    title: "If you apply to lead, or give a reference",
    body: [
      "When you apply to lead a tribe we collect your answers, your WhatsApp number, the names and contact details of your two referees, and the scores the review gives you. Your referees answer four short questions about you and can raise a concern. A panel of pastors, directors and coaches reads your application, scores it on their own, and a pastor makes the final decision. Nobody else sees it. You never see your referees’ ratings or notes, or the panel’s scores.",
      "You can withdraw and delete your application at any time until you are approved. If you are approved, we keep the record of your application and the decision while you serve, so that members can be kept safe. If you give a reference, we keep your name, your contact details, your ratings and your note only for this review, and your private link works once.",
      "We check that a reference comes from the person the applicant named. The private link goes only to the phone number or email the applicant gave, and a six-digit code goes to the same place; the ratings cannot be sent until that code is typed in. We compare the contact with the church’s own list of pastors and unit heads, which only the pastors, the director and the admins can see and which the applicant never sees. To notice when someone answers as their own referee, we keep two scrambled codes (they cannot be turned back into an address or a person): one for the network and one for the browser the link was opened on, next to the same codes from the applicant’s own sign-ins. They are deleted after 45 days. Some references are followed up with a short call from the care team to the number or email the applicant gave. Nothing in this check is shown to the applicant except whether the request was sent, opened, confirmed and answered.",
    ],
  },
  {
    title: "Young people and their parents",
    body: [
      "If the church runs tribes for ages 13 to 17, a parent or guardian is asked for permission by a private link before a young person takes part. We keep the parent’s name and contact details to show that permission was given, and remove them 90 days after the young person’s last season ends. The parent can take their permission back at any time from the same link.",
    ],
  },
  {
    title: "The AI assistant",
    body: [
      "If you agree, a sentence you write about your season is sent to an AI service (Anthropic or OpenAI) so it can suggest a community and goal. We remove email addresses and phone numbers first and send nothing else from your profile. Notes about your wellbeing or support needs are never sent. You can turn this off at any time, and you can complete the whole form without it.",
    ],
  },
  {
    title: "Your Companion: suggestions on your phone",
    body: [
      "While you fill in the form, a helper called your Companion suggests answers and says why, such as ticking “Married” because you wrote it, or putting a community first. It runs in your browser, on your phone. What it reads is not sent anywhere by the Companion, and it works whether or not you agreed to the AI assistant above. What it learns from your corrections is forgotten when you close the page.",
      "It never reads the notes you write about needing care or the note to your leader. It does not guess painful things such as the end of a marriage: if you say them, it may use them to put a gentler option first, but it will not tick them for you. It does not use your gender. It does not read the words of anyone under 18. Everything it fills in is marked, explained and one tap from being changed, and you can turn it off from the form.",
      "When you finish, we keep a record of which suggestions were shown, which you chose and whether the Companion filled an answer in before you touched it. It holds codes for the options, never your words. We use it to see whether the suggestions are useful.",
    ],
  },
  {
    title: "The platform administrator",
    body: [
      "One platform administrator account looks after the system itself. Its holder can open every page and see what every member and leader has answered and done, so that problems can be fixed and the platform kept safe. It is not shown in the lists that other staff see. It needs a second passphrase on top of signing in, which ends after four hours, and everything it does is written to a separate record that only that account can read. It cannot open the locked notes described above. If you want to know more about it, ask the church office.",
    ],
  },
  {
    title: "Keeping the site safe",
    body: [
      "To keep out automated abuse, the sign-in page and the private links we send to parents and referees may use a check from Cloudflare (Turnstile), which looks at how your browser behaves, not at who you are. We keep a log of important actions (for example that a leader was approved or an account was deleted). The log records what happened and who did it, not what you wrote.",
    ],
  },
  {
    title: "Your choices and rights",
    body: [
      "From Privacy and my data you can see, change or delete your answers, change how we reach you, turn the AI assistant on or off, and withdraw any agreement, at any time. Under Your data you can download a copy of everything we hold about you in one file, including your private notes written out in words.",
      "You can also ask for your whole account to be deleted. A member of the church office reads each request, because some people cannot be deleted straight away (for example someone who is leading a tribe, or whose record the church must keep to keep members safe). If your request cannot go ahead yet, you are told why on your profile. If it does, your account and what is linked to it are deleted and you are signed out; you can always join again later as a new member. You may also ask us to correct your information, or complain to the Nigeria Data Protection Commission.",
    ],
  },
  {
    title: "How long we keep it",
    body: [
      "We keep your answers while you are part of the programme and delete them when you ask. A form you started but did not finish is deleted after 30 days. The sentence you wrote about your season is removed when that season ends. The wording of messages we sent you is removed after 90 days (we keep only that a message was sent, by which channel, and whether it arrived). Messages sent to someone who is not a member, such as a referee or a parent, are deleted after 90 days. The codes and links for referees are cleared as soon as the message goes out.",
      "When your account is deleted it is removed from the live system straight away. Copies in our database backups disappear when those backups are replaced, and the reporting copy drops you at its next daily refresh.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-10 px-5 py-12 sm:px-8">
      <header className="flex flex-col gap-4">
        <Link href="/home" className="press flex w-fit items-center gap-3 rounded-lg">
          <Crest size={30} />
          <span className="t-heading" style={{ fontStretch: "88%" }}>
            United Tribes
          </span>
        </Link>
        <h1 className="t-title">Privacy notice</h1>
        <p className="t-body text-soft">In plain words. Draft wording: have counsel review it against the Nigeria Data Protection Act 2023 before launch, and add the office’s contact details.</p>
      </header>
      {SECTIONS.map((s) => (
        <section key={s.title} className="flex flex-col gap-3">
          <h2 className="t-heading">{s.title}</h2>
          {s.body.map((p) => (
            <p key={p} className="t-body measure text-soft">
              {p}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
