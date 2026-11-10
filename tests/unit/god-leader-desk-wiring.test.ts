import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_KEYS } from "@/lib/features/types";

// The Leader Desk, Phase 1, only shows things. These checks read the source so that stays true: the page is the owner's alone, each action checks the owner and
// the shape of what it was given before the database is asked, only the desk's own functions are called, no number is ever put in a list or an address, and
// nothing in the desk can send a message.

const ROOT = join(__dirname, "../..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const page = read("src/app/(app)/god/leader-desk/page.tsx");
const actions = read("src/app/(app)/god/leader-desk/actions.ts");
const loaders = read("src/lib/god/desk-server.ts");
const nav = read("src/components/god/GodNav.tsx");
const components = readdirSync(join(ROOT, "src/components/god")).filter((f) => f.startsWith("Desk") && f.endsWith(".tsx"));
const all = [page, actions, loaders, ...components.map((f) => read(`src/components/god/${f}`)), read("src/lib/god/desk.ts")].join("\n");

const FUNCTIONS = [
  "desk_overview", "desk_waiting", "desk_leaders", "desk_groups_list", "desk_clusters", "desk_phone_reveal", "desk_group_save", "desk_group_archive",
  "desk_group_member_add", "desk_group_member_remove", "desk_group_suggest",
  // Phase 2a: the screens only read these three; the five that act live in send-actions.ts (see god-leader-desk-send-wiring.test.ts)
  "desk_send_state", "desk_proposals_list", "desk_group_interest",
  // Phase 2b: the screens only read these two; the five that act live in offer-actions.ts (see god-leader-desk-offers-wiring.test.ts)
  "desk_group_leader", "desk_offers_list",
  // Phase 2b-2: the screens only read this one; the three that act live in open-actions.ts (see god-leader-desk-open-wiring.test.ts)
  "desk_pipeline",
];

describe("the Leader Desk page", () => {
  it("lives under the owner's console, with its own tab", () => {
    expect(existsSync(join(ROOT, "src/app/(app)/god/leader-desk/page.tsx"))).toBe(true);
    expect(nav).toContain('{ href: "/god/leader-desk", label: "Leader Desk" }');
  });

  it("reads the overview first and shows a plain 'switched off' line, with a way to Features, when the database refuses", () => {
    expect(page).toContain("loadDeskOverview(supabase)");
    expect(page).toMatch(/if \(!overview\)/);
    expect(page).toContain('data-testid="desk-off"');
    expect(page).toContain('href="/god/features"');
  });

  it("loads only what the tab needs", () => {
    expect(page).toContain("loadDeskWaiting(supabase, chip");
    expect(page).toContain("loadDeskLeaders(supabase, pool");
    expect(page).toContain("loadDeskGroups(supabase)");
    expect(page).toContain("loadDeskClusters(supabase)");
  });

  it("is a Switchboard function the owner can see", () => {
    expect(FEATURE_KEYS).toContain("leader_desk");
  });
});

describe("the actions", () => {
  const names = [...actions.matchAll(/export async function (\w+Action)\(/g)].map((m) => m[1]);

  it("each refuses anyone but the unlocked owner before the database is asked, and each checks every id", () => {
    expect(names.sort()).toEqual(["addMemberAction", "archiveGroupAction", "removeMemberAction", "revealNumberAction", "saveGroupAction", "suggestMembersAction"]);
    for (const n of names) {
      const body = actions.slice(actions.indexOf(`export async function ${n}(`)).split(/\nexport async function /)[0];
      expect(body, n).toMatch(/if \(!\(await ownerOnly\(\)\)\) return NOT_AVAILABLE;/);
      expect(body, n).toContain("isUuid(");
    }
    expect(actions).toContain('session?.god === "open"');
  });

  it("call only the desk's own functions", () => {
    const called = [...actions.matchAll(/run\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    const loaded = [...loaders.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1]);
    for (const f of [...called, ...loaded]) expect(FUNCTIONS, f).toContain(f);
    expect(new Set(called).size).toBe(6);
  });

  it("send the number to nothing but the screen that asked: it is not revalidated, stored or logged", () => {
    const body = actions.slice(actions.indexOf("export async function revealNumberAction"), actions.indexOf("export type GroupInput"));
    expect(body).toContain('run("desk_phone_reveal", { p_person: person }, [])');
    expect(body).not.toMatch(/console\.|cookies|headers|redirect/);
  });
});

describe("it only shows", () => {
  it("never calls anything that sends, seats, tells, places or writes to a member", () => {
    expect(all).not.toMatch(/\b(notify_person|queue_message|send_message|messages|placement_one_place|placement_one_move|placement_office|placement_run|choose_tribe|invite|god_appoint_leader|leader_appoint_core|desk_offer_complete|desk_offer_accept)\b/i);
    expect(all).not.toMatch(/\.from\("(messages|notice_items|tribe_members|tribes|member_profiles|people|person_roles)"\)\.(insert|update|upsert|delete)/);
  });

  it("only reads the three short lists a draft is made from, straight from the tables", () => {
    const from = [...loaders.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
    expect(from).toEqual(["communities", "season_goals", "tracks"]);
    expect(loaders).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("keeps a full number out of every list, address and attribute", () => {
    // The only place a number is shown in full is the reveal's own element, and the only address that holds one is the phone link it makes
    const reveal = read("src/components/god/DeskReveal.tsx");
    expect(reveal).toContain("href={`tel:${full}`}");
    for (const f of components.filter((c) => c !== "DeskReveal.tsx")) {
      const src = read(`src/components/god/${f}`);
      expect(src, f).not.toMatch(/tel:|whatsapp|wa\.me/i);
    }
    expect(reveal).toContain("setTimeout(() => setFull(null), 60_000)");
    expect(page + loaders).not.toMatch(/searchParams.*(phone|number)/);
    expect(all).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it("puts the Reveal beside every number the desk lists", () => {
    for (const f of ["DeskWaiting.tsx", "DeskLeaders.tsx", "DeskGroupCard.tsx"]) expect(read(`src/components/god/${f}`), f).toContain("<DeskReveal");
  });
});
