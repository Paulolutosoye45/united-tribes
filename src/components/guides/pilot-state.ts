/**
 * What the "How to use this app" button remembers about one person, kept on their own phone or computer and never sent anywhere. It is only
 * a convenience: if the browser will not keep it, the button simply behaves as it does for someone new (it pulses, it offers the tour) and
 * nothing breaks.
 */
export type PilotMemory = {
  /** How many times the sheet has been opened. Zero means the button is still new to this person. */
  opens: number;
  /** The person asked for the button to be still. */
  quiet: boolean;
  /** The one-minute tour of the menu was finished (or skipped to the end). */
  toured: boolean;
  /** The welcome bubble was put away. */
  bubbleGone: boolean;
  /** Pages (by their main address) where the sheet has been opened, so the button settles down on a page once it has been looked at. */
  pages: string[];
};

export const FRESH: PilotMemory = { opens: 0, quiet: false, toured: false, bubbleGone: false, pages: [] };

const KEY = "ut-howto-v1";
export const PILOT_EVENT = "ut-howto-change";

export function memoryRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function parseMemory(raw: string): PilotMemory {
  if (!raw) return FRESH;
  try {
    const v = JSON.parse(raw) as Partial<PilotMemory>;
    return {
      opens: typeof v.opens === "number" && v.opens > 0 ? Math.min(Math.floor(v.opens), 1_000_000) : 0,
      quiet: v.quiet === true,
      toured: v.toured === true,
      bubbleGone: v.bubbleGone === true,
      pages: Array.isArray(v.pages) ? v.pages.filter((p): p is string => typeof p === "string").map((p) => p.slice(0, 80)).slice(-60) : [],
    };
  } catch {
    return FRESH;
  }
}

/** Changes a little of what is remembered and tells every open part of the page. */
export function remember(change: (m: PilotMemory) => PilotMemory) {
  const next = change(parseMemory(memoryRaw()));
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* a private window, or storage that is full: the button still works */
  }
  window.dispatchEvent(new Event(PILOT_EVENT));
}

export function subscribeMemory(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(PILOT_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(PILOT_EVENT, cb);
  };
}

/** The main address of a page, without a trailing slash, so "/lead/week/" and "/lead/week" are one page. */
export const pageKey = (pathname: string) => (pathname.replace(/\/+$/, "") || "/").slice(0, 80);

/**
 * How the button should look right now.
 *   strong  new to the button: a bold ripple and the full words
 *   soft    this page has a guide that has not been looked at yet: a gentle ripple
 *   still   nothing new to say here
 * A person who asked for stillness always gets "still"; a person who has not opened the button yet always gets "strong".
 */
export type Pulse = "strong" | "soft" | "still";

export function pulseFor(m: PilotMemory, pathname: string, pageHasGuide: boolean, guideStarted: boolean): Pulse {
  if (m.quiet) return "still";
  if (m.opens === 0) return "strong";
  if (pageHasGuide && !guideStarted && !m.pages.includes(pageKey(pathname))) return "soft";
  return "still";
}
