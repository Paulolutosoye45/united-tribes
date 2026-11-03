import {
  ANNOUNCE_VIEW_ROLES, ASK_ROLES, BOARD_VIEW_ROLES, CONTACT_GAP_ROLES, DATA_ROLES, LEADER_QUALITY_ROLES, MODEL_ROLES, MULTIPLY_ROLES, OFFICE_ROLES, PIPELINE_VIEW_ROLES,
  OVERSIGHT_ROLES, PRIVACY_ROLES, REFEREE_MANAGER_ROLES, REMINDER_ROLES, SIGNIN_ROLES, SWAP_ROLES, TEEN_ROLES, TEMPLATE_VIEW_ROLES, hasAnyRole, type Role,
} from "@/lib/auth/roles";

/**
 * The one list of Admin pages: which section each belongs to, what it is called, who may open it, and what a person might type to
 * find it. The menu, the phone sheet, the search box, the breadcrumbs and the counts beside a page are all built from this list, so a
 * page is added in one place. No page moves and no address changes: this only decides how people find their way to them.
 *
 * Who may open a page is the same list the page itself checks (tests/unit/admin-nav.test.ts reads each page and compares), so the
 * menu never offers a page the person would be sent home from.
 */

export type PageTag = "Growth" | "Care" | "Review";

export type NavPage = {
  href: string;
  label: string;
  /** What you go there to do, in a few words. Shown under a search result. */
  about: string;
  roles: readonly Role[];
  /** Other words for it: the old name, what you came to do. Search finds the page by any of them. */
  synonyms: readonly string[];
  /** The page opens in another area of the app, as it always has; the menu says which. */
  tag?: PageTag;
  /** Pages below this one that are not in the menu, for the breadcrumbs. The ones with an id in their address (one guide, one announcement) are left out. */
  children?: readonly { href: string; label: string }[];
};

export type NavSection = { key: string; label: string; about: string; pages: readonly NavPage[] };

export const SECTIONS: readonly NavSection[] = [
  {
    key: "today",
    label: "Today",
    about: "What is waiting for you, with one button each",
    pages: [
      {
        href: "/admin",
        label: "Today",
        about: "What is waiting for you today",
        roles: OFFICE_ROLES,
        synonyms: ["home", "needs attention", "waiting", "tasks", "overview", "coming up", "shortcuts"],
      },
    ],
  },
  {
    key: "season",
    label: "Season",
    about: "Running the twelve weeks",
    pages: [
      {
        href: "/admin/seasons",
        label: "Seasons",
        about: "Plan, open, run and close a season, and the steps before it opens",
        roles: OFFICE_ROLES,
        synonyms: ["launch checklist", "before the season opens", "launch steps", "open a season", "close a season", "start date", "dates", "twelve weeks", "plan next season"],
      },
      {
        href: "/admin/guides",
        label: "Weekly guides",
        about: "The twelve guides: passages, questions, the sermon link and the confession",
        roles: OFFICE_ROLES,
        synonyms: ["guide", "passage", "questions", "sermon link", "confession", "week", "layers", "reading plan", "scripture"],
        children: [{ href: "/admin/guides/layers", label: "Layers" }],
      },
      {
        href: "/growth/swaps",
        label: "Tribe changes",
        about: "Members asking for a different tribe in the first weeks",
        roles: SWAP_ROLES,
        tag: "Growth",
        synonyms: ["swap", "swaps", "change tribe", "move tribe", "different tribe", "switch tribe"],
      },
      {
        href: "/growth/multiply",
        label: "Next season",
        about: "What happens to each tribe next season: continue, multiply or rest",
        roles: MULTIPLY_ROLES,
        tag: "Growth",
        synonyms: ["multiply", "continue", "rest", "split a tribe", "new tribes", "next season decisions"],
      },
    ],
  },
  {
    key: "people",
    label: "People",
    about: "Who is who, and who may do what",
    pages: [
      {
        href: "/admin/people",
        label: "People and roles",
        about: "Invite the team and see who holds each role",
        roles: ["admin", "director"],
        synonyms: ["invite", "team", "staff", "users", "roles", "make a pastor", "give a role", "remove a role", "who is who", "permissions"],
      },
      {
        href: "/admin/people/contact-gaps",
        label: "Contact gaps",
        about: "Members a leader cannot reach on WhatsApp, and why",
        roles: CONTACT_GAP_ROLES,
        synonyms: ["whatsapp number", "no number", "missing number", "cannot reach", "can't reach", "how to be contacted", "phone number", "number missing", "reach members", "ask for a number"],
      },
      {
        href: "/admin/champions",
        label: "Community champions",
        about: "Who looks after each community",
        roles: OFFICE_ROLES,
        synonyms: ["champion", "community lead", "community leader", "communities"],
      },
      {
        href: "/admin/referees",
        label: "Church referee list",
        about: "The church’s list that checks referees, and the references that need a look",
        roles: REFEREE_MANAGER_ROLES,
        synonyms: ["pastors and unit heads", "unit heads", "referees", "references", "reference", "spreadsheet", "upload a list", "held references", "integrity flags"],
      },
      {
        href: "/care/teens",
        label: "Young people",
        about: "Parent and guardian permission, and the call that confirms it",
        roles: TEEN_ROLES,
        tag: "Care",
        synonyms: ["teens", "teenagers", "parent", "guardian", "permission", "consent", "under 18", "children"],
      },
    ],
  },
  {
    key: "leaders",
    label: "Leaders",
    about: "Getting the right leaders ready",
    pages: [
      {
        href: "/admin/leader-pipeline",
        label: "Leader pipeline",
        about: "The steps to become a leader, and a record of every change",
        roles: PIPELINE_VIEW_ROLES,
        synonyms: ["steps to become a leader", "application steps", "required", "optional", "interview step", "training step", "references step"],
      },
      {
        href: "/admin/leader-quality",
        label: "Answer checks",
        about: "The first check on leader applications, and the ones held for a person",
        roles: LEADER_QUALITY_ROLES,
        synonyms: ["leader quality", "first check", "held applications", "thresholds", "application checks", "quality"],
      },
      {
        href: "/admin/leader-supply",
        label: "Leaders needed",
        about: "Where members are waiting and no leader is ready, and the offers made",
        roles: BOARD_VIEW_ROLES,
        synonyms: ["leader supply", "members waiting", "waiting for a tribe", "no leader", "offers", "demand", "who could lead"],
      },
      {
        href: "/admin/assistants",
        label: "Assistant leaders",
        about: "A leader’s recommendation for an assistant: approve it, decline it, or replace the one they have",
        roles: OVERSIGHT_ROLES,
        synonyms: ["assistant leader", "assistants", "recommend an assistant", "replace an assistant", "second leader", "co-leader", "pair an assistant"],
      },
      {
        href: "/review/templates",
        label: "Ready-made cards",
        about: "Tribe Cards written for leaders to start from, signed off by a pastor",
        roles: TEMPLATE_VIEW_ROLES,
        tag: "Review",
        synonyms: ["tribe card templates", "templates", "sign off", "drafts", "starter cards"],
      },
    ],
  },
  {
    key: "messages",
    label: "Messages",
    about: "Everything the platform sends, and what became of it",
    pages: [
      {
        href: "/admin/announcements",
        label: "Announcements",
        about: "Write to members, see it as they will read it, and send it with a second person’s approval",
        roles: ANNOUNCE_VIEW_ROLES,
        synonyms: ["broadcast", "write to members", "send a message", "newsletter", "approve an announcement", "approvals"],
        children: [
          { href: "/admin/announcements/approvals", label: "Waiting for approval" },
          { href: "/admin/announcements/new", label: "New announcement" },
        ],
      },
      {
        href: "/admin/reminders",
        label: "Automatic reminders",
        about: "Gentle journeys for people who started and went quiet",
        roles: REMINDER_ROLES,
        synonyms: ["journeys", "went quiet", "nudge", "paused", "follow up", "drip", "rehearse"],
      },
      {
        href: "/admin/notifications",
        label: "Notifications",
        about: "The emails the team gets when something needs them, and who gets which",
        roles: OFFICE_ROLES,
        synonyms: ["team emails", "staff emails", "email alerts", "notices", "digest", "daily summary", "switches", "rehearsal", "email", "alerts"],
      },
      {
        href: "/care/asks",
        label: "Asked for a person",
        about: "People who answered a reminder by asking someone to reach out",
        roles: ASK_ROLES,
        tag: "Care",
        synonyms: ["reach out", "call me", "someone to contact", "asked for help", "requests"],
      },
      {
        href: "/admin/messages",
        label: "Message log",
        about: "Every message queued, and what became of it",
        roles: DATA_ROLES,
        synonyms: ["email", "sent", "failed", "delivery", "bounced", "retry", "whatsapp messages", "texts", "queue", "log"],
      },
    ],
  },
  {
    key: "programme",
    label: "Programme",
    about: "The catalogue and the numbers it is measured against",
    pages: [
      {
        href: "/admin/catalogue",
        label: "Communities and goals",
        about: "The shared list members and leaders choose from, and the goals members write in",
        roles: OFFICE_ROLES,
        synonyms: ["catalogue", "goals", "write-ins", "write ins", "communities", "categories"],
      },
      {
        href: "/admin/targets",
        label: "Targets",
        about: "The numbers every dashboard and report is measured against",
        roles: OFFICE_ROLES,
        synonyms: ["kpi", "thriving", "goals for the numbers", "thresholds", "measure"],
      },
      {
        href: "/admin/figures",
        label: "Figures",
        about: "The form so far, leader applications, the Leader Academy, and placement",
        roles: OFFICE_ROLES,
        synonyms: ["at a glance", "statistics", "stats", "numbers", "form so far", "intake", "academy figures", "placement", "applications so far"],
      },
      {
        href: "/growth/model",
        label: "Matching model",
        about: "The weights behind Find your tribe, and what the results suggest changing",
        roles: MODEL_ROLES,
        tag: "Growth",
        synonyms: ["weights", "find your tribe", "fit", "matching", "algorithm", "suggestions"],
      },
    ],
  },
  {
    key: "system",
    label: "System",
    about: "Switches, providers, privacy and the reporting copy",
    pages: [
      {
        href: "/admin/settings",
        label: "Settings",
        about: "The church’s vision and mission, the testimony form, and the platform switches",
        roles: OFFICE_ROLES,
        synonyms: ["vision", "mission", "testimony form", "church name", "switches", "preferences", "platform"],
      },
      {
        href: "/admin/system",
        label: "Sending and email",
        about: "The sending service, the email provider, and the copy your reporting tool reads",
        roles: DATA_ROLES,
        synonyms: ["sending and reporting", "email provider", "smtp", "resend", "worker token", "sending service", "reporting copy", "reporting tool", "power bi", "bi", "mail server"],
      },
      {
        href: "/admin/signin",
        label: "WhatsApp sign-in",
        about: "The switch for WhatsApp codes, how many may go out, and what paused them",
        roles: SIGNIN_ROLES,
        synonyms: ["codes", "whatsapp", "login", "log in", "otp", "one-time code", "paused", "sign in"],
      },
      {
        href: "/admin/privacy",
        label: "Data requests",
        about: "Members who ask for their account and everything in it to be deleted",
        roles: PRIVACY_ROLES,
        synonyms: ["delete account", "delete my account", "erase", "deletion", "forget me", "remove my data", "privacy", "ndpr", "gdpr", "right to be forgotten"],
      },
    ],
  },
];

/** Every page, in menu order. */
export const PAGES: readonly NavPage[] = SECTIONS.flatMap((s) => s.pages);

export const sectionOf = (href: string): NavSection | undefined => SECTIONS.find((s) => s.pages.some((p) => p.href === href));

const clean = (path: string) => {
  const bare = path.split(/[?#]/)[0].replace(/\/+$/, "");
  return bare === "" ? "/" : bare;
};

/** The page a path belongs to: itself, or the page above it (a single announcement belongs to Announcements). Today is only ever exact. */
export function pageFor(pathname: string): NavPage | undefined {
  const path = clean(pathname);
  const exact = PAGES.find((p) => p.href === path);
  if (exact) return exact;
  return [...PAGES]
    .filter((p) => p.href !== "/admin" && path.startsWith(`${p.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export type Crumb = { label: string; href?: string };

/** "Messages › Message log" for a page, and one step more for a page below it that has a name. Everything but the last step is a link, except the section, which has no page of its own. */
export function crumbsFor(pathname: string): Crumb[] {
  const path = clean(pathname);
  const page = pageFor(path);
  if (!page) return [{ label: "Admin", href: "/admin" }];
  if (page.href === "/admin") return [{ label: "Today" }];
  const section = sectionOf(page.href);
  const trail: Crumb[] = [{ label: "Admin", href: "/admin" }];
  if (section) trail.push({ label: section.label });
  const child = page.children?.find((c) => path === c.href || path.startsWith(`${c.href}/`));
  const deeper = path !== page.href;
  trail.push(deeper ? { label: page.label, href: page.href } : { label: page.label });
  if (deeper && child) trail.push({ label: child.label });
  return trail;
}

/** The text of the bar on a phone: the section and the page. */
export function barText(pathname: string): string {
  const page = pageFor(pathname);
  if (!page) return "Admin";
  const section = sectionOf(page.href);
  if (!section || page.href === "/admin") return page.label;
  return `${section.label} › ${page.label}`;
}

export type MenuPage = { href: string; label: string; about: string; tag?: PageTag; count: number };
export type MenuSection = { key: string; label: string; pages: MenuPage[] };

/**
 * The menu for a person: every page that any of the roles they hold may open, once, in the same order for everyone. A person who is
 * both an admin and a pastor sees the pages of both. `counts` is the number waiting beside a page, by address.
 */
export function menuFor(roles: readonly Role[], counts: Readonly<Record<string, number>> = {}): MenuSection[] {
  return SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    pages: s.pages
      .filter((p) => hasAnyRole(roles, p.roles))
      .map((p) => ({ href: p.href, label: p.label, about: p.about, ...(p.tag ? { tag: p.tag } : {}), count: Math.max(0, Math.round(counts[p.href] ?? 0)) })),
  })).filter((s) => s.pages.length > 0);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Words that say nothing about which page is meant ("what is waiting", "delete my account"). Left out of what is typed, not of the names. */
const FILLER = new Set(["a", "an", "the", "my", "me", "i", "to", "of", "for", "what", "whats", "how", "do", "is", "are", "where", "can", "please"]);

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** "referees" and "referee" are the same word to someone typing. */
const stem = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

export type PageMatch<T extends { href: string; label: string }> = { page: T; score: number };

/**
 * Finds pages by their name or by what the person came to do. Every word typed has to start a word of the name or of one of the other
 * words for the page, so "delete account" finds Data requests and "referees" finds Church referee list. A word in the name counts for
 * more than a word in the other names. Pages are given back best first, and in menu order when equal.
 */
export function searchPages<T extends { href: string; label: string }>(query: string, pages: readonly T[], extra: (page: T) => readonly string[] = (p) => PAGES.find((x) => x.href === p.href)?.synonyms ?? []): T[] {
  const typed = words(query).filter((w) => !FILLER.has(w)).map(stem);
  if (typed.length === 0) return [];
  const scored: (PageMatch<T> & { order: number })[] = [];
  pages.forEach((page, order) => {
    const named = words(page.label).map(stem);
    const other = [...extra(page).flatMap(words), ...words(sectionOf(page.href)?.label ?? "")].map(stem);
    let total = 0;
    for (const word of typed) {
      if (named.some((w) => w.startsWith(word))) total += named.includes(word) ? 6 : 5;
      else if (other.some((w) => w.startsWith(word))) total += other.includes(word) ? 3 : 2;
      else {
        total = 0;
        break;
      }
    }
    if (total > 0) scored.push({ page, score: total, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((m) => m.page);
}
