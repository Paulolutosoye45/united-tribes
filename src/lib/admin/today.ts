import { DASHBOARD_ROLES, ROLE_LABELS, hasAnyRole, isRole, type Role } from "@/lib/auth/roles";
import { PAGES } from "./nav";

/**
 * What the Today page shows, from what the database says is waiting (admin_attention). The database has already decided which kinds of
 * work belong to the signed-in person, from all the roles they hold; this only words it, filters it by role when they choose one hat,
 * and picks their shortcuts. Nothing here decides who may see what.
 */

export type AttentionRow = {
  key: string;
  /** The thing counted, in the singular and the plural: "deletion request", "deletion requests". */
  one: string;
  many: string;
  /** The roles this person holds that this work belongs to. A pastor who is also an admin may see "Admin" and "Pastor" on one row. */
  roles: Role[];
  count: number;
  oldestDays: number;
  urgent: boolean;
  href: string;
};

export type Coming = { label: string; on: string; href: string | null };
export type Numbers = { placed: number; applicationsMonth: number; certified: number; tribesOpen: number };
export type Attention = {
  roles: Role[];
  rows: AttentionRow[];
  coming: Coming[];
  numbers: Numbers | null;
  notices: { off: number; empty: string[]; faults: number };
};

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const int = (v: unknown, fallback = 0) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
};
const text = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
/** Only a path on our own site. */
const ownPath = (v: unknown) => {
  const s = text(v, 200);
  return /^\/[A-Za-z0-9/_-]*$/.test(s) && !s.startsWith("//") ? s : null;
};

/** Reads what the database sent, leaving out anything that is not in the shape we expect, so a surprise never breaks the page. */
export function parseAttention(raw: unknown): Attention | null {
  const o = obj(raw);
  if (!o) return null;
  const roles = (Array.isArray(o.roles) ? o.roles : []).filter(isRole);
  const rows: AttentionRow[] = [];
  for (const r of Array.isArray(o.rows) ? o.rows : []) {
    const row = obj(r);
    const href = ownPath(row?.href);
    const key = text(row?.key, 60);
    const count = int(row?.count);
    if (!row || !href || !key || count <= 0) continue;
    rows.push({
      key,
      one: text(row.one) || "thing waiting",
      many: text(row.many) || "things waiting",
      roles: (Array.isArray(row.roles) ? row.roles : []).filter(isRole),
      count,
      oldestDays: int(row.oldest_days),
      urgent: row.urgent === true,
      href,
    });
  }
  const coming: Coming[] = [];
  for (const c of Array.isArray(o.coming) ? o.coming : []) {
    const item = obj(c);
    const label = text(item?.label, 120);
    const on = text(item?.on, 10);
    if (item && label && /^\d{4}-\d{2}-\d{2}$/.test(on)) coming.push({ label, on, href: ownPath(item.href) });
  }
  const n = obj(o.numbers);
  const notices = obj(o.notices);
  return {
    roles,
    rows,
    coming: coming.slice(0, 3),
    numbers: n ? { placed: int(n.placed), applicationsMonth: int(n.applications_month), certified: int(n.certified), tribesOpen: int(n.tribes_open) } : null,
    notices: {
      off: int(notices?.off),
      empty: (Array.isArray(notices?.empty) ? notices.empty : []).map((e) => text(obj(e)?.group, 30)).filter(Boolean),
      faults: int(notices?.faults),
    },
  };
}

// ---------------------------------------------------------------------------
// One person, several hats
// ---------------------------------------------------------------------------

/** The roles that have a Today of their own, in the order they are listed on a row. */
export const HATS: readonly Role[] = ["admin", "pastor", "director", "data_lead"];

/** The hats a person wears. The filter above the list is only offered when there is more than one. */
export const hatsOf = (roles: readonly Role[]): Role[] => HATS.filter((r) => roles.includes(r));

export type Hat = Role | "all";

/** The rows for one hat, or all of them. A row that belongs to two of the person's roles shows under either. The order is the database's: most urgent first, then the oldest. */
export function rowsFor(rows: readonly AttentionRow[], hat: Hat): AttentionRow[] {
  return hat === "all" ? [...rows] : rows.filter((r) => r.roles.includes(hat));
}

/** Reads a remembered choice back: only a hat the person still wears counts, so a role taken away does not leave an empty page behind. */
export const rememberedHat = (value: unknown, roles: readonly Role[]): Hat => (typeof value === "string" && isRole(value) && hatsOf(roles).includes(value) ? value : "all");

/** Counts by page address, for the numbers beside the menu. Work that belongs to a page outside Admin (the review list) is not counted there. */
export function countsByHref(rows: readonly AttentionRow[]): Record<string, number> {
  const known = new Set(PAGES.map((p) => p.href));
  const out: Record<string, number> = {};
  for (const r of rows) if (known.has(r.href)) out[r.href] = (out[r.href] ?? 0) + r.count;
  return out;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** Rows whose "one" is a whole sentence, not a thing to count. */
const SENTENCE = new Set(["reporting_copy"]);

/** "3 applications waiting for a decision", or "The reporting copy has not refreshed". */
export function rowText(row: Pick<AttentionRow, "key" | "one" | "many" | "count">): string {
  if (SENTENCE.has(row.key)) return `The ${row.many}`;
  return `${row.count} ${row.count === 1 ? row.one : row.many}`;
}

/** "Oldest: 4 days". Nothing when it is today's. */
export function ageText(days: number): string {
  if (days <= 0) return "";
  return `Oldest: ${days} ${days === 1 ? "day" : "days"}`;
}

export const hatLabel = (role: Role): string => ROLE_LABELS[role];

/** The kinds of notice, as a person says them: "No one receives pastor notices". */
const GROUP_NAME: Record<string, string> = {
  pastors: "pastor", directors: "director", admin: "admin", coaches: "coach", care: "care team", leaders: "leader", champions: "community champion", data_lead: "data lead",
};

export type Warning = { text: string; href: string; tone: "warn" | "info" };

/** What to tell an admin or director about the notices themselves: switched off, nobody to receive them, or ones that could not be queued. */
export function noticeWarnings(att: Pick<Attention, "notices">): Warning[] {
  const out: Warning[] = [];
  const { off, empty, faults } = att.notices;
  if (off > 0) {
    out.push({
      text: off >= 8 ? "Team notices are switched off. Nobody is emailed until you turn a group on." : `${off} ${off === 1 ? "group of team notices is" : "groups of team notices are"} switched off.`,
      href: "/admin/notifications",
      tone: "info",
    });
  }
  for (const g of empty) out.push({ text: `No one receives ${GROUP_NAME[g] ?? g} notices in this centre.`, href: "/admin/people", tone: "warn" });
  if (faults > 0) out.push({ text: `${faults} ${faults === 1 ? "notice" : "notices"} could not be queued this week.`, href: "/admin/notifications", tone: "warn" });
  return out;
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

export type Shortcut = { href: string; label: string };

/**
 * The pages each role opens most. Each is a page that role may open (tests/unit/admin-nav.test.ts checks the page itself). Pages that
 * live in other areas, such as the review list, are the work of the role, so they are here.
 */
export const SHORTCUTS: Readonly<Partial<Record<Role, readonly Shortcut[]>>> = {
  admin: [
    { href: "/admin/people", label: "People and roles" },
    { href: "/admin/messages", label: "Message log" },
    { href: "/admin/privacy", label: "Data requests" },
    { href: "/admin/announcements", label: "Announcements" },
  ],
  pastor: [
    { href: "/review", label: "Applications to decide" },
    { href: "/review/cards", label: "Tribe Cards" },
    { href: "/review/interviews", label: "Interviews" },
    { href: "/review/templates", label: "Ready-made cards" },
  ],
  director: [
    { href: "/review/interviews", label: "Interviews" },
    { href: "/admin/leader-supply", label: "Leaders needed" },
    { href: "/admin/seasons", label: "Seasons" },
    { href: "/admin/people", label: "People and roles" },
  ],
  data_lead: [
    { href: "/admin/messages", label: "Message log" },
    { href: "/admin/system", label: "Sending and email" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/reports", label: "Reports" },
  ],
};

/**
 * Up to six shortcuts from every role the person holds, taken in turn so that no role crowds out another, each page once. An admin who
 * is also a pastor gets three of each.
 */
export function shortcutsFor(roles: readonly Role[], max = 6): Shortcut[] {
  const lists = hatsOf(roles).map((r) => SHORTCUTS[r] ?? []);
  const out: Shortcut[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < max; i++) {
    let any = false;
    for (const list of lists) {
      const item = list[i];
      if (!item) continue;
      any = true;
      if (!seen.has(item.href) && out.length < max) {
        seen.add(item.href);
        out.push(item);
      }
    }
    if (!any) break;
  }
  return out;
}

/** The figures row links to the Dashboard only for those who may open it. */
export const canOpenDashboard = (roles: readonly Role[]) => hasAnyRole(roles, DASHBOARD_ROLES);
