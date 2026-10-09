/**
 * Roles, what each can see, and who can grant what. The database enforces the
 * same rules; this file decides what the interface offers.
 */
export const ROLES = [
  "member",
  "leader",
  "assistant_leader",
  "coach",
  "tribe_champion",
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
  tribe_champion: "Tribe champion",
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
  "tribe_champion",
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

/** Who can open the weekly report. The database decides how much each sees: a coach sees only their own circles. */
export const RHYTHM_ROLES: readonly Role[] = ["pastor", "director", "coach", "care_lead", "data_lead", "admin"];

/** Who can open the dashboard. The database decides how much each sees: a coach sees only their own circles. */
export const DASHBOARD_ROLES: readonly Role[] = ["admin", "director", "pastor", "data_lead", "coach"];

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
  icon: "home" | "join" | "lead" | "review" | "admin" | "chart";
  /** Visible to anyone holding at least one of these roles. Omit for everyone. */
  roles?: readonly Role[];
};

/** The menu. "My circle" is where a member finds, chooses and joins a circle; the form itself lives at /join. */
export const NAV: readonly NavItem[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/circle", label: "My Tribe", short: "My Tribe", icon: "join" },
  { href: "/lead", label: "Lead a Tribe", short: "Lead", icon: "lead" },
  { href: "/review", label: "Review leaders", short: "Review", icon: "review", roles: REVIEW_ROLES },
  { href: "/dashboard", label: "Dashboard", short: "Results", icon: "chart", roles: DASHBOARD_ROLES },
  // The care lead does not score applications and has no dashboard, so lands on the weekly report instead
  { href: "/review/rhythm", label: "Weekly report", short: "Weekly", icon: "review", roles: ["care_lead"] },
  { href: "/admin", label: "Admin", icon: "admin", roles: ["admin", "director"] },
];

export function navFor(roles: readonly Role[]): NavItem[] {
  return NAV.filter((item) => !item.roles || hasAnyRole(roles, item.roles));
}
