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
      "Your name and email address when you sign in. If you fill in the form: your age range, optional birthday (day and month only), gender, where you are based, your tribe and goal, where you are on your walk with God, how and when you could meet, how you like to be in a group, and optional notes, such as anything that would help us care for you or a WhatsApp number.",
      "Some of this, including your faith journey and anything you tell us about your wellbeing, is sensitive. We only use it with your agreement, and only for the reasons below.",
    ],
  },
  {
    title: "Signing in with WhatsApp",
    body: [
      "If you choose to sign in with a code on WhatsApp, you add your WhatsApp number to your account and we send a six-digit code to it each time you sign in. The number is held by our sign-in service and by the company that delivers the message (WhatsApp, which belongs to Meta). It is used only to send you sign-in codes. It is not copied into your answers and your leader and Tribe never see it. You can change the number at any time from Privacy and my data, and you can always sign in with Google or an email code instead.",
    ],
  },
  {
    title: "Why we use it",
    body: [
      "To match you with a small group, to help your leader welcome you, to remind you about meetings if you ask, and to see how the programme is doing overall (for example how many people finished the form and how long it took), without looking at any one person’s answers.",
    ],
  },
  {
    title: "Who can see it",
    body: [
      "Today only you can see your answers. When Tribes begin, your leader will see only what helps them welcome you. Anything you write for our care team stays with the care team and your leader. Nobody outside the programme sees your answers, and we do not sell or share them for advertising.",
    ],
  },
  {
    title: "If you apply to lead, or give a reference",
    body: [
      "When you apply to lead a Tribe we collect your answers, your WhatsApp number, the names and contact details of your two referees, and the scores the review gives you. Your referees answer four short questions about you and can raise a concern. A panel of pastors, directors and coaches reads your application, scores it on their own, and a pastor makes the final decision. Nobody else sees it. You never see your referees’ ratings or notes, or the panel’s scores.",
      "You can withdraw and delete your application at any time until you are approved. If you are approved, we keep the record of your application and the decision, so that members can be kept safe. If you give a reference, we keep your name, your contact details, your ratings and your note only for this review, and your private link works once.",
    ],
  },
  {
    title: "The AI assistant",
    body: [
      "If you agree, a sentence you write about your season is sent to an AI service (Anthropic or OpenAI) so it can suggest a tribe and goal. We remove email addresses and phone numbers first and send nothing else from your profile. Notes about your wellbeing or support needs are never sent. You can turn this off at any time, and you can complete the whole form without it.",
    ],
  },
  {
    title: "Your choices and rights",
    body: [
      "You can see, change or delete your answers and withdraw any agreement at any time from Privacy and my data. Deleting your answers removes them from the system. You may also ask us to give you a copy of your information, to correct it, or to complain to the Nigeria Data Protection Commission.",
    ],
  },
  {
    title: "How long we keep it",
    body: ["We keep your answers while you are part of the programme and delete them when you ask. Unfinished forms are deleted if you withdraw your agreement."],
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
