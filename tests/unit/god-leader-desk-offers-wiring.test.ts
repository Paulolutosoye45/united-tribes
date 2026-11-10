import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Leader Desk's leader offers (Phase 2b-1) are reached by the owner's screens and by a member's private page, and nowhere else. These checks read the
// source so that stays true: every owner action checks the owner and the shape of what it was given before the database is asked, only the five owner
// functions are called, the website never appoints, emails, seats or places anyone itself, and the private page can only ask for its two worker functions,
// with a link it checked. The role is only ever granted by the database, in the one step a member's own yes goes through.

const ROOT = join(__dirname, "../..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const offerActions = read("src/app/(app)/god/leader-desk/offer-actions.ts");
const page = read("src/app/(app)/god/leader-desk/page.tsx");
const loaders = read("src/lib/god/desk-server.ts");
const publicActions = read("src/app/(public)/o/[token]/actions.ts");
const publicPage = read("src/app/(public)/o/[token]/page.tsx");
const proxy = read("src/proxy.ts");
const panel = read("src/components/god/DeskLeaderPanel.tsx");
const offersTab = read("src/components/god/DeskOffers.tsx");
const groupCard = read("src/components/god/DeskGroupCard.tsx");
const builder = read("src/components/academy/TribeBuilder.tsx");
const sql = read("supabase/migrations/20270118000100_desk_offers.sql");

const OWNER_FUNCTIONS = ["desk_offer_candidates", "desk_offer_send", "desk_offer_cancel", "desk_offers_pause", "desk_offer_review"];

describe("the owner's actions for leader offers", () => {
  const names = [...offerActions.matchAll(/export async function (\w+Action)\(/g)].map((m) => m[1]);
  const bodyOf = (n: string) => offerActions.slice(offerActions.indexOf(`export async function ${n}(`)).split(/\nexport async function /)[0];

  it("are exactly five, and each refuses anyone but the unlocked owner before the database is asked", () => {
    expect([...names].sort()).toEqual(["cancelOfferAction", "candidatesAction", "pauseBackupsAction", "reviewOfferAction", "sendOfferAction"]);
    for (const n of names) expect(bodyOf(n), n).toMatch(/if \(!\(await ownerOnly\(\)\)\) return NOT_AVAILABLE;/);
    expect(offerActions).toContain('session?.god === "open"');
  });

  it("check every id's shape, and the number of people and the true-or-false flags, before the database is asked", () => {
    for (const n of names) expect(bodyOf(n), n).toContain("isUuid(");
    const send = bodyOf("sendOfferAction");
    expect(send).toContain("Array.isArray(people)");
    expect(send).toMatch(/people\.length < 1 \|\| people\.length > 3/);
    expect(send).toContain("people.every(isUuid)");
    expect(bodyOf("cancelOfferAction")).toContain('typeof all !== "boolean"');
    expect(bodyOf("pauseBackupsAction")).toContain('typeof paused !== "boolean"');
    expect(bodyOf("reviewOfferAction")).toContain('typeof approve !== "boolean"');
  });

  it("call only the five owner functions", () => {
    const called = [...offerActions.matchAll(/run(?:<[^>]*>)?\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(called)).toEqual(new Set(OWNER_FUNCTIONS));
  });

  it("only ever revalidate the Desk's own page, and never redirect or read a cookie", () => {
    expect(offerActions).toContain('const PAGES = ["/god/leader-desk"]');
    expect(offerActions).not.toMatch(/revalidatePath|redirect|cookies|headers|console\./);
  });

  it("never reach for anything that appoints, sends, queues, seats or places", () => {
    expect(offerActions).not.toMatch(/\b(enqueue_message|notify_person|queue_message|send_message|placement_one_place|placement_one_move|placement_office|choose_tribe|god_appoint_leader|leader_appoint_core|desk_offer_complete|desk_offer_accept|desk_mail_send|worker_desk)\b/i);
    expect(offerActions).not.toMatch(/\.from\("/);
  });
});

describe("the screens", () => {
  const screens = [panel, offersTab, groupCard, page, loaders].join("\n");

  it("read a group's leader and every offer through two reads only, and put the offers in the Sending tab", () => {
    expect(loaders).toContain('rpc("desk_group_leader"');
    expect(loaders).toContain('rpc("desk_offers_list"');
    expect(page).toContain("loadDeskGroupLeaders(");
    expect(page).toContain("loadDeskOffers(");
    expect(page).toContain("<DeskOffers");
    expect(groupCard).toContain("<DeskLeaderPanel");
  });

  it("make the owner confirm before an offer is sent, and say in Rehearsal that nothing is sent", () => {
    expect(panel).toMatch(/rehearsal/i);
    expect(panel).toMatch(/confirmRehearsal/);
    expect(panel).toContain("O.confirm");
    expect(panel.indexOf("candidatesAction")).toBeLessThan(panel.indexOf("sendOfferAction"));
  });

  it("never name a function that appoints, sends, queues, seats or places, and the new screens never read a table directly", () => {
    expect(screens).not.toMatch(/\b(enqueue_message|notify_person|queue_message|placement_one_place|placement_one_move|placement_office|choose_tribe|god_appoint_leader|leader_appoint_core|desk_offer_complete|desk_offer_accept|desk_mail_send|worker_desk)\b/i);
    // The two new loaders call functions; the only tables the shared loaders read are the card's pick-lists, from before this phase
    expect([panel, offersTab].join("\n")).not.toMatch(/\.from\("/);
    const mine = loaders.slice(loaders.indexOf("loadDeskGroupLeaders"));
    expect(mine).not.toMatch(/\.from\("/);
  });

  it("show the reasons given for 'Not this season' as counts only, and no number to a screen that does not reveal it", () => {
    expect(offersTab).toContain("reasonsHelp");
    // The tab shows the totals the database counted; a row never carries a person's reasons, so none can be put beside a name
    expect(offersTab).toContain("page.reasons");
    expect(offersTab).not.toMatch(/\brows?\b[^\n]*reasons|\bo\.reasons\b|\br\.reasons\b/);
    expect(read("src/lib/god/desk-offers.ts")).not.toMatch(/\br\.reasons\b|reasons:\s*list\(/);
    expect(offersTab).not.toMatch(/phone|e164/i);
    expect(panel).toContain("<DeskReveal");
    const listFn = sql.slice(sql.search(/create function public\.desk_offers_list\(/i));
    const listBody = listFn.split(/\n\$\$;/)[0];
    expect(listBody).toContain("'reasons', jsonb_build_object(");
    // Each reason is counted across every offer; a row (the part after 'rows') names the person and the offer, and never the reasons
    expect(listBody).toMatch(/'busy', \(select count\(\*\)::integer from public\.desk_offers x where 'busy' = any \(x\.reasons\)\)/);
    expect(listBody.slice(listBody.indexOf("'rows'"))).not.toMatch(/reasons/);
    // A phone number reaches the list only masked
    expect(listBody).toContain("placed_desk_mask(");
  });

  it("are all among the Desk screens the Phase 1 guard scans", () => {
    const names = readdirSync(join(ROOT, "src/components/god")).filter((f) => f.startsWith("Desk"));
    expect(names).toContain("DeskLeaderPanel.tsx");
    expect(names).toContain("DeskOffers.tsx");
  });
});

describe("the member's private offer page", () => {
  it("answers only through its two worker functions, with the worker's own token added for it", () => {
    const called = [...(publicActions + publicPage).matchAll(/workerRpc\([^)]*\)\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(called)).toEqual(new Set(["worker_desk_offer_info", "worker_desk_offer_answer"]));
    expect(publicActions + publicPage).not.toMatch(/\.from\("|createClient|getSession|cookies\(\)\.set/);
  });

  it("checks the link is 64 hex characters and the answer is one of six before anything is saved", () => {
    expect(publicActions).toContain("[a-f0-9]{64}");
    expect(publicActions).toContain("isOfferAnswer(");
    expect(publicPage).toContain("[a-f0-9]{64}");
  });

  it("for a yes, asks for the age confirmation and both short answers before anything is sent", () => {
    const lead = publicActions.slice(publicActions.indexOf('if (answer === "lead")'), publicActions.indexOf('if (answer === "not_season")'));
    expect(lead).toContain('formData.get("age") === "on"');
    expect(lead).toMatch(/if \(!age\) redirect/);
    expect(lead).toMatch(/if \(!LEAD\.includes\(lead\)\) redirect/);
    expect(lead).toMatch(/if \(!RELATION\.includes\(relation\)\) redirect/);
    expect(publicActions).toContain('const LEAD = ["structure", "connection", "teaching", "doing"]');
    expect(publicActions).toContain('const RELATION = ["achieved", "pursuing"]');
  });

  it("sends reasons only for 'Not this season', only from the list, and at most five", () => {
    expect(publicActions).toMatch(/answer === "not_season"\) reasons = \[\.\.\.new Set\(formData\.getAll\("reason"\)\.map\(String\)\.filter\(isOfferReason\)\)\]\.slice\(0, 5\)/);
    expect(publicActions).toContain("p_reasons: reasons");
  });

  it("opens without signing in, because the link is the credential, and matches whole path segments only", () => {
    const list = /const PUBLIC_PREFIXES = \[([^\]]+)\]/.exec(proxy)?.[1] ?? "";
    expect(list).toContain('"/o"');
    expect(list).toContain('"/d"');
    expect(proxy).toContain("pathname === p || pathname.startsWith(`${p}/`)");
  });

  it("is not indexed, sends no referrer, and records nothing on opening: every answer is a button", () => {
    expect(publicPage).toMatch(/index:\s*false/);
    expect(publicPage).toContain('referrer: "no-referrer"');
    expect(publicPage).toContain("offerAnswerAction");
    expect(publicPage).toContain("worker_desk_offer_info");
    // Opening the page reads; it never calls the answering function itself
    expect(publicPage).not.toContain("worker_desk_offer_answer");
  });
});

describe("the one step that grants the leader role", () => {
  it("is shared: the owner's direct appointment and a member's own yes both go through leader_appoint_core", () => {
    expect(sql).toMatch(/create (?:or replace )?function public\.leader_appoint_core\(/i);
    const god = sql.slice(sql.search(/create (?:or replace )?function public\.god_appoint_leader\(/i));
    expect(god.split(/\n\$\$;/)[0]).toContain("leader_appoint_core(");
    const complete = sql.slice(sql.search(/create (?:or replace )?function public\.desk_offer_complete\(/i));
    expect(complete.split(/\n\$\$;/)[0]).toContain("leader_appoint_core(");
    // Nothing else in the migration grants the role
    expect(sql.match(/insert into public\.leader_appointments/gi)?.length ?? 0).toBe(1);
  });

  it("is not granted to the website's roles: the offer's own functions run only for the owner or the sending service", () => {
    const closed = [...sql.matchAll(/revoke all on function([\s\S]*?)from public, anon, authenticated;/gi)].map((m) => m[1]).join("\n");
    for (const fn of ["leader_appoint_core", "desk_offer_complete", "desk_offer_accept", "desk_offer_open", "desk_offer_advance", "desk_offer_tick", "desk_offer_gate", "desk_offer_link_mint"]) {
      expect(closed, fn).toContain(`public.${fn}(`);
    }
    // And none of them is granted to anyone afterwards
    for (const fn of ["leader_appoint_core", "desk_offer_complete", "desk_offer_accept", "desk_offer_tick"]) {
      expect(sql, fn).not.toMatch(new RegExp(`grant execute on function[^;]*public\\.${fn}\\(`, "i"));
    }
  });

  it("asks for a yes and a confirmed age of 21 or older, in the database, not only on the page", () => {
    const answer = sql.slice(sql.search(/create (?:or replace )?function public\.worker_desk_offer_answer\(/i));
    const body = answer.split(/\n\$\$;/)[0];
    // A yes without the age confirmation, or without both short answers, is refused before anything is saved
    expect(body).toMatch(/p_answer = 'lead' and \(coalesce\(p_age, false\) is not true or p_lead is null/);
    expect(body).toContain("age_confirmed_at = now()");
    // The gates (21 or older confirmed, a yes to serving, not already leading) are checked again at the moment of the yes, and again when an owner approves a review
    expect(body).toContain("desk_offer_gate(");
    expect(sql).toMatch(/--[^\n]*21 or older/);
  });
});

describe("the tribe card for a group the Desk formed", () => {
  it("locks the slot, the format, the area, the kind and the seats the group was formed for, and only lets the day and time move inside the slot", () => {
    expect(builder).toContain('fixed.has("slot")');
    expect(builder).toContain('fixed.has("mode")');
    expect(builder).toContain('fixed.has("zone")');
    expect(builder).toContain('fixed.has("kind")');
    expect(builder).toContain('fixed.has("capacity")');
    expect(builder).toMatch(/daysForSlot\(/);
    expect(builder).toMatch(/timesForSlot\(/);
  });

  it("are enforced by the database as well: save_tribe_card skips every field the card has fixed", () => {
    for (const k of ["slot", "mode", "zone", "kind", "capacity"]) expect(sql, k).toContain(`'${k}' = any (c.fixed)`);
  });
});
