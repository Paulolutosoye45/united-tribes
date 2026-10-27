import type { Role } from "@/lib/auth/roles";
import { canOpen } from "./access";
import { GUIDES } from "./catalogue";

/**
 * Which guide answers "how do I use this page?". The little help button in the app's header takes a person to it.
 *
 * The first line that matches the page, and that this person is allowed to read, wins. So a leader and an assistant leader, on the very
 * same page, are each taken to their own guide, and a person is never sent to a guide that would say "not for you".
 */
type Line = { prefix: string; exact?: boolean; slug: string; when?: (roles: readonly Role[]) => boolean };

const holds = (role: Role) => (roles: readonly Role[]) => roles.includes(role);

export const HELP_LINES: readonly Line[] = [
  { prefix: "/lead/week", slug: "assistant-leader", when: (roles) => roles.includes("assistant_leader") && !roles.includes("leader") },
  { prefix: "/lead/week", slug: "run-your-week" },
  { prefix: "/lead/progress", slug: "your-tribes-season" },
  { prefix: "/lead/academy", slug: "leader-academy" },
  { prefix: "/lead/apply", slug: "apply-to-lead" },
  { prefix: "/lead/tribe", slug: "appointed-to-lead" },
  { prefix: "/lead", exact: true, slug: "appointed-to-lead", when: holds("leader") },
  { prefix: "/lead", exact: true, slug: "apply-to-lead" },
  { prefix: "/care", slug: "assistant-leader", when: holds("assistant_leader") },
  { prefix: "/join", slug: "find-your-tribe" },
  { prefix: "/tribe/testimony", slug: "share-a-testimony" },
  { prefix: "/tribe", slug: "join-your-tribe" },
  { prefix: "/profile", slug: "your-information" },
  { prefix: "/privacy", slug: "your-information" },
];

/** What the browser needs to choose a guide for the page it is on: small, and only guides this person may open. */
export type HelpEntry = { prefix: string; exact: boolean; slug: string; title: string };

export function helpEntriesFor(roles: readonly Role[]): HelpEntry[] {
  const out: HelpEntry[] = [];
  for (const line of HELP_LINES) {
    if (line.when && !line.when(roles)) continue;
    const guide = GUIDES.find((g) => g.slug === line.slug);
    if (!guide || !canOpen(guide, roles)) continue;
    out.push({ prefix: line.prefix, exact: line.exact === true, slug: guide.slug, title: guide.title });
  }
  return out;
}

/** The guide for this address, if there is one. Runs in the browser, so it knows nothing but the entries it was given. */
export function helpFor(entries: readonly HelpEntry[], pathname: string): HelpEntry | null {
  const here = pathname.replace(/\/+$/, "") || "/";
  return entries.find((e) => (e.exact ? here === e.prefix : here === e.prefix || here.startsWith(`${e.prefix}/`))) ?? null;
}
