"use client";

import Link from "next/link";
import { Choice } from "@/components/ui/Choice";
import { AI_CONSENT, MATCHING_CONSENT } from "@/lib/intake/consent";
import { StepHeading } from "./ui";

const POINTS = [
  { title: "What we ask", body: "Your season of life, your goal and when you could meet. No test, no wrong answers." },
  { title: "Who sees it", body: "Private. Used to match you. Your leader sees only what helps them welcome you." },
  { title: "Your control", body: "Change or delete your answers any time. Stop halfway and pick up later." },
];

export function Welcome({
  aiAvailable,
  matching,
  ai,
  onMatching,
  onAi,
  seasonName,
}: {
  aiAvailable: boolean;
  matching: boolean;
  ai: boolean;
  onMatching: (v: boolean) => void;
  onAi: (v: boolean) => void;
  seasonName: string | null;
}) {
  return (
    <>
      <StepHeading
        title="Let’s find your Tribe."
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
            description="Optional. Say no and you simply tap your answers."
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
