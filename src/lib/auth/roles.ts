/**
 * Roles, what each can see, and who can grant what. The database enforces the
 * same rules; this file decides what the interface offers.
 */
export const ROLES = [
  "member",
  "leader",
  "assistant_leader",
  "coach",
  "community_champion",
  "care_lead",
  "data_lead",
  "director",
  "pastor",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  member: "Member",
  leader: "Tribe leader",
  assistant_leader: "Assistant leader",
  coach: "Coach",
  community_champion: "Community champion",
  care_lead: "Care lead",
  data_lead: "Data lead",
  director: "Director",
  pastor: "Pastor",
  admin: "Admin",
};

/** Roles that carry oversight. Only an admin can grant or remove them. */
export const OVERSIGHT_ROLES: readonly Role[] = ["admin", "director", "pastor"];

/** Higher in the list means more responsibility; used for the badge shown. */
const PRECEDENCE: readonly Role[] = [
  "admin",
  "pastor",
  "director",
  "data_lead",
  "care_lead",
  "coach",
  "community_champion",
  "leader",
  "assistant_leader",
  "member",
];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function parseRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRole);
}

export function hasAnyRole(have: readonly Role[], want: readonly Role[]): boolean {
  return want.some((role) => have.includes(role));
}

export function primaryRole(roles: readonly Role[]): Role {
  return PRECEDENCE.find((role) => roles.includes(role)) ?? "member";
}

/** Who reads and scores leader applications. Only a pastor decides. */
export const REVIEW_ROLES: readonly Role[] = ["pastor", "director", "coach"];

/** Who can open the weekly report. The database decides how much each sees: a coach sees only their own tribes. */
export const RHYTHM_ROLES: readonly Role[] = ["pastor", "director", "coach", "care_lead", "data_lead", "admin"];

/** Who can open the dashboard. The database decides how much each sees: a coach sees only their own tribes. */
export const DASHBOARD_ROLES: readonly Role[] = ["admin", "director", "pastor", "data_lead", "coach"];

/** Who opens a community page: its champions and the office. The database decides which communities each may see. */
export const COMMUNITY_ROLES: readonly Role[] = ["community_champion", "admin", "director", "pastor", "data_lead"];

/** Who reads reports. A champion sees only their own community's; the office sees them all and can make one. */
export const REPORT_ROLES: readonly Role[] = ["community_champion", "admin", "director", "pastor", "data_lead"];

/** Who sees tribe-change requests. The database decides which: a coach sees only their own tribes. */
export const SWAP_ROLES: readonly Role[] = ["admin", "director", "care_lead", "coach"];

/** Who reads the matching versions. Only the admin and directors change them; a pastor cannot see what would be learned. */
export const MODEL_ROLES: readonly Role[] = ["admin", "director", "pastor", "data_lead"];

/** Who plans what happens to each tribe next season. A coach plans only their own tribes. */
export const MULTIPLY_ROLES: readonly Role[] = ["admin", "director", "pastor", "coach"];

/** The Care Team's view of young people and their parents or guardians. */
export const TEEN_ROLES: readonly Role[] = ["admin", "director", "pastor", "care_lead"];

/** Everyone who has at least one of the growth tools: tribe changes, planning, the matching model, teens. */
export const GROWTH_ROLES: readonly Role[] = [...new Set<Role>([...SWAP_ROLES, ...MODEL_ROLES, ...MULTIPLY_ROLES, ...TEEN_ROLES])];

/** The office: opens the Admin hub. What each of them may change is decided screen by screen, and again by the database. */
export const OFFICE_ROLES: readonly Role[] = ["admin", "director", "pastor", "data_lead"];

/** Creates and moves seasons; changes the catalogue; appoints community champions. */
export const PROGRAMME_ROLES: readonly Role[] = ["admin", "director"];

/** Edits the weekly guides and the church's own words. The guides are the pastorate's to approve. */
export const CONTENT_ROLES: readonly Role[] = ["admin", "director", "pastor"];

/** Answers members who ask for their account to be deleted. The database refuses anyone else, and refuses an erasure that would leave the church without an admin. */
export const PRIVACY_ROLES: readonly Role[] = ["admin", "director"];

/** Changes the targets, reads the message log and keeps the reporting copy. */
export const DATA_ROLES: readonly Role[] = ["admin", "director", "data_lead"];

/** Admins and directors run the programme and manage invitations. */
export function canManageRoles(roles: readonly Role[]): boolean {
  return hasAnyRole(roles, ["admin", "director"]);
}

/** The roles this person may invite someone to. */
export function grantableRoles(roles: readonly Role[]): Role[] {
  if (roles.includes("admin")) return ROLES.filter((r) => r !== "member");
  if (roles.includes("director")) {
    return ROLES.filter((r) => r !== "member" && !OVERSIGHT_ROLES.includes(r));
  }
  return [];
}

export type NavItem = {
  href: string;
  label: string;
  /** A shorter label for the phone dock and the top bar, where room is tight. */
  short?: string;
  icon: "home" | "join" | "lead" | "review" | "admin" | "chart" | "care" | "eye";
  /** Visible to anyone holding at least one of these roles. Omit for everyone. */
  roles?: readonly Role[];
};

/** Who is given care tasks, and so finds them in the menu. Leaders reach theirs from the weekly page. */
export const CARE_ROLES: readonly Role[] = ["care_lead", "coach", "assistant_leader"];

/** The menu. "My tribe" is where a member finds, chooses and joins a tribe; the form itself lives at /join. */
export const NAV: readonly NavItem[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/tribe", label: "My tribe", short: "My tribe", icon: "join" },
  { href: "/lead", label: "Lead a tribe", short: "Lead", icon: "lead" },
  { href: "/review", label: "Review leaders", short: "Review", icon: "review", roles: REVIEW_ROLES },
  { href: "/dashboard", label: "Dashboard", short: "Results", icon: "chart", roles: DASHBOARD_ROLES },
  { href: "/community", label: "My community", short: "Community", icon: "chart", roles: ["community_champion"] },
  { href: "/reports", label: "Reports", short: "Reports", icon: "review", roles: REPORT_ROLES },
  { href: "/care", label: "Care tasks", short: "Care", icon: "care", roles: CARE_ROLES },
  // The care lead does not score applications and has no dashboard, so lands on the weekly report instead
  { href: "/review/rhythm", label: "Weekly report", short: "Weekly", icon: "review", roles: ["care_lead"] },
  // The tools that help the programme learn and grow. The office reaches them from the Admin page, to keep the menu short.
  { href: "/growth", label: "Growth", short: "Growth", icon: "chart", roles: ["coach", "care_lead"] },
  { href: "/admin", label: "Admin", icon: "admin", roles: OFFICE_ROLES },
];

/**
 * The platform owner holds every role, so the ordinary menu would be a dozen items wide. Their menu is the console plus
 * the four places they reach most; every other area is one tap from the console's "Open any area".
 */
export const OWNER_NAV: readonly NavItem[] = [
  { href: "/god", label: "Console", icon: "eye" },
  { href: "/admin", label: "Admin", icon: "admin" },
  { href: "/dashboard", label: "Dashboard", short: "Results", icon: "chart" },
  { href: "/reports", label: "Reports", icon: "review" },
  { href: "/review", label: "Review", icon: "review" },
  { href: "/care", label: "Care tasks", short: "Care", icon: "care" },
];

export function navFor(roles: readonly Role[], owner = false): NavItem[] {
  if (owner) return [...OWNER_NAV];
  return NAV.filter((item) => !item.roles || hasAnyRole(roles, item.roles));
}

/** Every area of the platform, for the owner's "Open any area". Labels say what the area is for. */
export const EVERY_AREA: readonly { href: string; label: string; about: string }[] = [
  { href: "/admin", label: "Admin", about: "Seasons, people and roles, settings, messages, privacy requests" },
  { href: "/dashboard", label: "Dashboard", about: "How the season is going, in numbers" },
  { href: "/reports", label: "Reports", about: "The weekly and community reports" },
  { href: "/review", label: "Review leaders", about: "Applications, interviews and tribe cards" },
  { href: "/review/rhythm", label: "Weekly report", about: "The week across every tribe" },
  { href: "/care", label: "Care tasks", about: "Who needs a call, and who has it" },
  { href: "/growth", label: "Growth", about: "What the programme is learning" },
  { href: "/community", label: "Communities", about: "A community champion's page" },
  { href: "/lead", label: "Lead a tribe", about: "The leader's side" },
  { href: "/tribe", label: "My tribe", about: "The member's side" },
  { href: "/admin/people", label: "People and roles", about: "Invite, promote, remove" },
  { href: "/admin/privacy", label: "Data requests", about: "Who asked to be deleted" },
  { href: "/admin/system", label: "Sending and reporting", about: "The message service and the reporting copy" },
  { href: "/admin/settings", label: "Church settings", about: "The church's own words and switches" },
];
