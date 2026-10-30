"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { helpFor, helpForAll } from "@/lib/guides/match";
import type { FoundGuide, PilotArea, PilotData, PilotGuide } from "@/lib/guides/pilot";
import { findControl, menuLink, pointAt, readControls } from "./pointer";
import { memoryRaw, pageKey, parseMemory, pulseFor, remember, subscribeMemory } from "./pilot-state";
import { parseSaved, savedRaw, subscribeProgress } from "./progress";
import "./pilot.css";

/**
 * The "How to use this app" button: on every screen of the app, for every role, because a guide nobody can find helps nobody.
 *
 * It pulses while it is new to a person (and softly on a page whose guide they have not looked at), then settles. Pressed, it opens a sheet:
 * the guide for the page they are on, with chips that point at the real buttons on the page; a one-minute tour of the menu; a search for
 * "what do you want to do?"; and where to start for their role. Everything it offers comes from the guides, so the words, the pictures
 * and the pointing cannot drift apart. What it remembers is kept on the person's own device.
 */

const SEP = "\u0001";
/**
 * "app": the floating button on every screen with a menu. "public": the same, on the sign-in page and the pages reached from an email (only where a guide exists).
 * "inline": a small round button that sits in a form's own header (Find your tribe, the leader application), so it never covers a question. Its sheet
 * opens outside the form, so typing in its search can never submit the form.
 */
type Variant = "app" | "inline" | "public";

const IconHow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.6M12 17.2v.01" />
  </svg>
);
const IconClose = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

const noSubscribe = () => () => {};

/** What a guide's card says about how far the person has got: "", "3 of 12 steps", or "Finished". */
function progressWords(raw: string, steps: number): string {
  const s = parseSaved(raw);
  if (!s) return "";
  if (s.done) return "Finished";
  const seen = Math.min(steps, s.seen.length);
  return seen > 0 ? `${seen} of ${steps} steps` : "";
}

function useSearch(query: string) {
  const q = query.trim();
  const [got, setGot] = useState<{ q: string; results: FoundGuide[] | null }>({ q: "", results: null });
  useEffect(() => {
    if (q.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/guides/find?q=${encodeURIComponent(q)}`, { signal: ctl.signal, credentials: "same-origin" });
        const body = (await res.json()) as { results?: FoundGuide[] };
        setGot({ q, results: body.results ?? [] });
      } catch {
        if (!ctl.signal.aborted) setGot({ q, results: [] });
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);
  if (q.length < 2) return { asked: false, waiting: false, results: [] as FoundGuide[] };
  return { asked: true, waiting: got.q !== q, results: got.q === q ? (got.results ?? []) : [] };
}

export function HowToPilot({ data, variant = "app", tabs = false }: { data: PilotData; variant?: Variant; tabs?: boolean }) {
  const pathname = usePathname();
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);
  const memory = parseMemory(useSyncExternalStore(subscribeMemory, memoryRaw, () => ""));
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [said, setSaid] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const [stops, setStops] = useState<{ area: PilotArea; el: HTMLElement }[]>([]);
  const nextButton = useRef<HTMLButtonElement>(null);
  const [onPage, setOnPage] = useState<string[]>([]);
  const [tourable, setTourable] = useState(0);
  const stopPoint = useRef<(() => void) | null>(null);

  const here = pageKey(pathname);
  const pageGuides = useMemo(() => helpForAll(data.pages, pathname), [data.pages, pathname]);
  const main = helpFor(data.pages, pathname);
  const area = useMemo(() => [...data.areas].sort((a, b) => b.href.length - a.href.length).find((a) => here === a.href || here.startsWith(`${a.href}/`)) ?? null, [data.areas, here]);

  // How far the person has got in the guides this button mentions
  const slugs = useMemo(() => [...new Set([...pageGuides.map((g) => g.slug), ...data.start.map((g) => g.slug)])], [pageGuides, data.start]);
  const raws = useSyncExternalStore(subscribeProgress, () => slugs.map((s) => savedRaw(s)).join(SEP), () => "");
  const rawOf = (slug: string) => (raws ? (raws.split(SEP)[slugs.indexOf(slug)] ?? "") : "");
  const mainStarted = main ? Boolean(parseSaved(rawOf(main.slug))) : false;

  const pulse = client ? pulseFor(memory, pathname, Boolean(main), mainStarted) : "still";
  const isNew = memory.opens === 0;

  // The welcome bubble waits a moment, so a returning person never sees it flash
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1400);
    return () => clearTimeout(t);
  }, []);

  // The welcome bubble is not pressable for its first moments, so a tap meant for the page under it (it arrives while someone is reading) never lands on it by mistake
  const [pressable, setPressable] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setPressable(true), 900);
    return () => clearTimeout(t);
  }, [ready]);

  // Open and close the sheet
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Moving to another page puts everything away
  useEffect(() => {
    return () => {
      stopPoint.current?.();
    };
  }, []);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
    setTour(null);
  }

  // When the sheet opens: which of the page's buttons are really on the screen, and whether the tour has anywhere to go
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const controls = readControls();
      const wanted = [...new Set(pageGuides.flatMap((g) => data.pages.find((p) => p.slug === g.slug)?.controls ?? []))];
      // Buttons and fields first; a title on the page is last, since it is not something to press
      const here = wanted.flatMap((label) => {
        const el = findControl(label, controls);
        return el ? [{ label, heading: el.matches("h1, h2, h3") }] : [];
      });
      here.sort((a, b) => Number(a.heading) - Number(b.heading));
      setOnPage(here.slice(0, 10).map((x) => x.label));
      setTourable(data.areas.filter((a) => menuLink(a.href)).length);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, pageGuides, data.pages, data.areas]);

  // The tour: one ring, kept on the place being explained
  useEffect(() => {
    if (tour === null) return;
    const step = stops[tour];
    if (!step) return;
    const stop = pointAt(step.el, "", { ms: 0, sticky: true });
    nextButton.current?.focus();
    return stop;
  }, [tour, stops]);

  const openSheet = () => {
    remember((m) => ({ ...m, opens: m.opens + 1, bubbleGone: true, pages: m.pages.includes(here) ? m.pages : [...m.pages, here].slice(-60) }));
    setQuery("");
    setOpen(true);
  };

  const startTour = () => {
    const found = data.areas.map((a) => ({ area: a, el: menuLink(a.href) })).filter((s): s is { area: PilotArea; el: HTMLElement } => s.el !== null);
    if (found.length === 0) return false;
    setStops(found);
    remember((m) => ({ ...m, opens: m.opens + 1, bubbleGone: true }));
    setOpen(false);
    setTour(0);
    return true;
  };

  const endTour = (finished: boolean) => {
    setTour(null);
    if (finished) remember((m) => ({ ...m, toured: true }));
  };

  useEffect(() => {
    if (tour === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour]);

  function pointTo(label: string) {
    setOpen(false);
    setTimeout(() => {
      const el = findControl(label);
      if (!el) return setSaid(`${label} is not on this screen right now.`);
      stopPoint.current?.();
      stopPoint.current = pointAt(el, label);
      setSaid(`Pointing at ${label}.`);
    }, 160);
  }

  const found = useSearch(query);

  // Not where it would only be in the way: the guides themselves (and the Tribe Card guide), the owner's passphrase screen and a page made for printing
  const hidden =
    pathname.startsWith("/guides") ||
    pathname.startsWith("/tutorial") ||
    pathname.startsWith("/god/unlock") ||
    pathname.startsWith("/exports/print") ||
    (variant === "public" && !main);
  if (hidden) return null;

  // The welcome bubble is for a new person on their Home page, and nowhere else: never on the sign-in page, a page reached from an email, a form someone is
  // in the middle of, or a screen with something to press where the bubble sits. Everywhere else the button pulses, and that is enough.
  const bubble = client && ready && isNew && !memory.bubbleGone && !open && tour === null && variant === "app" && here === "/home";
  const resume = main ? parseSaved(rawOf(main.slug)) : null;
  const mainHref = main ? `/guides/${main.slug}${resume && !resume.done && resume.at ? `#${resume.at}` : ""}` : "";
  const mainPage = main ? data.pages.find((p) => p.slug === main.slug) : null;
  const others = pageGuides.filter((g) => g.slug !== main?.slug);
  const current = tour !== null ? (stops[tour] ?? null) : null;
  const last = tour !== null && tour === stops.length - 1;

  const button = tour === null ? (
    <button
      type="button"
      data-howto-ui=""
      data-testid="howto-button"
      data-pulse={pulse}
      data-new={isNew ? "true" : "false"}
      data-tabs={tabs ? "true" : "false"}
      data-inline={variant === "inline" ? "true" : "false"}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="howto-sheet"
      className="hp-btn press print:hidden"
      onClick={openSheet}
    >
      <span className="hp-icon">
        <IconHow />
      </span>
      <span className={variant === "inline" ? "hp-label sr-only" : "hp-label"}>How to use this app</span>
    </button>
  ) : null;

  const overlay = (
    <>
      {bubble ? (
        <div role="status" data-howto-ui="" data-testid="howto-bubble" data-tabs={tabs ? "true" : "false"} data-live={pressable ? "true" : "false"} className="hp-bubble print:hidden">
          <p className="t-body font-semibold">New here?</p>
          <p className="t-small text-soft">I can show you around, point to the buttons on this page, or find the guide you need.</p>
          <div className="hp-bubble-actions">
            <button type="button" className="hp-go" data-testid="howto-bubble-yes" onClick={() => {
                if (data.areas.length < 2 || !startTour()) openSheet();
              }}
            >
              Show me around
            </button>
            <button type="button" className="hp-quiet" data-testid="howto-bubble-no" onClick={() => remember((m) => ({ ...m, bubbleGone: true }))}>
              Not now
            </button>
          </div>
        </div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" data-testid="howto-said">
        {said}
      </p>

      <dialog
        ref={dialog}
        id="howto-sheet"
        data-howto-ui=""
        data-testid="howto-sheet"
        aria-labelledby="howto-title"
        className="hp-sheet"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        {open ? (
          <div className="hp-panel">
            <div className="hp-head">
              <div>
                <h2 id="howto-title">How to use this app</h2>
                <p className="hp-where">{area ? `You are on ${area.label}. ${area.about}` : "Short guides, with a picture of the real screen for every step."}</p>
              </div>
              <button type="button" className="hp-close" aria-label="Close" data-testid="howto-close" onClick={() => setOpen(false)}>
                <IconClose />
              </button>
            </div>

            <section aria-labelledby="hp-here">
              <h3 id="hp-here">On this page</h3>
              {main && mainPage ? (
                <div className="hp-card">
                  <strong>{main.title}</strong>
                  <span className="hp-meta">
                    {mainPage.steps} steps, about {mainPage.minutes} minutes{progressWords(rawOf(main.slug), mainPage.steps) ? `. ${progressWords(rawOf(main.slug), mainPage.steps)}.` : "."}
                  </span>
                  <div>
                    <Link href={mainHref} className="hp-go" data-testid="howto-main" onClick={() => setOpen(false)}>
                      {resume && !resume.done && resume.at ? "Carry on where you stopped" : "Show me, step by step"}
                    </Link>
                  </div>
                  {onPage.length > 0 ? (
                    <div>
                      <p className="hp-chips-title">Or point to it on this page:</p>
                      <div className="hp-chips">
                        {onPage.map((label) => (
                          <button key={label} type="button" className="hp-chip" data-testid="howto-chip" onClick={() => pointTo(label)}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="hp-note" data-testid="howto-noguide">
                  There is no step-by-step guide for this page yet. Take the tour, search below, or start with the guides for you.
                </p>
              )}
              {others.length > 0 ? (
                <ul className="hp-list">
                  {others.map((g) => (
                    <li key={g.slug}>
                      <Link href={`/guides/${g.slug}`} className="hp-row" onClick={() => setOpen(false)}>
                        <b>{g.title}</b>
                        <span>Also for this page</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {tourable > 1 ? (
                <p className="mt-3">
                  <button type="button" className="hp-quiet" data-testid="howto-tour-start" onClick={() => startTour()}>
                    Take the one-minute tour of the menu
                  </button>
                </p>
              ) : null}
            </section>

            <section aria-labelledby="hp-find">
              <h3 id="hp-find">Find a guide</h3>
              <label htmlFor="howto-search" className="sr-only">
                What do you want to do?
              </label>
              <input
                id="howto-search"
                type="search"
                className="hp-search"
                placeholder="What do you want to do?"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="howto-search"
              />
              {found.asked ? (
                found.waiting ? (
                  <p className="hp-note">Looking…</p>
                ) : found.results.length > 0 ? (
                  <ul className="hp-list" data-testid="howto-results" aria-label="Guides found">
                    {found.results.map((g) => (
                      <li key={g.slug}>
                        <Link href={g.href} className="hp-row" onClick={() => setOpen(false)}>
                          <b>{g.title}</b>
                          <span>
                            {g.forWho}. {g.steps} steps, about {g.minutes} minutes.
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hp-note" data-testid="howto-nothing">
                    Nothing found for that. Try fewer or simpler words.
                  </p>
                )
              ) : null}
            </section>

            {data.start.length > 0 ? (
              <section aria-labelledby="hp-start">
                <h3 id="hp-start">{data.signedIn ? "Start here" : "Open to everyone"}</h3>
                <ul className="hp-list" data-testid="howto-start">
                  {data.start.map((g: PilotGuide) => (
                    <li key={g.slug}>
                      <Link href={g.href} className="hp-row" onClick={() => setOpen(false)}>
                        <b>{g.title}</b>
                        <span>
                          {g.steps} steps, about {g.minutes} minutes
                          {progressWords(rawOf(g.slug), g.steps) ? `. ${progressWords(rawOf(g.slug), g.steps)}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.areas.length > 1 ? (
              <details className="hp-details" data-testid="howto-map">
                <summary>Where things are</summary>
                <ul className="hp-list">
                  {data.areas.map((a) => (
                    <li key={a.href}>
                      <Link href={a.href} className="hp-row" aria-current={area?.href === a.href ? "page" : undefined} onClick={() => setOpen(false)}>
                        <b>{a.label}</b>
                        <span>{a.about}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <div className="hp-foot">
              <Link href="/guides" className="hp-quiet" onClick={() => setOpen(false)}>
                All how-to guides
              </Link>
              <button type="button" className="hp-quiet" data-testid="howto-quiet" onClick={() => remember((m) => ({ ...m, quiet: !m.quiet }))}>
                {memory.quiet ? "Let the button pulse again" : "Stop the pulse"}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>

      {current ? (
        <div role="dialog" aria-modal="false" aria-label="Tour of the menu" data-howto-ui="" data-testid="howto-tour" className="hp-tour print:hidden">
          <span className="hp-tour-step" aria-live="polite">
            {(tour ?? 0) + 1} of {stops.length}
          </span>
          <h3>{current.area.label}</h3>
          <p className="t-body text-soft">{current.area.about}</p>
          <div className="hp-tour-actions">
            <button type="button" className="hp-quiet" disabled={tour === 0} data-testid="howto-tour-back" onClick={() => setTour((i) => Math.max(0, (i ?? 0) - 1))}>
              Back
            </button>
            <button
              ref={nextButton}
              type="button"
              className="hp-go"
              data-testid="howto-tour-next"
              onClick={() => (last ? endTour(true) : setTour((i) => (i ?? 0) + 1))}
            >
              {last ? "Done" : "Next"}
            </button>
            {!last ? (
              <button type="button" className="hp-quiet" data-testid="howto-tour-stop" onClick={() => endTour(false)}>
                Stop
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <>
      {button}
      {variant === "inline" ? (client ? createPortal(overlay, document.body) : null) : overlay}
    </>
  );
}
