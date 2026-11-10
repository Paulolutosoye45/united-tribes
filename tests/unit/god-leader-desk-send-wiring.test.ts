import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Leader Desk's email (Phase 2a) is reached by the owner's screens and by a member's private page, and nowhere else. These checks read the source so that
// stays true: every owner action checks the owner and the shape of what it was given before the database is asked, only the five owner functions are called,
// the website never sends, queues, seats or places anyone itself, and the private page can only ask for the three worker functions, with a token it checked.

const ROOT = join(__dirname, "../..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const sendActions = read("src/app/(app)/god/leader-desk/send-actions.ts");
const page = read("src/app/(app)/god/leader-desk/page.tsx");
const loaders = read("src/lib/god/desk-server.ts");
const publicActions = read("src/app/(public)/d/[token]/actions.ts");
const publicPage = read("src/app/(public)/d/[token]/page.tsx");
const cron = read("src/app/api/cron/tick/route.ts");
const desk = read("src/lib/god/desk.ts");
const NEW = ["DeskSending", "DeskSettings", "DeskWithdraw", "DeskPropose", "DeskCheckInterest"].map((n) => read(`src/components/god/${n}.tsx`));

const OWNER_FUNCTIONS = ["desk_propose_preview", "desk_propose_tribe", "desk_interest_check", "desk_proposal_cancel", "desk_settings_set"];

describe("the owner's actions for the Desk's email", () => {
  const names = [...sendActions.matchAll(/export async function (\w+Action)\(/g)].map((m) => m[1]);

  it("are exactly five, and each refuses anyone but the unlocked owner before the database is asked", () => {
    expect([...names].sort()).toEqual(["cancelProposalAction", "interestCheckAction", "previewProposalAction", "saveSettingsAction", "sendProposalAction"]);
    for (const n of names) {
      const body = sendActions.slice(sendActions.indexOf(`export async function ${n}(`)).split(/\nexport (?:async function|type) /)[0];
      expect(body, n).toMatch(/if \(!\(await ownerOnly\(\)\)\) return NOT_AVAILABLE;/);
    }
    expect(sendActions).toContain('session?.god === "open"');
  });

  it("check every id's shape, and the settings' numbers, before the database is asked", () => {
    for (const n of ["previewProposalAction", "sendProposalAction", "interestCheckAction", "cancelProposalAction"]) {
      const body = sendActions.slice(sendActions.indexOf(`export async function ${n}(`)).split(/\nexport (?:async function|type) /)[0];
      expect(body, n).toContain("isUuid(");
    }
    const settings = sendActions.slice(sendActions.indexOf("export async function saveSettingsAction"));
    expect(settings).toContain("Number.isInteger");
  });

  it("call only the five owner functions", () => {
    const called = [...sendActions.matchAll(/run(?:<[^>]*>)?\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(called)).toEqual(new Set(OWNER_FUNCTIONS));
  });

  it("only ever revalidate the Desk's own page", () => {
    expect(sendActions).toContain('const PAGES = ["/god/leader-desk"]');
    expect(sendActions).not.toMatch(/revalidatePath|redirect|cookies|headers|console\./);
  });
});

describe("the screens", () => {
  it("add a Sending tab that loads its own two reads and nothing the other tabs load", () => {
    expect(desk).toContain('{ key: "sending", label: "Sending" }');
    expect(page).toContain("loadDeskSendState(supabase)");
    expect(page).toContain("loadDeskProposals(supabase, PAGE_SIZE");
    expect(page).toContain("loadDeskInterest(supabase");
    expect(loaders).toContain('rpc("desk_send_state")');
    expect(loaders).toContain('rpc("desk_proposals_list"');
    expect(loaders).toContain('rpc("desk_group_interest"');
  });

  it("never name a number-bearing field, a message, or a function that sends, seats or places", () => {
    const text = NEW.join("\n") + sendActions;
    expect(text).not.toMatch(/\b(enqueue_message|notify_person|queue_message|send_message|placement_one_place|placement_one_move|placement_office|placement_run|choose_tribe|appoint|god_appoint_leader|desk_mail_send|worker_desk)\b/i);
    expect(text).not.toMatch(/\.from\("/);
    expect(text).not.toMatch(/phone|e164|whatsapp/i);
  });

  it("make the owner tap twice, and say in Rehearsal that nothing is sent", () => {
    const propose = read("src/components/god/DeskPropose.tsx");
    const check = read("src/components/god/DeskCheckInterest.tsx");
    for (const c of [propose, check]) {
      expect(c).toMatch(/rehearsal/i);
      expect(c).toMatch(/confirmRehearsal/);
    }
    expect(propose).toContain("previewProposalAction");
    expect(propose.indexOf("previewProposalAction")).toBeLessThan(propose.indexOf("sendProposalAction"));
    expect(read("src/components/god/DeskGroupCard.tsx")).toContain("<DeskCheckInterest");
    expect(read("src/components/god/DeskWaiting.tsx")).toContain("<DeskPropose");
  });

  it("every Desk screen is one the existing guard scans, so the Phase 1 rules still cover it", () => {
    const names = readdirSync(join(ROOT, "src/components/god")).filter((f) => f.startsWith("Desk"));
    for (const n of ["DeskSending.tsx", "DeskSettings.tsx", "DeskWithdraw.tsx", "DeskPropose.tsx", "DeskCheckInterest.tsx"]) expect(names).toContain(n);
  });
});

describe("the member's private page", () => {
  it("answers only through the three worker functions, with the worker's own token added for it", () => {
    const called = [...(publicActions + publicPage).matchAll(/workerRpc\([^)]*\)\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(called)).toEqual(new Set(["worker_desk_info", "worker_desk_answer"]));
    expect(publicActions + publicPage).not.toMatch(/\.from\("|createClient|getSession|cookies\(\)\.set/);
  });

  it("checks the secret is 64 hex characters and the answer is one of four before anything is saved", () => {
    expect(publicActions).toContain("[a-f0-9]{64}");
    expect(publicActions).toContain("isDeskAnswer(");
    expect(publicActions).toMatch(/other_time/);
  });

  it("opens without signing in, because the link in the email is the credential: /d is a public prefix, and no other public prefix is a prefix of it", () => {
    const proxy = read("src/proxy.ts");
    const list = /const PUBLIC_PREFIXES = \[([^\]]+)\]/.exec(proxy)?.[1] ?? "";
    expect(list).toContain('"/d"');
    // "/d" must not accidentally open "/details", "/design" and the like to something else: the proxy matches whole path segments only
    expect(proxy).toContain("pathname === p || pathname.startsWith(`${p}/`)");
    expect(read("src/app/(public)/d/[token]/page.tsx")).toContain("index: false");
  });

  it("is not indexed, sends no referrer, and has a button for everything: opening it changes nothing", () => {
    expect(publicPage).toMatch(/robots|index:\s*false/);
    expect(publicPage).toMatch(/referrer|no-referrer/);
    expect(publicPage).toContain("deskAnswerAction");
  });
});

describe("the scheduled tick", () => {
  it("expires interest checks and old links, and lists a fault with the others instead of hiding it", () => {
    expect(cron).toContain('"worker_desk_tick"');
    expect(cron).toContain("...deskFaults");
  });
});
