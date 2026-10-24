"use client";

/**
 * United Tribes · Tribe Card Guide
 * Route: /tribe-card-guide
 *
 * Mobile-first, one-screen-at-a-time walkthrough (Part 1: fill in the card,
 * Part 2: first 21 days). Screenshots live in /public/tribe-card/*.webp.
 *
 * Design tokens are CSS variables declared on the root wrapper with Tailwind
 * arbitrary properties, so light/dark theming needs no tailwind.config changes.
 */

import Image from "next/image";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["wdth", "opsz"],
  display: "swap",
});
const body = Figtree({ subsets: ["latin"], display: "swap" });

/* ------------------------------------------------------------------ */
/* Design tokens (light + dark)                                        */
/* ------------------------------------------------------------------ */

const TOKENS = [
  "[--bg:#f5f4f1] [--card:#ffffff] [--ink:#1a1917] [--ink-2:#45423d] [--muted:#75716a]",
  "[--line:#e4e1da] [--panel:#eeece7] [--coral:#d96f45] [--coral-ink:#b5532b] [--coral-tint:#fbf1ec]",
  "[--gold:#edc55c] [--gold-tint:#fbf3dc] [--gold-ink:#7d5e0c] [--god:#2e2e2b] [--no:#1a1917]",
  "dark:[--bg:#151412] dark:[--card:#1f1e1b] dark:[--ink:#f3f1ec] dark:[--ink-2:#dcd8d0] dark:[--muted:#a9a59d]",
  "dark:[--line:#34322e] dark:[--panel:#2a2925] dark:[--coral:#e8845c] dark:[--coral-ink:#f0a07f] dark:[--coral-tint:#3a2419]",
  "dark:[--gold-tint:#3a3220] dark:[--gold-ink:#edc55c] dark:[--god:#d9d6cf] dark:[--no:#5a5650]",
].join(" ");

const DISPLAY_STRETCH = "[font-stretch:80%] [font-variation-settings:'wdth'_80]";

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.08em] text-[var(--coral-ink)]">
      {children}
    </p>
  );
}

function Heading({ children, level = 2 }: { children: ReactNode; level?: 1 | 2 }) {
  const Tag = level === 1 ? "h1" : "h2";
  return (
    <Tag
      tabIndex={-1}
      data-step-heading
      className={`${display.className} ${DISPLAY_STRETCH} mb-3.5 font-extrabold leading-[1.02] tracking-[-0.02em] outline-none ${
        level === 1 ? "text-[clamp(40px,11vw,56px)]" : "text-[clamp(32px,8.5vw,42px)]"
      }`}
    >
      {children}
    </Tag>
  );
}

function Lede({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mb-5 text-[19px] text-[var(--ink-2)] ${className}`}>{children}</p>;
}

function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`mb-3 text-sm font-bold uppercase tracking-[0.08em] text-[var(--muted)] ${className}`}>
      {children}
    </p>
  );
}

const Check = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const Cross = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" aria-hidden>
    <path d="M7 7l10 10M17 7L7 17" />
  </svg>
);

type DoVariant = "yes" | "no" | "god" | "others" | "life";

function DoItem({ children, variant = "yes" }: { children: ReactNode; variant?: DoVariant }) {
  const marker =
    variant === "yes" ? (
      <span className="absolute left-0 top-0 grid h-[26px] w-[26px] place-items-center rounded-full bg-[var(--coral)]">
        <Check />
      </span>
    ) : variant === "no" ? (
      <span className="absolute left-0 top-0 grid h-[26px] w-[26px] place-items-center rounded-full bg-[var(--no)]">
        <Cross />
      </span>
    ) : (
      <span
        className={`absolute left-1.5 top-[7px] h-3.5 w-3.5 rounded-full ${
          variant === "god" ? "bg-[var(--god)]" : variant === "others" ? "bg-[var(--coral)]" : "bg-[var(--gold)]"
        }`}
      />
    );
  return (
    <li className="relative min-h-7 pl-10 text-lg text-[var(--ink)]">
      {marker}
      {variant === "no" && <span className="sr-only">Don&apos;t: </span>}
      {children}
    </li>
  );
}

function DoList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ul className={`grid gap-3.5 ${className}`}>{children}</ul>;
}

function Quote({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap rounded-md bg-[var(--panel)] px-1.5 font-bold">{children}</span>;
}

type CalloutTone = "tip" | "why" | "example";
function Callout({ tone, label, children }: { tone: CalloutTone; label: string; children: ReactNode }) {
  const styles: Record<CalloutTone, { box: string; label: string }> = {
    tip: { box: "bg-[var(--gold-tint)] mt-[22px]", label: "text-[var(--gold-ink)]" },
    why: { box: "bg-[var(--coral-tint)] mt-[22px]", label: "text-[var(--coral-ink)]" },
    example: { box: "mt-[18px] border border-[var(--line)] bg-[var(--card)]", label: "text-[var(--muted)] mb-1" },
  };
  return (
    <aside className={`rounded-2xl px-4 py-3.5 text-[16.5px] text-[var(--ink)] ${styles[tone].box}`}>
      <strong className={`mb-0.5 block text-[13px] uppercase tracking-[0.08em] ${styles[tone].label}`}>{label}</strong>
      {children}
    </aside>
  );
}

/* ---------- Screenshot with highlight rings ---------- */

type Ring = { left: number; top: number; width: number; height: number; gold?: boolean };
type Tag = { left: number; top: number; label: string; gold?: boolean };

function Shot({
  src,
  width,
  height,
  alt,
  rings,
  tags = [],
  caption = "The orange box shows where to look",
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  rings: Ring[];
  tags?: Tag[];
  caption?: string;
}) {
  return (
    <figure className="-mx-4 mb-1 mt-[22px] border-y border-[var(--line)] bg-[#f5f4f1] px-3 py-3.5 min-[560px]:mx-0 min-[560px]:rounded-[20px] min-[560px]:border min-[560px]:p-[18px]">
      <div className="relative">
        <Image
          src={src}
          width={width}
          height={height}
          alt={alt}
          sizes="(min-width: 560px) 524px, 100vw"
          className="block h-auto w-full"
        />
        {rings.map((r, i) => (
          <i
            key={i}
            aria-hidden
            className={`pointer-events-none absolute rounded-xl border-[3px] ${
              r.gold
                ? "border-[#d4a62a] shadow-[0_0_0_4px_rgba(237,197,92,.35)]"
                : "border-[var(--coral)] animate-[ringPulse_2s_ease-out_infinite] motion-reduce:animate-none motion-reduce:shadow-[0_0_0_4px_rgba(217,111,69,.2)]"
            }`}
            style={{ left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` }}
          />
        ))}
        {tags.map((t, i) => (
          <span
            key={i}
            aria-hidden
            className={`pointer-events-none absolute -translate-x-full -translate-y-1/2 whitespace-nowrap rounded-full px-[9px] py-1.5 text-[11px] font-bold uppercase leading-none tracking-[0.07em] shadow-[0_2px_6px_rgba(0,0,0,.15)] ${
              t.gold ? "bg-[#edc55c] text-[#1a1917]" : "bg-[var(--coral)] text-white"
            }`}
            style={{ left: `${t.left}%`, top: `${t.top}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
      <figcaption className="mx-0.5 mt-2.5 flex items-center gap-2 text-sm text-[#75716a]">
        <i aria-hidden className="h-3.5 w-[26px] flex-none rounded-md border-[2.5px] border-[#d96f45]" />
        {caption}
      </figcaption>
    </figure>
  );
}

/* ---------- Draft → your lines diagram ---------- */

function FlowDiagram({ active }: { active: "draft" | "lines" }) {
  const box = (on: boolean, grey: boolean, title: string, sub: string) => (
    <div
      className={`rounded-[14px] border-2 px-3 py-2.5 text-sm leading-snug text-[#45423d] ${
        grey ? "bg-[#eeece7]" : "bg-white"
      } ${on ? "border-[var(--coral)] shadow-[0_0_0_3px_rgba(217,111,69,.2)]" : "border-[#e4e1da]"}`}
    >
      <span className="mb-[3px] block text-[11px] font-bold uppercase tracking-[0.07em] text-[#b5532b]">
        {on ? "You are here" : " "}
      </span>
      <b className="mb-0.5 block text-base text-[#1a1917]">{title}</b>
      {sub}
    </div>
  );
  return (
    <div aria-hidden className="mb-5 mt-0.5 grid grid-cols-[1fr_26px_1fr] items-stretch gap-1.5">
      {box(active === "draft", true, "The draft", "Grey box · read only")}
      <svg className="h-6 w-6 self-center text-[var(--muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
      {box(active === "lines", false, "Your lines", "White boxes · you type")}
    </div>
  );
}

/* ---------- Icon tile list (intro + finish) ---------- */

function IconList({ items }: { items: { icon: ReactNode; text: ReactNode }[] }) {
  return (
    <ul className="mb-5 grid gap-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-3.5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] px-4 py-3.5 text-[17px]">
          <span aria-hidden className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-[var(--coral-tint)] text-[var(--coral-ink)] [&>svg]:h-5 [&>svg]:w-5">
            {it.icon}
          </span>
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

const ico = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

function Season({ children }: { children: ReactNode }) {
  return <p className="mt-2 rounded-[18px] bg-[var(--ink)] px-[18px] py-4 text-[17px] font-semibold text-[var(--bg)]">{children}</p>;
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

type Part = "1" | "2";
type Kind = "intro" | "step" | "end";
type Screen = { name: string; part: Part; kind: Kind; content: (go: (id: string) => void) => ReactNode; id?: string };

const PART_NAME: Record<Part, string> = { "1": "Your card", "2": "First 21 days" };
const GROUP_NAME: Record<Part, string> = { "1": "Part 1 · Fill in your card", "2": "Part 2 · Your first 21 days" };

const SCREENS: Screen[] = [
  /* ---------------- PART 1 ---------------- */
  {
    name: "Start",
    part: "1",
    kind: "intro",
    content: (go) => (
      <>
        <Eyebrow>Tribe Card guide</Eyebrow>
        <Heading level={1}>Fill in your Tribe Card</Heading>
        <Lede>Your Tribe Card is what members see when they choose a tribe. This guide has two parts:</Lede>
        <ol className="-mt-2 mb-[22px] grid gap-2">
          {[
            ["Fill in your card", "10 short steps, with a picture for each"],
            ["Your first 21 days", "What to do after your card is approved"],
          ].map(([t, s], i) => (
            <li key={t} className="relative rounded-2xl border border-[var(--line)] bg-[var(--card)] py-3 pl-[54px] pr-3.5 text-base text-[var(--ink-2)]">
              <span className="absolute left-3.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-[var(--ink)] text-sm font-bold text-[var(--bg)]">
                {i + 1}
              </span>
              <b className="block text-[17px] text-[var(--ink)]">{t}</b>
              {s}
            </li>
          ))}
        </ol>
        <SectionLabel className="!mb-2.5">Have these ready</SectionLabel>
        <IconList
          items={[
            { icon: ico(<path d="M4 20h4L19 9l-4-4L4 16v4z" />), text: "Two sentences about you and your goal" },
            { icon: ico(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>), text: "A day and time you can keep every week" },
            { icon: ico(<><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>), text: "The part of Lagos you'll meet around" },
          ]}
        />
        <p className="flex items-center gap-2.5 text-base text-[var(--ink-2)]">
          <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none text-[var(--coral)]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Your work saves as you type, so you can stop and come back.
        </p>
        <button
          type="button"
          onClick={() => go("first-21-days")}
          className="mt-[22px] flex min-h-16 w-full items-center justify-between gap-3 rounded-[18px] bg-[var(--ink)] px-[18px] py-4 text-left text-[15px] text-[var(--bg)] outline-none transition active:scale-[.99] focus-visible:ring-[3px] focus-visible:ring-[rgba(217,111,69,.45)] focus-visible:ring-offset-2"
        >
          <span>
            <b className="block text-[17px]">Card already approved?</b>Go straight to Part 2: your first 21 days
          </span>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </>
    ),
  },
  {
    name: "Name your tribe",
    part: "1",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 1 · Your tribe</Eyebrow>
        <Heading>Name your tribe</Heading>
        <DoList>
          <DoItem>Keep the suggested name, or type your own.</DoItem>
          <DoItem>Make it warm and clear. It&apos;s the first thing members see.</DoItem>
        </DoList>
        <Shot src="/tribe-card/name.webp" width={950} height={250} alt="The Tribe name box with a suggested name filled in." rings={[{ left: 2.526, top: 28.8, width: 95.158, height: 46.4 }]} />
        <Callout tone="tip" label="Idea">Name it by life stage and community, for example &ldquo;Builders · Creative Economy&rdquo;.</Callout>
      </>
    ),
  },
  {
    name: "Who can join",
    part: "1",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 2 · Your tribe</Eyebrow>
        <Heading>Choose who can join</Heading>
        <DoList>
          <DoItem><b>Mixed:</b> women and men together.</DoItem>
          <DoItem><b>Women only</b> or <b>Men only:</b> only members who asked for that kind of tribe will be offered it.</DoItem>
        </DoList>
        <Shot src="/tribe-card/who-can-join.webp" width={950} height={240} alt="The Who it is for choice: Mixed, Women only or Men only." rings={[{ left: 2.737, top: 29.167, width: 94.737, height: 46.667 }]} />
      </>
    ),
  },
  {
    name: "Set your seats",
    part: "1",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 3 · Your tribe</Eyebrow>
        <Heading>Set your seats</Heading>
        <DoList>
          <DoItem><b>12 is the most.</b> That counts you and your assistant.</DoItem>
          <DoItem>The church plans for about 11 per tribe.</DoItem>
        </DoList>
        <Shot src="/tribe-card/seats.webp" width={950} height={210} alt="The Seats menu showing 12 members (the most)." rings={[{ left: 2.737, top: 30.476, width: 94.737, height: 54.286 }]} />
      </>
    ),
  },
  {
    name: "Pick your goal",
    part: "1",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 4 · What it is built on</Eyebrow>
        <Heading>Pick your goal</Heading>
        <DoList>
          <DoItem>Your life stage (the grey box at the top) is already set.</DoItem>
          <DoItem>Tap the goal you want to lead. It turns orange and says <Quote>Your goal</Quote>.</DoItem>
          <DoItem>&ldquo;People are waiting&rdquo; shows how many members want that goal.</DoItem>
        </DoList>
        <Shot src="/tribe-card/goal.webp" width={950} height={952} alt="Life-stage track and community in grey boxes, then goal cards. The chosen goal is outlined in orange and marked Your goal." rings={[{ left: 2.737, top: 77.941, width: 94.737, height: 21.324 }]} />
        <Callout tone="tip" label="Tip">Pick a goal you have lived through, or one you&apos;re working on now.</Callout>
      </>
    ),
  },
  {
    name: "Write your story",
    part: "1",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 5 · Your story with this goal</Eyebrow>
        <Heading>Write your story</Heading>
        <DoList>
          <DoItem>Type in the white box. Members read it when they choose a tribe.</DoItem>
          <DoItem>Say what you&apos;ve been through with this goal, why you want to help, and who should join.</DoItem>
          <DoItem>Use up to <b>300 characters</b>. The counter under the box keeps count.</DoItem>
          <DoItem variant="no">Don&apos;t promise results.</DoItem>
        </DoList>
        <Shot
          src="/tribe-card/story.webp"
          width={955}
          height={555}
          alt="The Your story with this goal box, labelled In a couple of sentences, with a counter showing 0 of 300 characters."
          rings={[{ left: 2.932, top: 29.91, width: 94.241, height: 58.739 }]}
          tags={[{ left: 94.869, top: 29.91, label: "Type here" }]}
        />
        <Callout tone="example" label="Example">
          &ldquo;My business once stopped whenever I stopped. I learned to track one number and hand work over, and I&apos;d love to walk that road with owners who feel stuck.&rdquo;
        </Callout>
      </>
    ),
  },
  {
    name: "Day and time",
    part: "1",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 6 · When and where</Eyebrow>
        <Heading>Choose a day and time</Heading>
        <DoList>
          <DoItem>Tap a day, then choose a start time.</DoItem>
          <DoItem>Pick a time you can keep <b>every week</b>. Each meeting is 75 minutes.</DoItem>
          <DoItem variant="no">Avoid Sunday service times and Thribe-X at 1pm.</DoItem>
        </DoList>
        <Shot
          src="/tribe-card/day-time.webp"
          width={950}
          height={620}
          alt="Day buttons from Monday to Sunday, and a Start time menu."
          rings={[
            { left: 2.526, top: 10, width: 86.526, height: 32.258 },
            { left: 2.737, top: 57.258, width: 94.737, height: 18.71 },
          ]}
        />
        <Callout tone="why" label="Why it matters">Members can only join if they can make your time.</Callout>
      </>
    ),
  },
  {
    name: "How and where",
    part: "1",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 7 · When and where</Eyebrow>
        <Heading>Choose how and where</Heading>
        <DoList>
          <DoItem>Choose <b>Online</b> or <b>In person</b>.</DoItem>
          <DoItem>Choose your <b>zone</b>, the part of Lagos your tribe meets around. Once a month the tribe shares a meal there.</DoItem>
          <DoItem variant="no">&ldquo;Area&rdquo; is optional. Never put your home address.</DoItem>
        </DoList>
        <Shot
          src="/tribe-card/how-where.webp"
          width={950}
          height={600}
          alt="The Format choice of Online or In person, a Zone menu, and an optional Area box."
          rings={[
            { left: 2.737, top: 10.833, width: 94.737, height: 19 },
            { left: 2.737, top: 45.333, width: 94.737, height: 19.5 },
          ]}
        />
      </>
    ),
  },
  {
    name: "Read the draft",
    part: "1",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 8 · Success Picture</Eyebrow>
        <Heading>Read the draft</Heading>
        <FlowDiagram active="draft" />
        <DoList>
          <DoItem>The <b>grey box</b> is a draft the pastors wrote for your goal.</DoItem>
          <DoItem>You <b>can&apos;t type</b> in it. Read it for ideas.</DoItem>
          <DoItem>Read <b>&ldquo;Keep in mind&rdquo;</b> closely. It&apos;s a line leaders must not cross.</DoItem>
        </DoList>
        <Shot
          src="/tribe-card/draft.webp"
          width={950}
          height={1438}
          alt="The grey ready-made draft for this goal: who it is for, three draft lines, the week 12 outcome, ideas for the weeks, and a Keep in mind note."
          caption="The orange box is the draft"
          rings={[
            { left: 2.526, top: 1.252, width: 95.158, height: 98.47 },
            { left: 4.842, top: 84.562, width: 90.316, height: 8.762, gold: true },
          ]}
          tags={[
            { left: 95.579, top: 1.252, label: "Draft · read only" },
            { left: 93.053, top: 84.562, label: "Must read", gold: true },
          ]}
        />
        <Callout tone="tip" label="Next">You&apos;ll type your own lines in the white boxes under the draft.</Callout>
      </>
    ),
  },
  {
    name: "Type your three lines",
    part: "1",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 9 · Success Picture</Eyebrow>
        <Heading>Type your three lines</Heading>
        <FlowDiagram active="lines" />
        <DoList>
          <DoItem>Scroll down past the draft to the <b>three white boxes</b>. This is where you type.</DoItem>
          <DoItem>
            They may already hold the draft&apos;s words. You can:
            <span className="mt-2.5 flex flex-wrap gap-2">
              {["Keep them", "Change some words", "Write your own"].map((c) => (
                <span key={c} className="rounded-full border-[1.5px] border-[var(--line)] bg-[var(--card)] px-3 py-1.5 text-[15px] font-semibold">
                  {c}
                </span>
              ))}
            </span>
          </DoItem>
        </DoList>
        <Shot
          src="/tribe-card/your-lines.webp"
          width={950}
          height={1290}
          alt="Three white boxes to type in: Loving God, Loving Others and Loving Life."
          caption="The orange boxes are where you type"
          rings={[6.124, 37.752, 69.302].map((top) => ({ left: 2.737, top, width: 94.737, height: 20 }))}
          tags={[6.124, 37.752, 69.302].map((top) => ({ left: 95.368, top, label: "Type here" }))}
        />
        <SectionLabel className="mt-[18px]">How each line should start</SectionLabel>
        <DoList>
          <DoItem variant="god"><b>Loving God:</b> <Quote>We…</Quote></DoItem>
          <DoItem variant="others"><b>Loving Others:</b> <Quote>We…</Quote></DoItem>
          <DoItem variant="life"><b>Loving Life:</b> <Quote>By week 12…</Quote></DoItem>
          <DoItem variant="no">No promises about money or health.</DoItem>
        </DoList>
        <Callout tone="tip" label="Good to know">In week 1 your tribe will polish these lines together, so they don&apos;t need to be perfect.</Callout>
      </>
    ),
  },
  {
    name: "Send it",
    part: "1",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 10 · Send</Eyebrow>
        <Heading>Send your card</Heading>
        <DoList>
          <DoItem>&ldquo;Still to do&rdquo; shows what&apos;s left. Finish each item.</DoItem>
          <DoItem>When the list is empty, the button turns bright.</DoItem>
          <DoItem>Read your card once more, then tap <b>Send my Tribe Card</b>.</DoItem>
        </DoList>
        <Shot
          src="/tribe-card/send.webp"
          width={950}
          height={520}
          alt="The Send to the pastorate panel with a Still to do list and the Send my Tribe Card button."
          rings={[
            { left: 2.105, top: 21.154, width: 56.632, height: 44.231 },
            { left: 2.526, top: 70, width: 49.474, height: 23.077 },
          ]}
        />
      </>
    ),
  },
  {
    name: "After you send",
    part: "1",
    kind: "end",
    content: () => (
      <>
        <Eyebrow>Card sent</Eyebrow>
        <Heading>What happens next</Heading>
        <ol className="mt-1.5">
          {[
            ["A pastor or director reviews it", "Your card shows “Draft” until it is approved."],
            ["Changes asked for?", "Fix them and send it again."],
            ["Approved and certified", "Members can see your tribe once your card is approved and you are certified as a leader."],
          ].map(([t, s], i, arr) => (
            <li key={t} className="relative pb-[22px] pl-[52px] text-[17.5px]">
              <span className="absolute -top-0.5 left-0 grid h-9 w-9 place-items-center rounded-full bg-[var(--ink)] text-base font-bold text-[var(--bg)]">{i + 1}</span>
              {i < arr.length - 1 && <span aria-hidden className="absolute bottom-0.5 left-[17px] top-[38px] w-0.5 bg-[var(--line)]" />}
              <b className="block text-lg">{t}</b>
              {s}
            </li>
          ))}
        </ol>
        <Season>You write a new card every season.</Season>
        <p className="mt-[18px] text-[17px] text-[var(--ink-2)]">
          When members are placed in your tribe, your first 21 days begin. Tap <b>Next</b> to see what to do.
        </p>
      </>
    ),
  },

  /* ---------------- PART 2 ---------------- */
  {
    id: "first-21-days",
    name: "Your first 21 days",
    part: "2",
    kind: "intro",
    content: () => (
      <>
        <Eyebrow>Part 2 · After approval</Eyebrow>
        <Heading>Your first 21 days</Heading>
        <Lede>The first three weeks decide whether people stay. Here is what happens, and what you do.</Lede>
        <SectionLabel className="!mb-2.5">At a glance</SectionLabel>
        <ol className="grid gap-2">
          {(
            [
              ["Day 0", "Members are sent your tribe name, your photo and the first meeting time.", "Automatic", false],
              ["Days 1–3", "You call or voice-note each member.", "You", true],
              ["Day 3", "Everyone joins the tribe’s WhatsApp group.", "Your assistant", false],
              ["Week 1", "Your first meeting.", "You", true],
              ["Week 2", "Prayer triads start.", "Members", false],
              ["Week 3", "The first Tribe Table meal.", "Your assistant", false],
              ["Day 21", "The belonging check.", "Your coach", false],
            ] as const
          ).map(([when, what, who, you]) => (
            <li key={when} className="grid grid-cols-[76px_1fr] items-start gap-x-3 gap-y-1.5 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-3.5 py-3">
              <span className="row-span-2 pt-px text-[15px] font-extrabold text-[var(--coral-ink)]">{when}</span>
              <span className="text-base leading-snug">{what}</span>
              <span
                className={`justify-self-start rounded-full px-[9px] py-[3px] text-xs font-bold tracking-[0.03em] ${
                  you ? "bg-[var(--coral)] text-white" : "bg-[var(--panel)] text-[var(--ink-2)]"
                }`}
              >
                {who}
              </span>
            </li>
          ))}
        </ol>
      </>
    ),
  },
  {
    name: "Welcome everyone",
    part: "2",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 1 · Days 1–3</Eyebrow>
        <Heading>Welcome everyone</Heading>
        <DoList>
          <DoItem>Members have already been sent your tribe name, your photo and the first meeting time.</DoItem>
          <DoItem>Within <b>72 hours</b>, call each one or send a voice note. Five minutes is enough.</DoItem>
          <DoItem>By day 3, your assistant adds everyone to the tribe&apos;s WhatsApp group and starts a welcome round.</DoItem>
        </DoList>
        <Callout tone="example" label="Example voice note">
          &ldquo;Hello, I&apos;m [your name], your tribe leader. I&apos;m so glad you&apos;re joining us. We meet on [day] at [time]. See you there!&rdquo;
        </Callout>
        <Callout tone="why" label="Why it matters">Hearing a friendly voice first makes it much easier to turn up.</Callout>
      </>
    ),
  },
  {
    name: "Your first meeting",
    part: "2",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 2 · Week 1</Eyebrow>
        <Heading>Run your first meeting</Heading>
        <DoList>
          <DoItem>Follow the 75-minute plan in the next step.</DoItem>
          <DoItem>Story time: everyone shares <b>&ldquo;three chapters of my life&rdquo;</b>.</DoItem>
          <DoItem>Polish your three Success Picture lines together, then sign them as your <b>Tribe Covenant</b>.</DoItem>
        </DoList>
        <Callout tone="tip" label="Good to know">Stories go deeper week by week. By week 6 the prompt is &ldquo;a season that shaped my faith&rdquo;.</Callout>
      </>
    ),
  },
  {
    name: "The 75-minute meeting",
    part: "2",
    kind: "step",
    content: () => {
      const agenda = [
        { sw: "bg-[#b9b4aa]", flex: 5, t: "Arrive", min: 5, p: "Everyone checks in with one word. Cameras on." },
        { sw: "bg-[var(--god)]", flex: 25, t: "Loving God", min: 25, p: "One passage linked to Sunday’s message or the Bible Study Manual, three questions, and your confession said together." },
        { sw: "bg-[var(--coral)]", flex: 25, t: "Loving Others", min: 25, p: "Split into triads to share honestly and pray for each other." },
        { sw: "bg-[var(--gold)]", flex: 15, t: "Loving Life", min: 15, p: "One practical step for the week, plus a 5-minute skill share from a member." },
        { sw: "bg-[#b9b4aa]", flex: 5, t: "Send", min: 5, p: "Pray, repeat the week’s step, and confirm the next meeting." },
      ];
      return (
        <>
          <Eyebrow>Step 3 · Every meeting</Eyebrow>
          <Heading>The 75-minute meeting</Heading>
          <div aria-hidden className="mb-3.5 mt-0.5 flex h-5 gap-[3px]">
            {agenda.map((a) => (
              <span key={a.t} className={`rounded-md ${a.sw}`} style={{ flex: a.flex }} />
            ))}
          </div>
          <ol className="grid gap-2">
            {agenda.map((a) => (
              <li key={a.t} className="grid grid-cols-[14px_1fr_auto] items-center gap-x-3 gap-y-1 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-3.5 py-3">
                <span aria-hidden className={`h-3.5 w-3.5 rounded ${a.sw}`} />
                <b className="text-[17px]">{a.t}</b>
                <span className="whitespace-nowrap text-sm font-bold text-[var(--muted)]">{a.min} min</span>
                <p className="col-span-2 col-start-2 text-base leading-[1.45] text-[var(--ink-2)]">{a.p}</p>
              </li>
            ))}
          </ol>
          <Callout tone="tip" label="Remember">You are a host, not a teacher. The weekly meeting guide gives you the content.</Callout>
        </>
      );
    },
  },
  {
    name: "Prayer triads",
    part: "2",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 4 · Week 2</Eyebrow>
        <Heading>Start prayer triads</Heading>
        <DoList>
          <DoItem>Split the tribe into small groups of <b>3 or 4</b>. These are your triads.</DoItem>
          <DoItem>Each triad has a short check-in call once in the middle of the week.</DoItem>
          <DoItem>In every meeting, triads break out together for Loving Others.</DoItem>
        </DoList>
        <Callout tone="why" label="Why it matters">In a big group a few voices take over. Triads make sure quiet members are heard too.</Callout>
        <Callout tone="tip" label="Good to know">After two meetings, anyone can ask to move to another tribe, with no reason needed. It&apos;s built in, so don&apos;t take it personally.</Callout>
      </>
    ),
  },
  {
    name: "First Tribe Table",
    part: "2",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 5 · Week 3</Eyebrow>
        <Heading>Your first Tribe Table</Heading>
        <DoList>
          <DoItem>Your assistant hosts the first in-person meal, in your zone.</DoItem>
          <DoItem>It can be in someone&apos;s home or a church space.</DoItem>
          <DoItem>After that, the Tribe Table happens <b>once a month</b>.</DoItem>
        </DoList>
        <Callout tone="why" label="Why it matters">This is where faces on a screen start to become friends.</Callout>
      </>
    ),
  },
  {
    name: "Keep track of everyone",
    part: "2",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 6 · Every week</Eyebrow>
        <Heading>Keep track of everyone</Heading>
        <DoList>
          <DoItem>After each meeting, <b>log attendance</b>: tap the names in the portal or the WhatsApp form. It takes about 30 seconds.</DoItem>
        </DoList>
        <SectionLabel className="mt-[18px]">If someone misses a meeting</SectionLabel>
        <ol className="grid gap-2">
          {[
            { lv: "Miss 1", t: "Send a warm message within 24 hours.", row: "border border-[var(--line)] bg-[var(--card)]", badge: "bg-[var(--panel)]" },
            { lv: "Miss 2", t: "Give them a phone call.", row: "bg-[var(--gold-tint)]", badge: "bg-[var(--gold)] text-[#1a1917]" },
            { lv: "Miss 3", t: "Tell your coach, and decide together how to reach out.", row: "bg-[var(--coral-tint)]", badge: "bg-[var(--coral)] text-white" },
          ].map((l) => (
            <li key={l.lv} className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 text-[16.5px] leading-[1.4] ${l.row}`}>
              <span className={`min-w-[72px] flex-none rounded-[10px] px-2 py-[7px] text-center text-[13px] font-extrabold uppercase tracking-[0.04em] ${l.badge}`}>{l.lv}</span>
              <span>{l.t}</span>
            </li>
          ))}
        </ol>
        <Callout tone="tip" label="Don't skip the log">Your coach uses it to spot a tribe that needs help.</Callout>
      </>
    ),
  },
  {
    name: "The belonging check",
    part: "2",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 7 · Day 21</Eyebrow>
        <Heading>The belonging check</Heading>
        <DoList>
          <DoItem>Members answer three quick questions, each scored from 1 to 5:</DoItem>
        </DoList>
        <ol className="mt-3.5 grid gap-2">
          {["I belong here.", "I would call someone here in a crisis.", "I am growing in faith."].map((q) => (
            <li key={q} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-3.5 py-3">
              <span className="block text-[17px] font-bold">{q}</span>
              <span aria-hidden className="mt-2 flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className="grid h-[30px] w-[30px] place-items-center rounded-full border-[1.5px] border-[var(--line)] text-[13px] font-bold text-[var(--muted)]">{n}</span>
                ))}
              </span>
            </li>
          ))}
        </ol>
        <DoList className="mt-[18px]">
          <DoItem>Your coach reviews the answers. You see your tribe&apos;s average, not each person&apos;s answers.</DoItem>
          <DoItem>The same check comes again in weeks 6 and 12.</DoItem>
        </DoList>
        <Callout tone="why" label="Why it matters">It catches a tribe that is struggling by week 3, not week 12.</Callout>
      </>
    ),
  },
  {
    name: "When someone shares something serious",
    part: "2",
    kind: "step",
    content: () => (
      <>
        <Eyebrow>Step 8 · Any time</Eyebrow>
        <Heading>When someone shares something serious</Heading>
        <Lede className="!mb-4 !text-[17.5px]">A tribe that knows each other well will hear hard things. Here is who handles what.</Lede>
        <ol className="grid gap-2">
          {[
            { t: "Practical need", eg: "A meal, a lift, a job lead", act: "The tribe helps. Your assistant leads." },
            { t: "Pastoral need", eg: "Grief, marriage strain, faith questions", act: "Listen, then involve your coach." },
            { t: "Specialist need", eg: "Counselling, medical, legal or money trouble", act: "Your coach refers them to the pastoral team." },
            { t: "Urgent risk", eg: "Abuse, or threats of harm to self or others", act: "Contact the care lead the same day.", urgent: true },
          ].map((c, i) => (
            <li
              key={c.t}
              className={`rounded-2xl px-3.5 py-3 ${c.urgent ? "border-2 border-[var(--coral)] bg-[var(--coral-tint)]" : "border border-[var(--line)] bg-[var(--card)]"}`}
            >
              <p className="mb-0.5 flex items-center gap-2.5 text-[17px] font-extrabold">
                <i className={`grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-[13px] not-italic ${c.urgent ? "bg-[var(--coral)] text-white" : "bg-[var(--panel)]"}`}>{i + 1}</i>
                {c.t}
              </p>
              <p className="mb-1.5 ml-9 text-[15px] text-[var(--muted)]">{c.eg}</p>
              <p className="ml-9 text-[16.5px] font-semibold">{c.act}</p>
            </li>
          ))}
        </ol>
        <Callout tone="why" label="Never">Never keep urgent risk secret, and never handle it alone.</Callout>
      </>
    ),
  },
  {
    name: "You're not alone",
    part: "2",
    kind: "end",
    content: () => (
      <>
        <Eyebrow>All done</Eyebrow>
        <Heading>You&apos;re not alone</Heading>
        <Lede className="!text-[17.5px]">Here is the support you get as a leader.</Lede>
        <IconList
          items={[
            { icon: ico(<><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M15 14.2c3 .1 6 1.9 6 4.8" /></>), text: "A 60-minute huddle every month with your coach and the other leaders in your cluster" },
            { icon: ico(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />), text: "A one-to-one with your coach every six weeks" },
            { icon: ico(<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" />), text: "Harvest Night at the end of each season: testimonies, awards, and the re-up, when members confirm they’re staying" },
            { icon: ico(<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />), text: "A rest season after every three seasons you lead, while your assistant steps up" },
          ]}
        />
        <Season>Thank you for leading a tribe.</Season>
      </>
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Derived navigation metadata                                         */
/* ------------------------------------------------------------------ */

type Meta = { n?: number };
type Range = { first: number; last: number; count: number };

function buildMeta(screens: Screen[]) {
  const meta: Meta[] = [];
  const range = {} as Record<Part, Range>;
  screens.forEach((s, k) => {
    const r = (range[s.part] ??= { first: k, last: k, count: 0 });
    r.last = k;
    if (s.kind === "step") meta[k] = { n: ++r.count };
    else meta[k] = {};
  });
  return { meta, range };
}

const LAST = SCREENS.length - 1;
const { meta: META, range: RANGE } = buildMeta(SCREENS);
const PART2_START = RANGE["2"].first;

function isLastStepOfPart(k: number) {
  const s = SCREENS[k];
  if (s.kind !== "step") return false;
  for (let j = k + 1; j <= RANGE[s.part].last; j++) if (SCREENS[j].kind === "step") return false;
  return true;
}

function indexFromHash(hash: string) {
  if (hash === "#first-21-days") return PART2_START;
  const m = /^#step-(\d+)$/.exec(hash);
  const n = m ? parseInt(m[1], 10) : 0;
  return n >= 0 && n <= LAST ? n : 0;
}

function hashFor(i: number) {
  return i === 0 ? "" : i === PART2_START ? "#first-21-days" : `#step-${i}`;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function TribeCardGuidePage() {
  const [cur, setCur] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const allBtnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const shouldFocus = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const screen = SCREENS[cur];
  const range = RANGE[screen.part];

  const show = useCallback((i: number, focus = true) => {
    shouldFocus.current = focus;
    setCur(Math.max(0, Math.min(LAST, i)));
  }, []);

  const goToId = useCallback(
    (id: string) => {
      const k = SCREENS.findIndex((s) => s.id === id);
      if (k >= 0) show(k);
    },
    [show]
  );

  // Initial screen from URL hash (client-only, avoids hydration mismatch)
  useEffect(() => {
    const sync = () => {
      const n = indexFromHash(window.location.hash);
      setCur((c) => (c === n ? c : n));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Side effects on screen change: URL, scroll, focus
  useEffect(() => {
    try {
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", pathname + search + hashFor(cur));
    } catch {
      /* ignore */
    }
    window.scrollTo(0, 0);
    if (shouldFocus.current) {
      mainRef.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus({ preventScroll: true });
      shouldFocus.current = false;
    }
  }, [cur]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetOpen) {
        if (e.key === "Escape") setSheetOpen(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if (e.key === "ArrowRight") show(cur + 1);
      if (e.key === "ArrowLeft") show(cur - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cur, sheetOpen, show]);

  // Sheet: lock scroll, focus current item, restore focus on close
  const wasOpen = useRef(false);
  useEffect(() => {
    if (sheetOpen) {
      document.body.style.overflow = "hidden";
      const btn = listRef.current?.querySelector<HTMLButtonElement>("[aria-current]");
      btn?.focus({ preventScroll: true });
      btn?.scrollIntoView({ block: "center" });
    } else {
      document.body.style.overflow = "";
      if (wasOpen.current) allBtnRef.current?.focus();
    }
    wasOpen.current = sheetOpen;
    return () => {
      document.body.style.overflow = "";
    };
  }, [sheetOpen]);

  // Swipe (single finger; ignore while pinch-zoomed)
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || e.changedTouches.length !== 1) return;
    if (window.visualViewport && window.visualViewport.scale > 1.05) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) show(dx < 0 ? cur + 1 : cur - 1);
  };

  // Header + button labels
  const counterText = useMemo(() => {
    if (screen.kind === "step") return `${PART_NAME[screen.part]} · Step ${META[cur].n} of ${range.count}`;
    if (screen.kind === "intro") return screen.part === "1" ? "Start" : `Part 2 · ${PART_NAME["2"]}`;
    return screen.part === "1" ? "Card sent" : "Done";
  }, [cur, screen, range.count]);

  const nextLabel =
    screen.kind === "intro"
      ? "Start"
      : cur === LAST
        ? "Start again"
        : screen.kind === "end"
          ? "Next: first 21 days"
          : isLastStepOfPart(cur)
            ? "Finish"
            : "Next";

  const progress = range.last === range.first ? 100 : ((cur - range.first) / (range.last - range.first)) * 100;

  const focusRing =
    "outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(217,111,69,.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

  return (
    <div
      className={`${TOKENS} ${body.className} min-h-dvh bg-[var(--bg)] text-lg leading-normal text-[var(--ink)] antialiased [-webkit-text-size-adjust:100%]`}
    >
      {/* Keyframes Tailwind can't express inline */}
      <style>{`
        @keyframes ringPulse{0%{box-shadow:0 0 0 0 rgba(217,111,69,.45)}70%{box-shadow:0 0 0 10px rgba(217,111,69,0)}100%{box-shadow:0 0 0 0 rgba(217,111,69,0)}}
        @keyframes stepIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      `}</style>

      {/* ---------- Top bar ---------- */}
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg)] px-4 pb-3 pt-[calc(10px+env(safe-area-inset-top))]">
        <div className="mx-auto max-w-[560px]">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">United Tribes · Leader guide</span>
            <button
              ref={allBtnRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
              className={`min-h-10 cursor-pointer rounded-full border border-[var(--line)] bg-[var(--card)] px-3.5 py-2 text-sm font-semibold ${focusRing}`}
            >
              All steps
            </button>
          </div>
          <p aria-live="polite" className="mb-2 text-[15px] font-bold">
            {counterText}
          </p>
          <div
            role="progressbar"
            aria-label={`${GROUP_NAME[screen.part]} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            className="h-1.5 overflow-hidden rounded-full bg-[var(--panel)]"
          >
            <span className="block h-full rounded-full bg-[var(--coral)] transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </header>

      {/* ---------- Current screen ---------- */}
      <main
        ref={mainRef}
        id="main"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="mx-auto max-w-[560px] px-4 pb-[calc(84px+32px+env(safe-area-inset-bottom))] pt-5"
      >
        <section
          key={cur}
          aria-label={screen.name}
          className="animate-[stepIn_.25s_ease] pb-7 pt-2 motion-reduce:animate-none"
        >
          {screen.content(goToId)}
        </section>
      </main>

      {/* ---------- Bottom nav ---------- */}
      <nav aria-label="Step navigation" className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[var(--bg)] px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-[560px] gap-2.5">
          {cur > 0 && (
            <button
              type="button"
              onClick={() => show(cur - 1)}
              className={`inline-flex min-h-14 min-w-24 flex-none cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-5 text-lg font-bold text-[var(--ink)] [-webkit-tap-highlight-color:transparent] active:scale-[.98] ${focusRing}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 5l-7 7 7 7" />
              </svg>
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => show(cur === LAST ? 0 : cur + 1)}
            className={`inline-flex min-h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[var(--coral)] px-5 text-lg font-bold text-white [-webkit-tap-highlight-color:transparent] active:scale-[.98] ${focusRing}`}
          >
            <span>{nextLabel}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <p className="mt-2.5 text-center text-[13px] text-[var(--muted)] [@media(hover:hover)]:hidden">
          Tip: swipe left or right to move between steps
        </p>
      </nav>

      {/* ---------- All-steps sheet ---------- */}
      {sheetOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="sheetTitle" className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-[rgba(21,20,18,.5)]" onClick={() => setSheetOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-auto rounded-t-3xl bg-[var(--card)] px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-5 min-[600px]:inset-x-auto min-[600px]:bottom-auto min-[600px]:left-1/2 min-[600px]:top-1/2 min-[600px]:w-[420px] min-[600px]:-translate-x-1/2 min-[600px]:-translate-y-1/2 min-[600px]:rounded-3xl">
            <div className="sticky -top-5 z-[1] -mx-4 -mt-5 mb-3 flex items-center justify-between border-b border-[var(--line)] bg-[var(--card)] px-4 pb-3 pt-5">
              <h3 id="sheetTitle" className="text-xl font-bold">All steps</h3>
              <button type="button" onClick={() => setSheetOpen(false)} className={`min-h-10 cursor-pointer rounded-full bg-[var(--panel)] px-3.5 font-bold ${focusRing}`}>
                Close
              </button>
            </div>
            <ol ref={listRef} className="grid gap-1.5">
              {SCREENS.map((s, k) => {
                const firstOfPart = k === RANGE[s.part].first;
                const current = k === cur;
                return (
                  <li key={k} className="contents">
                    {firstOfPart && (
                      <span className={`block px-1 pb-1 text-[13px] font-bold uppercase tracking-[0.08em] text-[var(--muted)] ${k === 0 ? "" : "pt-3.5"}`}>
                        {GROUP_NAME[s.part]}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-current={current ? "step" : undefined}
                      onClick={() => {
                        setSheetOpen(false);
                        show(k);
                      }}
                      className={`flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-[14px] border p-3 text-left text-[17px] font-semibold ${focusRing} ${
                        current ? "border-[var(--coral)] bg-[var(--coral-tint)]" : "border-transparent bg-[var(--bg)]"
                      }`}
                    >
                      <span
                        className={`grid h-[30px] w-[30px] flex-none place-items-center rounded-full text-sm ${
                          current ? "bg-[var(--coral)] text-white" : "bg-[var(--panel)]"
                        }`}
                      >
                        {s.kind === "intro" ? "•" : s.kind === "end" ? "✓" : META[k].n}
                      </span>
                      {s.name}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
