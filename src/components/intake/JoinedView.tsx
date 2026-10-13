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
  teen = false,
}: {
  answers: Answers;
  catalogue: Catalogue;
  seasonName: string | null;
  seasonStarts: string | null;
  /** Under 18 and not yet cleared: the next step is the parent or guardian, not the tribes. */
  teen?: boolean;
}) {
  const community = catalogue.communities.find((t) => t.slug === answers.community);
  const goal = community?.goals.find((g) => g.slug === answers.goal)?.title ?? answers.goalOther;
  const age = catalogue.ageRanges.find((r) => r.slug === answers.ageRange)?.label;

  return (
    <div className="flex flex-col gap-8">
      <section className="night rounded-[var(--radius-sheet)] p-6 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3">
            <Badge tone="gold" className="self-start">Answers saved</Badge>
            <h1 className="t-title">You’re in{answers.preferredName ? `, ${answers.preferredName}` : ""}.</h1>
            <p className="t-body max-w-[44ch] text-white/80">
              {teen
                ? "Because you are under 18, your parent or guardian needs to say yes before we show you tribes."
                : seasonName
                  ? `We’ll match you for ${seasonName}${seasonStarts ? `, which starts on ${seasonStarts}` : ""}. See which tribes fit you, each with its own score.`
                  : "See which tribes fit you, each with its own score."}
            </p>
            <div className="pt-1">
              <Link href="/tribe" className={buttonClasses({ className: "px-8" })}>
                <span className="relative">{teen ? "Ask my parent or guardian" : "See my tribes"}</span>
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
            { label: "Community", value: community?.name ?? answers.communityOther },
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
