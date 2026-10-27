"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Crest } from "@/components/brand/Crest";
import { buttonClasses } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { GuideView, StepView } from "@/lib/guides/view";
import { IconBack, IconBulb, IconCheck, IconClock, IconClose, IconList, IconNext, IconPrint, IconQuote, IconShare, IconSteps, IconWarn, IconWhy } from "./icons";
import { Pieces } from "./Pieces";
import { parseSaved, savedRaw, subscribeProgress, writeSaved, forgetSaved } from "./progress";
import { Picture, Shot } from "./Shot";
import type { Piece } from "@/lib/guides/markup";

/* ------------------------------------------------------------------ where the reader is: the address bar is the one source */
const HASH_EVENT = "gd-hash";
function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  window.addEventListener(HASH_EVENT, cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener(HASH_EVENT, cb);
  };
}
/** "<hash>|<way>": the way is which direction the last move went, so the next screen slides in from the right side. */
const hashSnapshot = () => `${window.location.hash.replace(/^#/, "")}|${(window.history.state as { way?: string } | null)?.way ?? "fwd"}`;
const hashServer = () => "|fwd";

export function GuideReader({ guide }: { guide: GuideView }) {
  const steps = guide.steps;
  const total = steps.length;
  const toast = useToast();

  const snap = useSyncExternalStore(subscribeHash, hashSnapshot, hashServer);
  const [hash, way] = snap.split("|");
  const at = hash === "done" ? total + 1 : Math.max(0, steps.findIndex((s) => s.id === hash) + 1);
  const saved = parseSaved(useSyncExternalStore(subscribeProgress, () => savedRaw(guide.slug), () => ""));

  const [sheetOpen, setSheetOpen] = useState(false);
  const [zoom, setZoom] = useState<StepView | null>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const lightbox = useRef<HTMLDialogElement>(null);
  const first = useRef(true);
  const heading = useRef<HTMLHeadingElement | null>(null);

  const idAt = useCallback((i: number) => (i <= 0 ? "" : i > total ? "done" : steps[i - 1].id), [steps, total]);

  const go = useCallback(
    (to: number, how?: "fwd" | "back") => {
      const next = Math.max(0, Math.min(total + 1, to));
      const dir = how ?? (next < at ? "back" : "fwd");
      const id = idAt(next);
      window.history.replaceState({ way: dir }, "", id ? `#${id}` : `${window.location.pathname}${window.location.search}`);
      window.dispatchEvent(new Event(HASH_EVENT));
      // Remember it, on this device only
      const before = parseSaved(savedRaw(guide.slug));
      const seen = new Set(before?.seen ?? []);
      if (next >= 1 && next <= total) seen.add(steps[next - 1].id);
      if (next === total + 1) steps.forEach((s) => seen.add(s.id));
      writeSaved(guide.slug, { at: id || before?.at || "", seen: [...seen], done: before?.done === true || next === total + 1, t: Date.now() });
    },
    [at, guide.slug, idAt, steps, total],
  );

  // The sheets are native dialogs, which trap focus and close on Escape by themselves
  useEffect(() => {
    const d = sheet.current;
    if (!d) return;
    if (sheetOpen && !d.open) d.showModal();
    else if (!sheetOpen && d.open) d.close();
  }, [sheetOpen]);
  useEffect(() => {
    const d = lightbox.current;
    if (!d) return;
    if (zoom && !d.open) d.showModal();
    else if (!zoom && d.open) d.close();
  }, [zoom]);

  // A new screen: back to the top, and the heading is what a screen reader lands on
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    heading.current?.focus({ preventScroll: true });
  }, [at]);

  // Arrow keys on a computer; a swipe on a phone
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (sheet.current?.open || lightbox.current?.open) return;
      if (e.key === "ArrowRight") go(at + 1, "fwd");
      else if (e.key === "ArrowLeft") go(at - 1, "back");
      else if (e.key === "Home") go(0, "back");
      else if (e.key === "End") go(total + 1, "fwd");
      else return;
      e.preventDefault();
    };
    let sx = 0;
    let sy = 0;
    let ok = false;
    const down = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null;
      ok = !t?.closest("dialog, input, textarea, select, .gd-bottom, .gd-top") && e.touches.length === 1;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    };
    const up = (e: TouchEvent) => {
      if (!ok) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 45) go(dx < 0 ? at + 1 : at - 1, dx < 0 ? "fwd" : "back");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchend", up);
    };
  }, [at, go, total]);

  const seen = useMemo(() => new Set(saved?.seen ?? []), [saved?.seen]);
  const step = at >= 1 && at <= total ? steps[at - 1] : null;
  const nextStep = at + 1 <= total ? steps[at] : null;

  async function share() {
    const url = `${window.location.origin}/guides/${guide.slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: guide.title, text: `${guide.title}: a short how-to guide with pictures.`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.show("The link is copied. Paste it in WhatsApp or a message.", "success");
    } catch {
      toast.show(`Copy this link: ${url}`, "info");
    }
  }

  const bar = (
    <div className="gd-segs mx-auto max-w-6xl" role="progressbar" aria-label="Your place in this guide" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(Math.max(at, 0), total)}>
      {steps.map((s, i) => (
        <span key={s.id} className="gd-seg" data-state={i + 1 < at ? "done" : i + 1 === at ? "now" : "todo"} data-gap={i > 0 && steps[i - 1].part !== s.part ? "true" : undefined} />
      ))}
    </div>
  );

  const stepList = (onPick: (i: number) => void) => (
    <nav aria-label="All steps" className="flex flex-col gap-5">
      {guide.parts.map((part, pi) => (
        <div key={part.title} className="flex flex-col gap-1">
          <p className="gd-eyebrow px-2.5 pb-1">
            Part {pi + 1} · {part.title}
          </p>
          {steps
            .filter((s) => s.part === pi)
            .map((s) => (
              <button key={s.id} type="button" className="gd-rail-item press" aria-current={s.n === at ? "step" : undefined} onClick={() => onPick(s.n)}>
                <span className="gd-bullet" data-seen={seen.has(s.id) && s.n !== at ? "true" : undefined}>
                  {seen.has(s.id) && s.n !== at ? <IconCheck size={14} /> : s.n}
                </span>
                <span>{s.title}</span>
              </button>
            ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-page">
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-page">
        Skip to the guide
      </a>

      <header className="gd-top glass safe-top">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-8">
          <Link href="/guides" className="press -ml-2 inline-flex h-10 items-center gap-1.5 rounded-xl px-2 text-[0.95rem] font-medium text-soft hover:text-ink" aria-label="Close the guide and go to the library">
            <IconBack />
            <span className="hidden sm:inline">All guides</span>
          </Link>
          <p className="min-w-0 flex-1 truncate text-center text-[0.95rem] font-semibold lg:text-left">
            <span className="text-accent">{guide.code}</span>
            <span className="mx-1.5 text-soft">·</span>
            {guide.title}
          </p>
          {step ? (
            <span className="t-small tabular-nums text-soft" aria-hidden="true">
              {step.n} / {total}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="press inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-raised px-3 text-[0.9rem] font-medium lg:hidden"
          >
            <IconList />
            All steps
          </button>
        </div>
        {bar}
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-44 pt-7 sm:px-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:pt-10">
        <aside className="gd-rail hidden lg:block">
          <div className="sticky top-32 max-h-[calc(100dvh-11rem)] overflow-y-auto pr-2">
            <p className="mb-4 flex items-center gap-2 px-2.5 text-[0.9rem] text-soft">
              <IconSteps /> {total} steps
              <span aria-hidden="true">·</span>
              <IconClock /> about {guide.minutes} min
            </p>
            {stepList((i) => go(i))}
          </div>
        </aside>

        <main id="content" className="min-w-0">
          {/* ------------------------------------------------------------ the first screen */}
          <section className="gd-slide" data-on={at === 0} data-way={way} aria-labelledby="gd-title">
            <div className="night rounded-[var(--radius-sheet)] p-7 sm:p-10">
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <Crest size={30} tone="light" />
                  <p className="text-[0.82rem] font-semibold uppercase tracking-[0.12em] text-white/70">
                    How-to guide <span className="mx-1 text-white/40">·</span> {guide.code}
                  </p>
                </div>
                <h1 id="gd-title" ref={at === 0 ? heading : undefined} tabIndex={-1} className="t-title max-w-[22ch]">
                  {guide.title}
                </h1>
                <p className="t-body max-w-[46ch] text-white/80">{guide.lede}</p>
                <div className="flex flex-wrap gap-2.5 text-[0.85rem]">
                  <span className="rounded-full bg-white/12 px-3.5 py-1.5 font-medium">{guide.forWho}</span>
                  <span className="rounded-full bg-white/12 px-3.5 py-1.5 font-medium">{total} steps</span>
                  <span className="rounded-full bg-white/12 px-3.5 py-1.5 font-medium">About {guide.minutes} minutes</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {saved && saved.at && !saved.done ? (
                    <>
                      <button type="button" className={buttonClasses({ className: "px-8" })} onClick={() => go(Math.max(1, steps.findIndex((s) => s.id === saved.at) + 1))}>
                        <span className="relative">Carry on where you stopped</span>
                      </button>
                      <button type="button" className={buttonClasses({ variant: "night", className: "px-6" })} onClick={() => { forgetSaved(guide.slug); go(1); }}>
                        <span className="relative">Start again</span>
                      </button>
                    </>
                  ) : (
                    <button type="button" className={buttonClasses({ className: "px-10" })} onClick={() => go(1)}>
                      <span className="relative">Start</span>
                    </button>
                  )}
                  {guide.shortcut ? (
                    <button type="button" className="press min-h-11 rounded-xl px-3 text-[0.95rem] font-medium text-white/80 underline decoration-white/30 underline-offset-4 hover:text-white" onClick={() => go(steps.findIndex((s) => s.id === guide.shortcut!.toStep) + 1)}>
                      {guide.shortcut.label}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-8 lg:grid-cols-2">
              <section aria-labelledby="gd-ready" className="card flex flex-col gap-4 p-6">
                <h2 id="gd-ready" className="t-heading">
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
              <section aria-labelledby="gd-inside" className="card flex flex-col gap-4 p-6">
                <h2 id="gd-inside" className="t-heading">
                  What is inside
                </h2>
                <ol className="flex flex-col gap-4">
                  {guide.parts.map((part, pi) => (
                    <li key={part.title} className="flex flex-col gap-1">
                      <button type="button" className="press w-fit text-left" onClick={() => go(part.first + 1)}>
                        <span className="gd-eyebrow">
                          Part {pi + 1} · {part.steps} {part.steps === 1 ? "step" : "steps"}
                        </span>
                        <span className="mt-0.5 block text-[1.05rem] font-semibold">{part.title}</span>
                      </button>
                      {part.blurb ? <p className="t-small text-soft">{part.blurb}</p> : null}
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <p className="t-small mt-6 max-w-[60ch] text-soft">{guide.ifDifferent}</p>
          </section>

          {/* ------------------------------------------------------------ the steps */}
          {steps.map((s, i) => (
            <section key={s.id} id={s.id} className="gd-slide" data-on={at === i + 1} data-way={way} aria-labelledby={`${s.id}-h`}>
              <StepBody step={s} total={total} first={steps.findIndex((x) => x.picture) === i} headingRef={at === i + 1 ? heading : undefined} onZoom={() => setZoom(s)} priority={at === i + 1} />
            </section>
          ))}

          {/* ------------------------------------------------------------ the last screen */}
          <section className="gd-slide" data-on={at === total + 1} data-way={way} aria-labelledby="gd-done">
            <div className="flex flex-col gap-8">
              <div className="night rounded-[var(--radius-sheet)] p-7 sm:p-10">
                <div className="flex flex-col gap-4">
                  <Crest size={46} tone="light" animate />
                  <p className="text-[0.82rem] font-semibold uppercase tracking-[0.12em] text-white/70">All done</p>
                  <h2 id="gd-done" ref={at === total + 1 ? heading : undefined} tabIndex={-1} className="t-title max-w-[20ch]">
                    That is the whole guide.
                  </h2>
                  <p className="t-body max-w-[46ch] text-white/80">Come back to any step when you need it. Your place is kept on this device.</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    <button type="button" className={buttonClasses({ className: "px-7" })} onClick={share}>
                      <IconShare />
                      <span className="relative">Share this guide</span>
                    </button>
                    <button type="button" className={buttonClasses({ variant: "night", className: "px-6" })} onClick={() => window.print()}>
                      <IconPrint />
                      <span className="relative">Print or save as PDF</span>
                    </button>
                  </div>
                </div>
              </div>

              {guide.whoSees.length ? (
                <section aria-labelledby="gd-sees" className="card flex flex-col gap-4 p-6">
                  <h3 id="gd-sees" className="t-heading">
                    Who else sees what you just did
                  </h3>
                  <ul className="gd-do">
                    {guide.whoSees.map((line, i) => (
                      <li key={i} style={{ fontSize: "1.0625rem" }}>
                        <Pieces line={line} />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {guide.next.length ? (
                <section aria-labelledby="gd-more" className="flex flex-col gap-4">
                  <h3 id="gd-more" className="t-heading">
                    Next
                  </h3>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {guide.next.map((n) => (
                      <li key={n.slug}>
                        <Link href={`/guides/${n.slug}`} className="card press flex h-full items-center gap-4 p-4">
                          <span className="gd-chip" style={{ background: "var(--crest-gold)", color: "var(--crest-ink)", border: 0, fontWeight: 750 }}>
                            {n.code}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className="font-semibold">{n.title}</span>
                            <span className="t-small text-soft">
                              {n.steps} steps · about {n.minutes} min
                            </span>
                          </span>
                          <IconNext />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div className="flex flex-col gap-2">
                <p className="t-small text-soft">{guide.ifDifferent}</p>
                <p className="t-small text-soft">The pictures show made-up people and were made{guide.madeOn ? ` on ${guide.madeOn}` : " from a practice copy of the site"}.</p>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* ------------------------------------------------------------ the bar at the bottom */}
      <footer className="gd-bottom glass safe-bottom">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-3 sm:px-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <span className="hidden lg:block" />
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 lg:mx-0">
            {at === 0 ? (
              <button type="button" className={buttonClasses({ fullWidth: true })} onClick={() => go(1)}>
                <span className="relative">{saved && saved.at && !saved.done ? "Carry on" : "Start the guide"}</span>
                <IconNext />
              </button>
            ) : at <= total ? (
              <>
                <button type="button" className={buttonClasses({ variant: "quiet", className: "px-5" })} onClick={() => go(at - 1, "back")} aria-label={at === 1 ? "Back to the start" : "Back to the step before"}>
                  <IconBack />
                  <span className="relative">Back</span>
                </button>
                <button type="button" className={buttonClasses({ className: "min-w-0 flex-1" })} onClick={() => go(at + 1, "fwd")}>
                  <span className="relative min-w-0 truncate">{nextStep ? "Next" : "Finish"}</span>
                  {nextStep ? <IconNext /> : <IconCheck />}
                </button>
              </>
            ) : (
              <>
                <button type="button" className={buttonClasses({ variant: "quiet", className: "px-5" })} onClick={() => go(1, "back")}>
                  <span className="relative">Read it again</span>
                </button>
                <Link href="/guides" className={buttonClasses({ className: "min-w-0 flex-1" })}>
                  <span className="relative">Back to the library</span>
                </Link>
              </>
            )}
          </div>
        </div>
      </footer>

      <p className="sr-only" aria-live="polite" role="status">
        {step ? `Step ${step.n} of ${total}: ${step.title}` : at === 0 ? guide.title : "The end of the guide"}
      </p>

      {/* ------------------------------------------------------------ all steps, as a sheet on a phone */}
      <dialog
        ref={sheet}
        className="gd-sheet"
        aria-label="All steps"
        onClose={() => setSheetOpen(false)}
        onClick={(e) => {
          if (e.target === sheet.current) setSheetOpen(false);
        }}
      >
        <div className="safe-bottom flex flex-col gap-5 p-6">
          <div className="flex items-center justify-between">
            <h2 className="t-heading">All steps</h2>
            <button type="button" className="press grid size-10 place-items-center rounded-full border border-line bg-raised" onClick={() => setSheetOpen(false)} aria-label="Close">
              <IconClose />
            </button>
          </div>
          <button type="button" className="gd-rail-item press" aria-current={at === 0 ? "step" : undefined} onClick={() => { setSheetOpen(false); go(0, "back"); }}>
            <span className="gd-bullet">
              <IconBulb />
            </span>
            <span>The start: what you need</span>
          </button>
          {stepList((i) => { setSheetOpen(false); go(i); })}
        </div>
      </dialog>

      {/* ------------------------------------------------------------ a picture, enlarged */}
      <dialog
        ref={lightbox}
        className="gd-lightbox"
        aria-label="The picture, enlarged"
        onClose={() => setZoom(null)}
        onClick={(e) => {
          if (e.target === lightbox.current) setZoom(null);
        }}
      >
        {zoom?.picture ? (
          <div className="grid size-full place-items-center p-4" onClick={() => setZoom(null)}>
            <div style={{ width: `min(94vw, calc(86dvh * ${zoom.picture.width / zoom.picture.height}))` }} className="gd-frame" onClick={(e) => e.stopPropagation()}>
              <Picture picture={zoom.picture} priority />
            </div>
            <button type="button" className="press fixed right-4 top-4 grid size-11 place-items-center rounded-full bg-white/90 text-black" onClick={() => setZoom(null)} aria-label="Close the picture">
              <IconClose />
            </button>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ one step */
export function StepBody({
  step,
  total,
  first,
  headingRef,
  onZoom,
  priority = false,
}: {
  step: StepView;
  total: number;
  first: boolean;
  headingRef?: React.Ref<HTMLHeadingElement>;
  onZoom?: () => void;
  priority?: boolean;
}) {
  const pic = step.picture;
  const hasNotes = Boolean(step.careful || step.tip || step.why || step.example);
  return (
    <article className="gd-step" data-device={pic?.device ?? "phone"} data-has-pic={pic ? "true" : "false"}>
      <header className="gd-head flex flex-col gap-3">
        <p className="gd-eyebrow">
          Part {step.part + 1} · {step.partTitle} <span aria-hidden="true">·</span> Step {step.n} of {total}
        </p>
        <h2 id={`${step.id}-h`} ref={headingRef} tabIndex={-1} className="t-title">
          {step.title}
        </h2>
      </header>

      <div className="gd-body flex flex-col gap-6">
        <ul className="gd-do">
          {step.lines.map((line, i) => (
            <li key={i}>
              <Pieces line={line} />
            </li>
          ))}
        </ul>
        {step.timeline ? (
          <ol className="gd-timeline">
            {step.timeline.map((t, i) => (
              <li key={i}>
                <span className="gd-when">
                  <Pieces line={t.when} />
                </span>
                <p className="t-body">
                  <Pieces line={t.what} />
                </p>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      {/* One picture. On a phone it comes after the words; on a computer it stands beside them. */}
      {pic ? (
        <div className="gd-pic">
          <Shot picture={pic} first={first} onZoom={onZoom} priority={priority} />
        </div>
      ) : null}

      {hasNotes ? (
        <div className="gd-notes">
          <Notes step={step} />
        </div>
      ) : null}
    </article>
  );
}

function Note({ kind, head, icon, line }: { kind: "tip" | "careful" | "why" | "example"; head: string; icon: React.ReactNode; line: Piece[] }) {
  return (
    <aside className={`gd-note is-${kind}`}>
      <span className="gd-note-icon" aria-hidden="true">
        {icon}
      </span>
      <p className="gd-note-head">{head}</p>
      <p>
        <Pieces line={line} />
      </p>
    </aside>
  );
}

function Notes({ step }: { step: StepView }) {
  return (
    <>
      {step.careful ? <Note kind="careful" head="Careful" icon={<IconWarn />} line={step.careful} /> : null}
      {step.tip ? <Note kind="tip" head="Tip" icon={<IconBulb />} line={step.tip} /> : null}
      {step.why ? <Note kind="why" head="Why" icon={<IconWhy />} line={step.why} /> : null}
      {step.example ? <Note kind="example" head="For example" icon={<IconQuote />} line={step.example} /> : null}
    </>
  );
}
