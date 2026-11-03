"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dismissReachPromptAction } from "@/app/(app)/profile/actions";
import { Button, buttonClasses } from "@/components/ui/Button";
import { REACH_WORDS, type Reach } from "@/lib/contact-gaps/gaps";

/**
 * One quiet notice for a member a leader cannot reach on WhatsApp, shown only while Contact gaps is On:
 *  - no number saved, or one that looks made up: how to be reached, and that every part is their choice;
 *  - a number but WhatsApp not ticked: the leader cannot see it until they say yes.
 * "Not now" keeps it away for a week. It never ticks anything, and it does not repeat the phone-number prompt when that one is already showing.
 */
export function ReachNotice({ reach, numberPromptShown = false, here = "page" }: { reach: Reach; numberPromptShown?: boolean; here?: "page" | "profile" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [away, setAway] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The compulsory-number prompt already says it for someone with no number
  const covered = numberPromptShown && reach.cause !== "no_yes";
  if (!reach.on || !reach.prompt || away || covered || !reach.cause) return null;
  const noYes = reach.cause === "no_yes";

  async function later() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await dismissReachPromptAction();
      if (!out.ok) return setError("We couldn’t save that. Please try again in a moment.");
      setAway(true);
      router.refresh();
    } catch {
      setError("We couldn’t save that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="reach-prompt-h" className="card flex flex-col gap-3 p-5 sm:p-6" data-testid="reach-prompt" data-cause={reach.cause}>
      <div className="flex flex-col gap-1">
        <h2 id="reach-prompt-h" className="t-heading">
          {noYes ? REACH_WORDS.noYesTitle : REACH_WORDS.noNumberTitle}
        </h2>
        <p className="t-small text-soft">{noYes ? REACH_WORDS.noYesBody : REACH_WORDS.noNumberBody}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={here === "profile" ? "#contact" : "/profile#contact"} className={buttonClasses({ size: "md" })} data-testid="reach-prompt-open">
          <span className="relative">{REACH_WORDS.open}</span>
        </Link>
        <Button size="md" variant="ghost" loading={busy} onClick={() => void later()} data-testid="reach-prompt-later">
          {REACH_WORDS.later}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
