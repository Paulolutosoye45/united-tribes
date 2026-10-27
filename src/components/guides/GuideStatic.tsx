import Link from "next/link";
import { Crest } from "@/components/brand/Crest";
import { buttonClasses } from "@/components/ui/Button";
import type { GuideView } from "@/lib/guides/view";
import { IconBack } from "./icons";
import { Pieces } from "./Pieces";
import { StepBody } from "./GuideReader";

/**
 * The whole guide on one page, every step in order, with no script needed. It is what a phone with scripts off sees, what the
 * "Print or save as PDF" button prints, and a way to read it all at once.
 */
export function GuideStatic({ guide }: { guide: GuideView }) {
  const total = guide.steps.length;
  const firstWithPicture = guide.steps.findIndex((s) => s.picture);
  return (
    <div className="min-h-dvh bg-page">
      <header className="glass safe-top sticky top-0 z-30 border-b border-line gd-noprint">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4 sm:px-8">
          <Link href="/guides" className="press -ml-2 inline-flex h-10 items-center gap-1.5 rounded-xl px-2 text-[0.95rem] font-medium text-soft hover:text-ink">
            <IconBack />
            All guides
          </Link>
          <p className="min-w-0 flex-1 truncate text-[0.95rem] font-semibold">
            <span className="text-accent">{guide.code}</span>
            <span className="mx-1.5 text-soft">·</span>
            {guide.title}
          </p>
          <Link href={`/guides/${guide.slug}`} className={buttonClasses({ variant: "quiet", size: "sm" })}>
            <span className="relative">Step through it</span>
          </Link>
        </div>
      </header>
      <main id="content" className="mx-auto flex max-w-4xl flex-col gap-12 px-5 pb-24 pt-8 sm:px-8">
        <div className="night rounded-[var(--radius-sheet)] p-7 sm:p-10">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Crest size={28} tone="light" />
              <p className="text-[0.82rem] font-semibold uppercase tracking-[0.12em] text-white/70">How-to guide · {guide.code}</p>
            </div>
            <h1 className="t-title max-w-[22ch]">{guide.title}</h1>
            <p className="t-body max-w-[46ch] text-white/80">{guide.lede}</p>
            <p className="t-small text-white/70">
              {guide.forWho} · {total} steps · about {guide.minutes} minutes
            </p>
          </div>
        </div>

        <section aria-labelledby="ready-h" className="card flex flex-col gap-4 p-6">
          <h2 id="ready-h" className="t-heading">
            Have these ready
          </h2>
          <ul className="gd-do">
            {guide.ready.map((line, i) => (
              <li key={i} style={{ fontSize: "1.0625rem" }}>
                <Pieces line={line} />
              </li>
            ))}
          </ul>
        </section>

        {guide.steps.map((s, i) => (
          <section key={s.id} id={s.id} className="gd-slide" data-on="true" aria-labelledby={`${s.id}-h`}>
            <StepBody step={s} total={total} first={i === firstWithPicture} />
          </section>
        ))}

        {guide.whoSees.length ? (
          <section aria-labelledby="sees-h" className="card flex flex-col gap-4 p-6">
            <h2 id="sees-h" className="t-heading">
              Who else sees what you just did
            </h2>
            <ul className="gd-do">
              {guide.whoSees.map((line, i) => (
                <li key={i} style={{ fontSize: "1.0625rem" }}>
                  <Pieces line={line} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="flex flex-col gap-2">
          <p className="t-small text-soft">{guide.ifDifferent}</p>
          <p className="t-small text-soft">The pictures show made-up people and were made{guide.madeOn ? ` on ${guide.madeOn}` : " from a practice copy of the site"}.</p>
        </footer>
      </main>
    </div>
  );
}
