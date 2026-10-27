import { hasAnyRole, type Role } from "@/lib/auth/roles";
import type { Guide } from "./types";

/**
 * Who may open which guide. One rule, used by the library page, the guide page and the picture route, so a picture can never be fetched
 * by someone who may not read the guide it belongs to.
 *
 *   - A public guide opens for anyone with the link, signed in or not: sign-in help, and the pages people reach from an email.
 *   - Any other guide opens for a signed-in person who holds one of its audience roles (or one of the roles that see it as "what others see").
 *   - Everyone with an account holds the member role, so the member guides are for everyone. A tribe leader reads the member guides and
 *     their own; a pastor reads the member guides and the pastor's.
 *   - The hidden owner holds every role, so they may open every guide. No guide describes the owner's console.
 */
export type Door = "open" | "sign-in" | "forbidden";

/** `roles` is null for someone who is not signed in. */
export function doorFor(guide: Pick<Guide, "audience" | "seenBy" | "public">, roles: readonly Role[] | null): Door {
  if (guide.public) return "open";
  if (!roles) return "sign-in";
  return hasAnyRole(roles, [...guide.audience, ...(guide.seenBy ?? [])]) ? "open" : "forbidden";
}

export const canOpen = (guide: Pick<Guide, "audience" | "seenBy" | "public">, roles: readonly Role[] | null) => doorFor(guide, roles) === "open";

/**
 * A page that people reach from an email (a referee, a parent, a member who has been placed) is open to anyone with the link and is not a
 * shelf guide: it is listed only for the roles that look after it ("what other people see"). A public guide with no such roles, such as
 * signing in, is an ordinary guide that also opens for visitors, and sits on its audience's shelf.
 */
const isEmailPage = (g: Pick<Guide, "public" | "seenBy">) => Boolean(g.public && g.seenBy?.length);

/** The order the shelves come in for someone holding several roles: the most responsibility first. */
const SHELF_ORDER: readonly Role[] = ["admin", "pastor", "director", "data_lead", "care_lead", "coach", "community_champion", "leader", "assistant_leader", "member"];

export const SHELF_TITLES: Record<Role, { title: string; blurb: string }> = {
  member: { title: "For every member", blurb: "Finding your tribe, joining it, and the week you will have together." },
  leader: { title: "For tribe leaders", blurb: "From the first step of applying to running your tribe's season." },
  assistant_leader: { title: "For assistant leaders", blurb: "Your part beside the leader." },
  pastor: { title: "For pastors", blurb: "Decisions that are yours to make." },
  director: { title: "For directors", blurb: "Invitations, offers, moves and the next season." },
  admin: { title: "For admins", blurb: "Running the season, the people and the messages." },
  coach: { title: "For coaches", blurb: "Walking with the leaders you coach." },
  care_lead: { title: "For care leads", blurb: "Care tasks, call-backs and young people." },
  community_champion: { title: "For community champions", blurb: "Your community and what you write to it." },
  data_lead: { title: "For data leads", blurb: "Reading the numbers and watching sending." },
};

export type Shelf = { key: Role | "others"; title: string; blurb: string; guides: Guide[] };

/**
 * The shelves a person sees. A guide sits on the shelf of its first audience role, and on one shelf only.
 * Guides that people reach from an email ("what others see") sit on a last shelf for the roles that look after them.
 * Someone who is not signed in sees only the public guides, on one shelf.
 */
export function shelvesFor(all: readonly Guide[], roles: readonly Role[] | null): Shelf[] {
  if (!roles) {
    const open = all.filter((g) => g.public);
    return open.length ? [{ key: "others", title: "Open to everyone", blurb: "No sign-in needed. Sign in to see the guides for your role.", guides: open }] : [];
  }
  const shelves: Shelf[] = [];
  const placed = new Set<string>();
  for (const role of SHELF_ORDER) {
    if (!roles.includes(role)) continue;
    const guides = all.filter((g) => !isEmailPage(g) && g.audience[0] === role && canOpen(g, roles) && !placed.has(g.slug));
    guides.forEach((g) => placed.add(g.slug));
    if (guides.length) shelves.push({ key: role, ...SHELF_TITLES[role], guides });
  }
  // Guides for a role someone holds only as a second audience role (a pastor's guide a director also reads)
  const stray = all.filter((g) => !isEmailPage(g) && !placed.has(g.slug) && hasAnyRole(roles, g.audience));
  if (stray.length) {
    for (const g of stray) {
      const shelf = shelves.find((s) => s.key === g.audience.find((r) => roles.includes(r)));
      if (shelf) shelf.guides.push(g);
      else shelves.push({ key: g.audience[0], ...SHELF_TITLES[g.audience[0]], guides: [g] });
      placed.add(g.slug);
    }
  }
  const others = all.filter((g) => !placed.has(g.slug) && canOpen(g, roles) && (g.public || (g.seenBy && hasAnyRole(roles, g.seenBy))));
  // A member sees the guides that anyone with a link can open only in the pages of the guides that mention them, not on a shelf
  const shelfOthers = others.filter((g) => g.seenBy && hasAnyRole(roles, g.seenBy));
  if (shelfOthers.length) {
    shelves.push({ key: "others", title: "What other people see", blurb: "The pages people reach from an email, so you know what they are looking at.", guides: shelfOthers });
  }
  return shelves;
}

/** Every guide this person may open, once each, on the shelves in order. */
export function guidesFor(all: readonly Guide[], roles: readonly Role[] | null): Guide[] {
  return shelvesFor(all, roles).flatMap((s) => s.guides);
}
