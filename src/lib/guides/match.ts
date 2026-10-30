/**
 * Choosing the guides for the page a person is on. This part has no guides in it, only the small list the server sent, so the button that
 * runs in the browser stays small.
 */
export type HelpEntry = { prefix: string; exact: boolean; slug: string; title: string };

const matches = (e: HelpEntry, pathname: string) => {
  const here = pathname.replace(/\/+$/, "") || "/";
  return e.exact ? here === e.prefix : here === e.prefix || here.startsWith(`${e.prefix}/`);
};

/** The main guide for this address, if there is one. */
export function helpFor<T extends HelpEntry>(entries: readonly T[], pathname: string): T | null {
  return entries.find((e) => matches(e, pathname)) ?? null;
}

/** Every guide for this address, the main one first, each once. */
export function helpForAll<T extends HelpEntry>(entries: readonly T[], pathname: string): T[] {
  const seen = new Set<string>();
  return entries.filter((e) => matches(e, pathname) && !seen.has(e.slug) && seen.add(e.slug));
}
