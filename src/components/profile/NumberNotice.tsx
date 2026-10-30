"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dismissNumberPromptAction } from "@/app/(app)/profile/actions";
import { Button, buttonClasses } from "@/components/ui/Button";
import { NUMBER_WORDS, type NumberRule } from "@/lib/messaging/number-rule";

/**
 * Two quiet notices about the phone number, shown only while the church has made it compulsory (the rule is On):
 *  - the prompt, for an adult member with no number saved: "Add my number", or "Not now" (it stays away for a week);
 *  - the two-numbers note, when the number they sign in with is not the number we message: both numbers, for them alone.
 * Nothing here is sent to anyone, and neither blocks the page. Off, the rule is four "no"s and nothing is drawn.
 */
export function NumberNotice({ rule, here = "page" }: { rule: NumberRule; here?: "page" | "profile" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [away, setAway] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showPrompt = rule.prompt && !away;
  if (!showPrompt && !rule.mismatch) return null;

  async function later() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await dismissNumberPromptAction();
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
    <div className="flex flex-col gap-4" data-testid="number-notices">
      {showPrompt ? (
        <section aria-labelledby="number-prompt-h" className="card flex flex-col gap-3 p-5 sm:p-6" data-testid="number-prompt">
          <div className="flex flex-col gap-1">
            <h2 id="number-prompt-h" className="t-heading">
              {NUMBER_WORDS.promptTitle}
            </h2>
            <p className="t-small text-soft">{NUMBER_WORDS.promptBody}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={here === "profile" ? "#contact" : "/profile#contact"} className={buttonClasses({ size: "md" })} data-testid="number-prompt-add">
              <span className="relative">{NUMBER_WORDS.promptAdd}</span>
            </Link>
            <Button size="md" variant="ghost" loading={busy} onClick={() => void later()} data-testid="number-prompt-later">
              {NUMBER_WORDS.promptLater}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
      {rule.mismatch ? (
        <section aria-labelledby="number-mismatch-h" className="card flex flex-col gap-1 p-5 sm:p-6" data-testid="number-mismatch">
          <h2 id="number-mismatch-h" className="t-heading">
            {NUMBER_WORDS.mismatchTitle}
          </h2>
          <p className="t-small text-soft">{NUMBER_WORDS.mismatch(rule.mismatch.signin, rule.mismatch.contact)}</p>
          {here === "profile" ? null : (
            <Link href="/profile#contact" className="t-small w-fit underline" data-testid="number-mismatch-change">
              Change my number
            </Link>
          )}
        </section>
      ) : null}
    </div>
  );
}
