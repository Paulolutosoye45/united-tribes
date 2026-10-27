import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The tabs of the review panel. "Stage changes" is there only for a pastor or director, and only once My page or the Details check has been
// opened by the owner, so with both Off the panel looks exactly as it always did.

const state = vi.hoisted(() => ({ path: "/review", session: null as null | { roles: string[] }, summaries: {} as Record<string, string>, overviewCalls: 0 }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/features/server", () => ({
  loadFeaturesOverview: async () => {
    state.overviewCalls++;
    return { paused: false, log: [], features: Object.entries(state.summaries).map(([key, summary]) => ({ key, name: key, blurb: "", stage: 1, available: true, summary, depends: [] })) };
  },
}));

import { PanelTabs } from "@/components/leaders/PanelTabs";
import { ReviewTabs } from "@/components/leaders/ReviewTabs";

const labels = (html: string) => [...html.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
const current = (html: string) => [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
const render = (props: { stages?: boolean } = {}) => renderToStaticMarkup(createElement(PanelTabs, props));

beforeEach(() => {
  state.path = "/review";
  state.session = null;
  state.summaries = {};
  state.overviewCalls = 0;
});

describe("the panel's tabs", () => {
  it("are the six they always were, in the same order, with no Stage changes", () => {
    expect(labels(render())).toEqual(["Applications", "Interviews", "Academy", "Tribe Cards", "Ready-made cards", "Weekly report"]);
  });

  it("put Stage changes after Tribe Cards when asked, and leave the others where they were", () => {
    expect(labels(render({ stages: true }))).toEqual(["Applications", "Interviews", "Academy", "Tribe Cards", "Stage changes", "Ready-made cards", "Weekly report"]);
  });

  it("mark the one being looked at, and treat an application opened from the queue as the first tab", () => {
    state.path = "/review/stages";
    expect(current(render({ stages: true }))).toEqual(["Stage changes"]);
    state.path = "/review/cards/abc";
    expect(current(render({ stages: true }))).toEqual(["Tribe Cards"]);
    state.path = "/review/0f1e2d3c";
    expect(current(render())).toEqual(["Applications"]);
    // with the tab not shown, an address under it is still the first tab rather than none
    state.path = "/review/stages";
    expect(current(render())).toEqual(["Applications"]);
  });

  it("link each tab to its own page", () => {
    const html = render({ stages: true });
    for (const href of ["/review", "/review/interviews", "/review/academy", "/review/cards", "/review/stages", "/review/templates", "/review/rhythm"]) expect(html).toContain(`href="${href}"`);
  });
});

describe("whether the tab appears", () => {
  const stagesOf = async () => ((await ReviewTabs()) as { props: { stages: boolean } }).props.stages;

  it("is never asked of anyone but a pastor or a director, so nothing else is read for them", async () => {
    state.summaries = { my_page: "on" };
    for (const roles of [[], ["admin"], ["leader"], ["coach", "admin"]]) {
      state.session = { roles };
      expect(await stagesOf(), roles.join()).toBe(false);
    }
    state.session = null;
    expect(await stagesOf()).toBe(false);
    expect(state.overviewCalls).toBe(0);
  });

  it("stays away for a pastor or a director while both functions are Off", async () => {
    state.summaries = { my_page: "off", details_check: "off", hold_card: "optional" };
    for (const role of ["pastor", "director"]) {
      state.session = { roles: [role] };
      expect(await stagesOf(), role).toBe(false);
    }
    expect(state.overviewCalls).toBe(2);
  });

  it("appears once My page or the Details check is open, in rehearsal or for some people only", async () => {
    state.session = { roles: ["pastor"] };
    for (const [key, summary] of [["my_page", "rehearsal"], ["details_check", "on"], ["my_page", "limited"]] as const) {
      state.summaries = { [key]: summary };
      expect(await stagesOf(), `${key} ${summary}`).toBe(true);
    }
    // the hold on its own, which is the one that decides nothing without the others, is no reason to show it
    state.summaries = { hold_card: "required" };
    expect(await stagesOf()).toBe(false);
  });
});
