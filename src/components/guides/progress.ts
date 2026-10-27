/**
 * Where a person has got to in each guide, kept on their own phone or computer (never sent anywhere). It is a convenience:
 * if the browser will not keep it, every guide still opens at the start and nothing breaks.
 */
export type Saved = { at: string; seen: string[]; done: boolean; t: number };

const key = (slug: string) => `ut-guide-v1:${slug}`;
export const PROGRESS_EVENT = "gd-progress";

export function savedRaw(slug: string): string {
  try {
    return window.localStorage.getItem(key(slug)) ?? "";
  } catch {
    return "";
  }
}

export function parseSaved(raw: string): Saved | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Saved>;
    if (typeof v.at !== "string" || !Array.isArray(v.seen)) return null;
    return { at: v.at.slice(0, 80), seen: v.seen.filter((s): s is string => typeof s === "string").slice(0, 80), done: v.done === true, t: typeof v.t === "number" ? v.t : 0 };
  } catch {
    return null;
  }
}

export function writeSaved(slug: string, s: Saved) {
  try {
    window.localStorage.setItem(key(slug), JSON.stringify(s));
  } catch {
    /* a private window, or storage that is full: the guide still works */
  }
  window.dispatchEvent(new Event(PROGRESS_EVENT));
}

export function forgetSaved(slug: string) {
  try {
    window.localStorage.removeItem(key(slug));
  } catch {
    /* nothing to forget */
  }
  window.dispatchEvent(new Event(PROGRESS_EVENT));
}

export function subscribeProgress(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(PROGRESS_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(PROGRESS_EVENT, cb);
  };
}
