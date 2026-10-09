import Link from "next/link";
import { ShieldProgress } from "@/components/brand/ShieldProgress";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import type { Answers } from "@/lib/intake/answers";
import type { Catalogue } from "./types";

/** What a person sees after they have finished the form. */
export function JoinedView({
  answers,
  catalogue,
  seasonName,
  seasonStarts,
}: {
  answers: Answers;
  catalogue: Catalogue;
  seasonName: string | null;
  seasonStarts: string | null;
}) {
  const tribe = catalogue.tribes.find((t) => t.slug === answers.tribe);
  const goal = tribe?.goals.find((g) => g.slug === answers.goal)?.title ?? answers.goalOther;
  const age = catalogue.ageRanges.find((r) => r.slug === answers.ageRange)?.label;

  return (
    <div className="flex flex-col gap-8">
      <section className="night rounded-[var(--radius-sheet)] p-6 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3">
            <Badge tone="gold" className="self-start">Answers saved</Badge>
            <h1 className="t-title">You’re in{answers.preferredName ? `, ${answers.preferredName}` : ""}.</h1>
            <p className="t-body max-w-[44ch] text-white/80">
              {seasonName
                ? `We’ll match you for ${seasonName}${seasonStarts ? `, which starts on ${seasonStarts}` : ""}. See which Tribes fit you, each with its own score.`
                : "See which Tribes fit you, each with its own score."}
            </p>
            <div className="pt-1">
              <Link href="/circle" className={buttonClasses({ className: "px-8" })}>
                <span className="relative">See my Tribes</span>
              </Link>
            </div>
          </div>
          <div className="pop-in absolute right-4 top-4 origin-top-right scale-75 sm:static sm:shrink-0 sm:scale-100">
            <ShieldProgress fills={[1, 1, 1, 1]} size={96} tone="light" label="Your shield is complete" done />
          </div>
        </div>
      </section>

      <section aria-labelledby="summary-heading" className="flex flex-col gap-4">
        <h2 id="summary-heading" className="t-heading">
          What we have for you
        </h2>
        <dl className="stagger grid gap-3 sm:grid-cols-3">
          {[
            { label: "Tribe", value: tribe?.name ?? answers.tribeOther },
            { label: "Season goal", value: goal },
            { label: "Age range", value: age },
          ].map((item, i) => (
            <div key={item.label} className="card p-4 sm:p-5" style={{ ["--i" as string]: i }}>
              <dt className="t-small text-soft">{item.label}</dt>
              <dd className="mt-1 text-[1.05rem] font-semibold leading-snug">{item.value ?? "Not set"}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-3">
          <Link href="/join?edit=1" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Change my answers</span>
          </Link>
          <Link href="/profile" className={buttonClasses({ variant: "ghost", size: "md" })}>
            <span className="relative">Privacy and my data</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
