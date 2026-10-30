import { hasAnyRole, type NavItem, type Role } from "@/lib/auth/roles";
import { guidesFor } from "./access";
import { GUIDES } from "./catalogue";
import { helpEntriesFor } from "./context";
import { labelsIn } from "./markup";
import { TRIBE_CARD_GUIDE } from "./tribe-card";
import { cardOf, stepCount } from "./view";
import type { Guide } from "./types";

/**
 * Everything the "How to use this app" button needs, worked out on the server for one person and sent as plain data. It holds only guides
 * this person may open, so the button can never offer a guide that would say "not for you". The button runs in the browser and knows
 * nothing else.
 */
export type PilotPage = {
  prefix: string;
  exact: boolean;
  slug: string;
  title: string;
  minutes: number;
  steps: number;
  /** Every button, link and field the guide tells the person to press, exactly as the screen spells it. The button points at the ones on this page. */
  controls: string[];
};
export type PilotGuide = { slug: string; title: string; minutes: number; steps: number; href: string };
export type PilotArea = { href: string; label: string; about: string };
export type PilotData = {
  signedIn: boolean;
  pages: PilotPage[];
  /** Where to begin, in order. */
  start: PilotGuide[];
  /** The main places in the menu, each with what it is for. The tour walks through these. */
  areas: PilotArea[];
};

/** What each place in the menu is for, in the words of a person who has not seen it yet. */
export const AREA_ABOUT: Record<string, string> = {
  "/home": "Your starting point: what is waiting for you today.",
  "/tribe": "Find your tribe, join it, and see your week with it.",
  "/lead": "Apply to lead a tribe, or run the one you lead.",
  "/review": "Read leader applications and take them through each step.",
  "/dashboard": "How the season is going, in numbers.",
  "/community": "Your community, and what you write to it.",
  "/reports": "The weekly and community reports.",
  "/care": "Who needs a call, and who has it.",
  "/review/rhythm": "The week across every tribe.",
  "/growth": "What the programme is learning, and the requests that need a decision.",
  "/admin": "Seasons, people and roles, messages, privacy requests.",
  "/god": "The owner's console: switches, oversight and the record of changes.",
};

const LABEL_LIMIT = 60;

/** Every [[control]] a guide names, once each, in the order the steps come. */
export function controlsOf(g: Guide): string[] {
  const seen = new Set<string>();
  for (const part of g.parts)
    for (const step of part.steps)
      for (const line of [...step.do, step.tip ?? "", step.careful ?? ""]) for (const label of labelsIn(line)) seen.add(label);
  return [...seen].slice(0, LABEL_LIMIT);
}

const asGuide = (g: Guide): PilotGuide => ({ slug: g.slug, title: g.title, minutes: g.minutes, steps: stepCount(g), href: `/guides/${g.slug}` });

/** `roles` is null for someone who is not signed in. */
export function pilotFor(roles: readonly Role[] | null, nav: readonly NavItem[]): PilotData {
  const pages: PilotPage[] = helpEntriesFor(roles).flatMap((e) => {
    const g = GUIDES.find((x) => x.slug === e.slug);
    return g ? [{ ...e, minutes: g.minutes, steps: stepCount(g), controls: controlsOf(g) }] : [];
  });

  // Signing in is not where a signed-in person starts; everything else comes in the order of their shelves (the most responsibility first)
  const mine = guidesFor(GUIDES, roles).filter((g) => (roles ? g.slug !== "sign-in" : true));
  const start: PilotGuide[] = mine.slice(0, 4).map(asGuide);
  if (roles && hasAnyRole(roles, ["leader"])) {
    start.unshift({ slug: TRIBE_CARD_GUIDE.slug, title: TRIBE_CARD_GUIDE.title, minutes: TRIBE_CARD_GUIDE.minutes, steps: TRIBE_CARD_GUIDE.steps, href: TRIBE_CARD_GUIDE.href ?? "/tutorial" });
    start.length = Math.min(start.length, 4);
  }

  const areas: PilotArea[] = nav.map((n) => ({ href: n.href, label: n.label, about: AREA_ABOUT[n.href] ?? "" })).filter((a) => a.about);
  return { signedIn: roles !== null, pages, start, areas };
}

export type FoundGuide = { slug: string; title: string; lede: string; forWho: string; minutes: number; steps: number; href: string };

/** The guides this person may open that match every word they typed, the best first (a word in the title counts for most). */
export function searchGuides(roles: readonly Role[] | null, query: string, limit = 6): FoundGuide[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'’-]/gu, ""))
    .filter((w) => w.length > 0)
    .slice(0, 6);
  if (words.length === 0) return [];
  const pool: { guide: Guide | null; card: ReturnType<typeof cardOf>; href: string }[] = guidesFor(GUIDES, roles).map((g) => ({ guide: g, card: cardOf(g), href: `/guides/${g.slug}` }));
  if (roles && hasAnyRole(roles, ["leader", "assistant_leader"])) pool.unshift({ guide: null, card: TRIBE_CARD_GUIDE, href: TRIBE_CARD_GUIDE.href ?? "/tutorial" });
  return pool
    .filter((p) => words.every((w) => p.card.search.includes(w)))
    .map((p) => ({ p, score: words.reduce((n, w) => n + (p.card.title.toLowerCase().includes(w) ? 3 : 0) + (p.card.lede.toLowerCase().includes(w) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => ({ slug: p.card.slug, title: p.card.title, lede: p.card.lede, forWho: p.card.forWho, minutes: p.card.minutes, steps: p.card.steps, href: p.href }));
}
