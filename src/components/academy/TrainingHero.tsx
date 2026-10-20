import Link from "next/link";
import { ShieldProgress } from "@/components/brand/ShieldProgress";
import { buttonClasses } from "@/components/ui/Button";
import { academyOpen, parseAcademyModes } from "@/lib/academy/modes";
import { certificationSummary, nextAction, shieldFills } from "@/lib/academy/options";
import type { MyAcademy } from "@/lib/academy/types";

/** The top of the training page: where you are, and the one thing to do next. */
export function TrainingHero({ my }: { my: MyAcademy }) {
  const s = my.state;
  const modes = parseAcademyModes(my.modes);
  const { total, done, sentence } = certificationSummary(my);
  const next = nextAction(my);
  return (
    <section aria-labelledby="training-heading" className="night rise-in rounded-[var(--radius-sheet)] p-6 sm:p-10">
      <div className="flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-[34rem] flex-col gap-3">
          <p className="t-small text-white/70">{academyOpen(modes) ? "Leader Academy" : "Becoming certified"}</p>
          <h1 id="training-heading" className="t-title pr-14 sm:pr-0">
            {s.certified ? "You are certified." : `${done} of ${total} done`}
          </h1>
          <p className="t-body text-white/80">
            {s.certified ? next.body : sentence}
          </p>
          {!s.certified && modes.academy === "optional" ? (
            <p className="t-small text-white/70" data-testid="academy-optional-note">
              The modules, the workshops and the practice session are open to you if you would like them. Certification does not wait for them.
            </p>
          ) : null}
          {!s.certified ? (
            <div className="mt-1 flex flex-col gap-1">
              <p className="font-semibold">{next.title}</p>
              <p className="t-small text-white/70">{next.body}</p>
            </div>
          ) : null}
          <div>
            <Link href={next.href} className={buttonClasses({ className: "px-8" })}>
              <span className="relative">{next.cta}</span>
            </Link>
          </div>
        </div>
        <div className="absolute right-5 top-5 origin-top-right scale-50 sm:static sm:shrink-0 sm:scale-100">
          <ShieldProgress fills={shieldFills(my)} size={104} tone="light" label={s.certified ? "Certified" : `Training progress, ${done} of ${total} done`} done={s.certified} />
        </div>
      </div>
    </section>
  );
}
