"use client";

import { useRouter } from "next/navigation";
import { myPageAnswerAction } from "@/app/(app)/my/actions";
import { FactQuestion } from "@/components/profile/FactQuestion";
import { lagosWhen } from "@/lib/features/wording";
import type { PageFact } from "@/lib/profile/types";
import { standing } from "@/lib/profile/wording";

/** The facts on My page, one card each. A fact someone else wrote is a question; one the person has confirmed shows what it is and lets them change it. */
export function MyFacts({ facts }: { facts: PageFact[] }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4" data-testid="my-facts">
      {facts.map((f) => {
        const pending = f.change?.status === "pending";
        const confirmed = f.state === "confirmed";
        return (
          <div key={`${f.key}:${f.state}:${f.value}:${f.change?.status ?? ""}`} className="flex flex-col gap-3">
            <FactQuestion
              testId={`my-${f.key}`}
              label={f.label}
              question={confirmed ? `Your ${f.label.toLowerCase()} is ${f.valueLabel}.` : f.question}
              valueLabel={f.valueLabel}
              options={f.options}
              confirmed={confirmed}
              waiting={pending}
              standing={standing(f.by, confirmed)}
              onAnswer={(action, value) => myPageAnswerAction(f.key, action, value)}
              onDone={() => window.setTimeout(() => router.refresh(), 2500)}
            />
            {f.change && f.change.status === "pending" ? (
              <p className="t-small text-soft" data-testid={`my-${f.key}-pending`}>
                You asked for {f.change.newLabel}. A pastor will look at it{f.change.dueOn ? ` by ${f.change.dueOn}` : ""}. Until then it stays as it is.
              </p>
            ) : null}
            {f.change && f.change.status === "declined" ? (
              <p className="t-small text-soft" data-testid={`my-${f.key}-declined`}>
                A pastor kept this as it was{f.change.note ? `: “${f.change.note}”` : "."}
              </p>
            ) : null}
            {f.change && f.change.status === "approved" ? (
              <p className="t-small text-soft">A pastor agreed to the change you asked for{f.last ? ` (${lagosWhen(f.last.at)})` : ""}.</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
