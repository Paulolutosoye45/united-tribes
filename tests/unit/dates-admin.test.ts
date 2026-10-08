import { describe, expect, it } from "vitest";
import { adminErrorMessage } from "@/lib/admin/errors";
import { daysUntil, formatDate, formatLagosDay, formatLagosTime, formatShortDate, lagosDateKey, plural } from "@/lib/dates";

describe("dates", () => {
  it("counts whole days to a calendar date", () => {
    const now = new Date("2026-10-07T23:30:00Z");
    expect(daysUntil("2026-10-08", now)).toBe(1);
    expect(daysUntil("2026-10-07", now)).toBe(0);
    expect(daysUntil("2026-10-01", now)).toBe(-6);
    expect(daysUntil("2027-02-14", new Date("2026-10-07T00:00:00Z"))).toBe(130);
  });

  it("formats dates the same wherever the server runs", () => {
    expect(formatDate("2027-02-14")).toBe("14 February 2027");
    expect(formatDate("2027-05-08")).toBe("8 May 2027");
  });

  it("writes Lagos days and times by hand, so server and browser always agree", () => {
    // 09:00 UTC is 10:00 in Lagos (UTC+1, no daylight saving)
    expect(formatLagosDay("2026-10-12T09:00:00Z")).toBe("Mon 12 Oct");
    expect(formatLagosTime("2026-10-12T09:00:00Z")).toBe("10:00 am");
    expect(formatLagosTime("2026-10-12T15:05:00Z")).toBe("4:05 pm");
    expect(formatLagosTime("2026-10-12T11:00:00Z")).toBe("12:00 pm");
    expect(formatLagosTime("2026-10-12T23:30:00Z")).toBe("12:30 am");
    // 23:30 UTC is already the next day in Lagos
    expect(formatLagosDay("2026-10-12T23:30:00Z")).toBe("Tue 13 Oct");
    expect(lagosDateKey("2026-10-12T23:30:00Z")).toBe("2026-10-13");
    expect(lagosDateKey("2026-12-31T22:59:00Z")).toBe("2026-12-31");
    expect(lagosDateKey("2026-12-31T23:00:00Z")).toBe("2027-01-01");
    expect(formatShortDate("2026-09-08T03:00:00Z")).toBe("8 Sep 2026");
  });

  it("pluralises", () => {
    expect(plural(1, "day")).toBe("1 day");
    expect(plural(2, "day")).toBe("2 days");
    expect(plural(0, "person", "people")).toBe("0 people");
  });
});

describe("admin messages", () => {
  it("maps database codes to plain sentences", () => {
    expect(adminErrorMessage({ code: "42501" })).toMatch(/permission/);
    expect(adminErrorMessage({ code: "23514" })).toMatch(/last admin/);
    expect(adminErrorMessage({ code: "P0002" })).toMatch(/already changed/);
    expect(adminErrorMessage({ code: "XX000" })).toMatch(/Something went wrong/);
    expect(adminErrorMessage(null)).toMatch(/Something went wrong/);
  });
});
