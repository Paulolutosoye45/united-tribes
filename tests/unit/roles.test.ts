import { describe, expect, it } from "vitest";
import {
  DASHBOARD_ROLES,
  canManageRoles,
  grantableRoles,
  hasAnyRole,
  navFor,
  parseRoles,
  primaryRole,
  type Role,
} from "@/lib/auth/roles";

describe("roles", () => {
  it("ignores values that are not roles", () => {
    expect(parseRoles(["member", "wizard", 3, null, "leader"])).toEqual(["member", "leader"]);
    expect(parseRoles("member")).toEqual([]);
    expect(parseRoles(undefined)).toEqual([]);
  });

  it("shows the most senior role as the badge", () => {
    expect(primaryRole(["member"])).toBe("member");
    expect(primaryRole(["member", "leader", "coach"])).toBe("coach");
    expect(primaryRole(["member", "admin", "leader"])).toBe("admin");
    expect(primaryRole([])).toBe("member");
  });

  it("lets only admins and directors manage roles", () => {
    expect(canManageRoles(["admin"])).toBe(true);
    expect(canManageRoles(["director"])).toBe(true);
    expect(canManageRoles(["pastor", "data_lead", "leader", "member"])).toBe(false);
  });

  it("matches what the database allows an inviter to grant", () => {
    const admin = grantableRoles(["member", "admin"]);
    expect(admin).toContain("director");
    expect(admin).toContain("admin");
    expect(admin).not.toContain("member");

    const director = grantableRoles(["member", "director"]);
    expect(director).toContain("leader");
    for (const oversight of ["admin", "director", "pastor"] as Role[]) {
      expect(director).not.toContain(oversight);
    }

    expect(grantableRoles(["member", "leader"])).toEqual([]);
  });

  it("shows the Admin page only to people who can manage roles", () => {
    expect(navFor(["member"]).map((n) => n.href)).toEqual(["/home", "/circle", "/lead"]);
    expect(navFor(["member", "director"]).map((n) => n.href)).toEqual(["/home", "/circle", "/lead", "/review", "/dashboard", "/admin"]);
    expect(hasAnyRole(["member"], ["admin"])).toBe(false);
  });

  it("gives each role the numbers it is allowed to read", () => {
    const hrefs = (roles: Role[]) => navFor(roles).map((n) => n.href);
    expect(hrefs(["member", "coach"])).toContain("/dashboard");
    expect(hrefs(["member", "pastor"])).toContain("/dashboard");
    expect(hrefs(["member", "data_lead"])).toEqual(["/home", "/circle", "/lead", "/dashboard"]);
    // the care lead has the queue, not the dashboard; a leader or member has neither
    expect(hrefs(["member", "care_lead"])).toEqual(["/home", "/circle", "/lead", "/review/rhythm"]);
    expect(hrefs(["member", "leader"])).not.toContain("/dashboard");
    expect(hasAnyRole(["coach"], DASHBOARD_ROLES)).toBe(true);
    expect(hasAnyRole(["care_lead", "leader", "member"], DASHBOARD_ROLES)).toBe(false);
  });
});
