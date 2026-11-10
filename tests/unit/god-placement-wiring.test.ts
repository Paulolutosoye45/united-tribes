import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The owner's Placement page once passed an empty list of requests and no counts to the screen that shows what Admin has asked and placed, so a request
// from an admin waited for 7 days without the owner seeing it. These checks read the source so that cannot come back unnoticed: the page must load both
// and hand them on, and the console must show the count where the owner will see it.

const read = (file: string) => readFileSync(join(__dirname, "../..", file), "utf8");
const page = read("src/app/(app)/god/placement/page.tsx");
const home = read("src/components/god/PlacementHome.tsx");
const layout = read("src/app/(app)/god/layout.tsx");
const nav = read("src/components/god/GodNav.tsx");
const bar = read("src/components/god/OwnerBar.tsx");
const overview = read("src/app/(app)/god/page.tsx");

describe("the owner sees the requests from Admin", () => {
  it("loads the requests and the by-person counts on the Placement page, and never hands the screen an empty list", () => {
    expect(page).toContain("loadRequests(supabase)");
    expect(page).toContain("loadOfficeCounts(supabase)");
    expect(page).toMatch(/requests=\{requests\}/);
    expect(page).toMatch(/counts=\{counts\}/);
    expect(page).not.toMatch(/requests=\{\[\]\}/);
    expect(page).not.toMatch(/counts=\{null\}/);
  });

  it("puts the section first while a request is waiting, and in its usual place otherwise, never twice", () => {
    expect(home).toContain('const waiting = requests.some((r) => r.status === "open")');
    expect(home).toMatch(/\{waiting \? <Office counts=\{counts\} requests=\{requests\} \/> : null\}/);
    expect(home).toMatch(/\{waiting \? null : <Office counts=\{counts\} requests=\{requests\} \/>\}/);
    expect(home.match(/<Office counts=/g)).toHaveLength(2);
  });

  it("shows how many are waiting on the Placement tab, on the Overview and in a banner, from one count", () => {
    expect(layout).toContain("getRequestsWaiting()");
    expect(layout).toMatch(/<OwnerBar [^>]*requestsWaiting=\{requestsWaiting\}/);
    expect(bar).toMatch(/<GodNav requestsWaiting=\{requestsWaiting\} \/>/);
    expect(nav).toContain('tab.href === "/god/placement" && requestsWaiting > 0');
    expect(nav).toContain('data-testid="placement-waiting-count"');
    expect(overview).toContain("getRequestsWaiting()");
    expect(overview).toContain('data-testid="requests-waiting-banner"');
    expect(overview).toContain('label="Waiting for you"');
  });
});
