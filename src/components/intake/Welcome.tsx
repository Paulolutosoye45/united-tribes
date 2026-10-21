"use client";

import Link from "next/link";
import { Choice } from "@/components/ui/Choice";
import { AI_CONSENT, MATCHING_CONSENT, TEAM_CONTACT_CONSENT } from "@/lib/intake/consent";
import { StepHeading } from "./ui";

const POINTS = [
  { title: "What we ask", body: "Your season of life, your goal and when you could meet. No test, no wrong answers." },
  {
    title: "Who sees it",
    body: "Your answers match you to a tribe. Once you join, your leader sees your name, your goal, the part you play in a group and any note you write to them. They see your number only if you choose WhatsApp. What you say about needing extra care is locked so only you can read it.",
  },
  {
    title: "Your Companion",
    body: "As you answer, a helper on your phone suggests the next answers and says why, so you type less. It never decides for you: every answer is yours to change, and you can turn it off.",
  },
  { title: "Your control", body: "Change or delete your answers any time. Stop halfway and pick up later." },
];

export function Welcome({
  aiAvailable,
  matching,
  ai,
  onMatching,
  onAi,
  share = false,
  onShare,
  seasonName,
}: {
  aiAvailable: boolean;
  matching: boolean;
  ai: boolean;
  onMatching: (v: boolean) => void;
  onAi: (v: boolean) => void;
  /** Whether a leader may be given their contact details at once. Left out for a young person, who is never placed automatically. */
  share?: boolean;
  onShare?: (v: boolean) => void;
  seasonName: string | null;
}) {
  return (
    <>
      <StepHeading
        title="Let’s find your tribe."
        hint={`It takes about four minutes.${seasonName ? ` These answers place you for ${seasonName}.` : ""} Here is how we look after what you share.`}
      />
      <ul className="card rise-in mb-8 divide-y divide-line overflow-hidden">
        {POINTS.map((p) => (
          <li key={p.title} className="px-5 py-4">
            <h2 className="font-semibold">{p.title}</h2>
            <p className="t-small mt-0.5 text-soft">{p.body}</p>
          </li>
        ))}
      </ul>

      <fieldset className="flex flex-col gap-3">
        <legend className="t-heading mb-3">Your agreement</legend>
        <Choice
          type="checkbox"
          name="consent-matching"
          value="yes"
          checked={matching}
          onChange={(e) => onMatching(e.target.checked)}
          title={MATCHING_CONSENT}
          description="Needed to continue"
        />
        {aiAvailable ? (
          <Choice
            type="checkbox"
            name="consent-ai"
            value="yes"
            checked={ai}
            onChange={(e) => onAi(e.target.checked)}
            title={AI_CONSENT}
            description="Optional. Say no and the Companion still suggests answers on your phone. Nothing you write goes to an AI service."
          />
        ) : null}
        {onShare ? (
          <Choice
            type="checkbox"
            name="consent-share"
            value="yes"
            checked={share}
            onChange={(e) => onShare(e.target.checked)}
            title={TEAM_CONTACT_CONSENT}
            description="Optional. If you leave it empty, we tell you your tribe first and give you a day to say no before your leader is given anything."
          />
        ) : null}
      </fieldset>
      <p className="t-small mt-4 text-soft">
        You can change either choice later. Read the full{" "}
        <Link href="/privacy" target="_blank" className="font-semibold text-ink underline underline-offset-4">
          privacy notice
        </Link>
        .
      </p>
    </>
  );
}
