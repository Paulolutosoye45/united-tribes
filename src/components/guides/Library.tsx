"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Crest } from "@/components/brand/Crest";
import { buttonClasses } from "@/components/ui/Button";
import type { CardView, PictureView } from "@/lib/guides/view";
import { IconClock, IconNext, IconSearch, IconSteps } from "./icons";
import { parseSaved, savedRaw, subscribeProgress, type Saved } from "./progress";
import { Picture } from "./Shot";

export type ShelfView = { key: string; title: string; blurb: string; cards: CardView[] };

const SEP = "\u0001";

/** A phone with the guide's first picture on it, tilted a little, on a night panel: what a guide looks like before you open it. */
function Cover({ code, cover }: { code: string; cover: PictureView | null }) {
  return (
    <div className="gd-cover">
      <span className="gd-code">{code}</span>
      {cover ? (
        <div className="gd-phone" aria-hidden="true">
          <Picture picture={{ ...cover, alt: "" }} dim={false} tag={false} />
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center opacity-90" aria-hidden="true">
          <Crest size={74} tone="light" />
        </div>
      )}
    </div>
  );
}

function Card({ card, saved }: { card: CardView; saved: Saved | null }) {
  const seen = saved ? Math.min(card.steps, saved.seen.length) : 0;
  const pct = saved?.done ? 100 : card.steps ? Math.round((seen / card.steps) * 100) : 0;
  const started = pct > 0;
  return (
    <Link href={card.href ?? `/guides/${card.slug}`} className="gd-card press" aria-label={`${card.title}. ${card.steps} steps, about ${card.minutes} minutes.${saved?.done ? " You have finished it." : started ? ` You are ${pct} percent through.` : ""}`}>
      <Cover code={card.code} cover={card.cover} />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="t-heading">{card.title}</h3>
        <p className="t-small line-clamp-2 text-soft">{card.lede}</p>
        <div className="mt-auto flex flex-col gap-3 pt-1">
          {started ? (
            <div className="gd-meter" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="gd-chip">
              <IconSteps /> {card.steps} steps
            </span>
            <span className="gd-chip">
              <IconClock /> {card.minutes} min
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[0.92rem] font-semibold text-accent">
              {saved?.done ? "Read again" : started ? "Carry on" : "Open"}
              <IconNext />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function Library({ shelves, signedIn, greeting }: { shelves: ShelfView[]; signedIn: boolean; greeting: string | null }) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => shelves.flatMap((s) => s.cards), [shelves]);
  const raws = useSyncExternalStore(
    subscribeProgress,
    () => all.map((c) => savedRaw(c.slug)).join(SEP),
    () => "",
  );
  const savedBy = useMemo(() => {
    const parts = raws ? raws.split(SEP) : [];
    const map = new Map<string, Saved | null>();
    all.forEach((c, i) => map.set(c.slug, parseSaved(parts[i] ?? "")));
    return map;
  }, [all, raws]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = shelves
    .map((s) => ({ ...s, cards: s.cards.filter((c) => words.every((w) => c.search.includes(w))) }))
    .filter((s) => s.cards.length > 0);
  const found = shown.reduce((n, s) => n + s.cards.length, 0);

  // The guide read most recently and not finished
  const resume = all
    .map((c) => ({ c, s: savedBy.get(c.slug) ?? null }))
    .filter((x) => x.s && !x.s.done && x.s.at)
    .sort((a, b) => (b.s!.t ?? 0) - (a.s!.t ?? 0))[0];

  const pictures = all.reduce((n, c) => n + (c.cover ? 1 : 0), 0);
  void pictures;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="gd-lib-h" className="night rise-in rounded-[var(--radius-sheet)] p-7 sm:p-12">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <Crest size={30} tone="light" />
            <p className="text-[0.82rem] font-semibold uppercase tracking-[0.12em] text-white/70">How-to guides</p>
          </div>
          <div className="flex max-w-[40rem] flex-col gap-3">
            <h1 id="gd-lib-h" className="t-display">
              {greeting ? `${greeting}, show me how.` : "Show me how."}
            </h1>
            <p className="t-body text-white/80">
              Short guides with a picture for every step.{" "}
              {signedIn ? "These are the ones for you." : "Sign in to see the guides for your role."}
            </p>
          </div>
          <form role="search" className="relative max-w-[32rem]" onSubmit={(e) => e.preventDefault()}>
            <label htmlFor="gd-search" className="sr-only">
              Search the guides
            </label>
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/60">
              <IconSearch />
            </span>
            <input
              id="gd-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What do you want to do?"
              autoComplete="off"
              className="h-14 w-full rounded-[var(--radius-control)] border border-white/20 bg-white/10 pl-12 pr-4 text-[1.02rem] text-white placeholder:text-white/55 focus:border-white/60 focus:bg-white/15 focus:outline-none focus:ring-4 focus:ring-[color:var(--crest-gold)]/40"
            />
          </form>
          {!signedIn ? (
            <div>
              <Link href="/sign-in?next=/guides" className={buttonClasses({ className: "px-8" })}>
                <span className="relative">Sign in</span>
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      {resume && !words.length ? (
        <section aria-labelledby="gd-resume" className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 id="gd-resume" className="t-heading">
              Carry on where you stopped
            </h2>
            <p className="t-small text-soft">
              {resume.c.code} · {resume.c.title}
            </p>
          </div>
          <Link href={resume.c.href ?? `/guides/${resume.c.slug}#${resume.s!.at}`} className={buttonClasses({ className: "px-7" })}>
            <span className="relative">Carry on</span>
            <IconNext />
          </Link>
        </section>
      ) : null}

      {shelves.length > 1 && !words.length ? (
        <nav aria-label="Jump to a shelf" className="-mt-4 flex flex-wrap gap-2">
          {shelves.map((s) => (
            <a key={s.key} href={`#shelf-${s.key}`} className="gd-chip press" style={{ minHeight: "2.5rem" }}>
              {s.title} · {s.cards.length}
            </a>
          ))}
        </nav>
      ) : null}

      {shown.map((s) => (
        <section key={s.key} id={`shelf-${s.key}`} aria-labelledby={`shelf-${s.key}-h`} className="flex scroll-mt-24 flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 id={`shelf-${s.key}-h`} className="t-title" style={{ fontSize: "clamp(1.5rem, 4.6vw, 2.1rem)" }}>
              {s.title}
            </h2>
            <p className="t-body text-soft">{s.blurb}</p>
          </div>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {s.cards.map((c) => (
              <li key={c.slug}>
                <Card card={c} saved={savedBy.get(c.slug) ?? null} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {words.length > 0 && found === 0 ? (
        <section className="card flex flex-col items-start gap-3 p-6" role="status">
          <h2 className="t-heading">No guide matches “{query}”.</h2>
          <p className="t-body text-soft">Try one word, such as “tribe”, “code” or “card”.</p>
          <button type="button" className={buttonClasses({ variant: "quiet", size: "md" })} onClick={() => setQuery("")}>
            <span className="relative">Show every guide</span>
          </button>
        </section>
      ) : null}

      {words.length > 0 && found > 0 ? (
        <p className="t-small text-soft" role="status">
          {found} {found === 1 ? "guide matches" : "guides match"} “{query}”.
        </p>
      ) : null}
    </div>
  );
}
