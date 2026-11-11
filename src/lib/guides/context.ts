import type { Role } from "@/lib/auth/roles";
import { canOpen } from "./access";
import { GUIDES } from "./catalogue";
import { helpFor, helpForAll, type HelpEntry } from "./match";

/**
 * Which guide answers "how do I use this page?". The "How to use this app" button takes a person to it.
 *
 * The first line that matches the page, and that this person is allowed to read, is the main one. So a leader and an assistant leader, on the
 * very same page, are each taken to their own guide, and a person is never sent to a guide that would say "not for you". A page may have
 * more than one guide (the leader's tribe page has the one for starting out and the one for asking about a member's place); the others
 * follow the main one.
 */
type Line = { prefix: string; exact?: boolean; slug: string; when?: (roles: readonly Role[]) => boolean };

const holds = (role: Role) => (roles: readonly Role[]) => roles.includes(role);

export const HELP_LINES: readonly Line[] = [
  { prefix: "/lead/week", slug: "assistant-leader", when: (roles) => roles.includes("assistant_leader") && !roles.includes("leader") },
  { prefix: "/lead/week", slug: "run-your-week" },
  { prefix: "/lead/progress", slug: "your-tribes-season" },
  { prefix: "/lead/hand", slug: "send-by-whatsapp" },
  { prefix: "/lead/academy", slug: "leader-academy" },
  { prefix: "/lead/apply", slug: "apply-to-lead" },
  { prefix: "/lead/tribe", slug: "appointed-to-lead" },
  { prefix: "/lead/tribe", slug: "ask-about-a-place", when: holds("leader") },
  { prefix: "/lead", exact: true, slug: "appointed-to-lead", when: holds("leader") },
  { prefix: "/lead", exact: true, slug: "reach-your-tribe", when: holds("leader") },
  { prefix: "/lead", exact: true, slug: "apply-to-lead" },
  // The questions leaders ask: follows the main guide on every Lead page, for a leader
  { prefix: "/lead", slug: "leader-questions", when: holds("leader") },
  { prefix: "/care", slug: "assistant-leader", when: holds("assistant_leader") },
  { prefix: "/join", slug: "find-your-tribe" },
  { prefix: "/tribe/testimony", slug: "share-a-testimony" },
  { prefix: "/tribe", slug: "join-your-tribe" },
  { prefix: "/profile", slug: "your-information" },
  { prefix: "/profile", slug: "be-reached" },
  { prefix: "/privacy", slug: "your-information" },
  // The church's own people
  { prefix: "/admin/messages/whatsapp-mode", slug: "whatsapp-mode" },
  { prefix: "/admin/messages/whatsapp-cost", slug: "whatsapp-mode" },
  { prefix: "/admin/messages/by-hand", slug: "whatsapp-mode" },
  { prefix: "/admin/messages/whatsapp", slug: "whatsapp-health" },
  { prefix: "/admin/messages", slug: "whatsapp-health" },
  { prefix: "/growth/removals", slug: "decide-a-place-change" },
  { prefix: "/admin/people/contact-gaps", slug: "contact-gaps" },
  { prefix: "/admin/people/leader-cards", slug: "leader-cards" },
  { prefix: "/admin/tribes", slug: "place-or-move-a-member" },
  { prefix: "/admin/people", slug: "place-or-move-a-member" },
  // Pages people reach from an email or before they have an account: open to anyone with the link
  { prefix: "/sign-in", slug: "sign-in" },
  { prefix: "/reference", slug: "give-a-reference" },
  { prefix: "/guardian", slug: "parent-permission" },
  { prefix: "/placed", slug: "you-have-been-placed" },
];

export type { HelpEntry };

/** `roles` is null for someone who is not signed in: they are offered only the guides that open for anyone with the link. */
export function helpEntriesFor(roles: readonly Role[] | null): HelpEntry[] {
  const out: HelpEntry[] = [];
  for (const line of HELP_LINES) {
    if (line.when && !line.when(roles ?? [])) continue;
    const guide = GUIDES.find((g) => g.slug === line.slug);
    if (!guide || !canOpen(guide, roles)) continue;
    out.push({ prefix: line.prefix, exact: line.exact === true, slug: guide.slug, title: guide.title });
  }
  return out;
}

export { helpFor, helpForAll };
