import { describe, expect, it } from "vitest";
import {
  CONTENT_ROLES,
  DASHBOARD_ROLES,
  DATA_ROLES,
  GROWTH_ROLES,
  MODEL_ROLES,
  MULTIPLY_ROLES,
  OFFICE_ROLES,
  PROGRAMME_ROLES,
  SWAP_ROLES,
  TEEN_ROLES,
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

  it("shows the Admin page to the office, and to nobody else", () => {
    expect(navFor(["member"]).map((n) => n.href)).toEqual(["/home", "/tribe", "/lead"]);
    expect(navFor(["member", "director"]).map((n) => n.href)).toEqual(["/home", "/tribe", "/lead", "/review", "/dashboard", "/reports", "/admin"]);
    for (const role of OFFICE_ROLES) expect(navFor(["member", role]).map((n) => n.href), role).toContain("/admin");
    for (const role of ["leader", "assistant_leader", "coach", "community_champion", "care_lead"] as Role[]) {
      expect(navFor(["member", role]).map((n) => n.href), role).not.toContain("/admin");
    }
    expect(hasAnyRole(["member"], ["admin"])).toBe(false);
  });

  it("keeps each change to the roles the database allows it to", () => {
    expect([...PROGRAMME_ROLES].sort()).toEqual(["admin", "director"]);
    expect([...CONTENT_ROLES].sort()).toEqual(["admin", "director", "pastor"]);
    expect([...DATA_ROLES].sort()).toEqual(["admin", "data_lead", "director"]);
    for (const list of [PROGRAMME_ROLES, CONTENT_ROLES, DATA_ROLES]) for (const role of list) expect(OFFICE_ROLES).toContain(role);
  });

  it("gives each role the numbers it is allowed to read", () => {
    const hrefs = (roles: Role[]) => navFor(roles).map((n) => n.href);
    expect(hrefs(["member", "coach"])).toContain("/dashboard");
    expect(hrefs(["member", "pastor"])).toContain("/dashboard");
    expect(hrefs(["member", "data_lead"])).toEqual(["/home", "/tribe", "/lead", "/dashboard", "/reports", "/admin"]);
    // the care lead has the queue, not the dashboard; a leader or member has neither
    expect(hrefs(["member", "care_lead"])).toEqual(["/home", "/tribe", "/lead", "/care", "/review/rhythm", "/growth"]);
    // coaches and assistants are given care tasks, so they find them in the menu; a plain leader does not
    expect(hrefs(["member", "assistant_leader"])).toContain("/care");
    expect(hrefs(["member", "coach"])).toContain("/care");
    expect(hrefs(["member", "leader"])).not.toContain("/care");
    expect(hrefs(["member", "leader"])).not.toContain("/dashboard");
    expect(hasAnyRole(["coach"], DASHBOARD_ROLES)).toBe(true);
    expect(hasAnyRole(["care_lead", "leader", "member"], DASHBOARD_ROLES)).toBe(false);
  });

  it("keeps the growth tools to the people the database lets use them", () => {
    const hrefs = (roles: Role[]) => navFor(roles).map((n) => n.href);
    // the office reaches the growth tools from the Admin page, so the menu stays short for them
    for (const role of OFFICE_ROLES) expect(hrefs(["member", role]), role).not.toContain("/growth");
    for (const role of ["coach", "care_lead"] as Role[]) expect(hrefs(["member", role]), role).toContain("/growth");
    for (const role of ["member", "leader", "assistant_leader", "community_champion"] as Role[]) expect(hrefs([role]), role).not.toContain("/growth");

    // who may open each tool: the same lists as the database functions
    expect([...SWAP_ROLES].sort()).toEqual(["admin", "care_lead", "coach", "director"]);
    expect([...MODEL_ROLES].sort()).toEqual(["admin", "data_lead", "director", "pastor"]);
    expect([...MULTIPLY_ROLES].sort()).toEqual(["admin", "coach", "director", "pastor"]);
    expect([...TEEN_ROLES].sort()).toEqual(["admin", "care_lead", "director", "pastor"]);
    // anyone who has a tool can open the hub that lists it, and no one else can
    for (const list of [SWAP_ROLES, MODEL_ROLES, MULTIPLY_ROLES, TEEN_ROLES]) for (const role of list) expect(GROWTH_ROLES).toContain(role);
    expect(GROWTH_ROLES).not.toContain("member");
    expect(GROWTH_ROLES).not.toContain("community_champion");
  });
});
