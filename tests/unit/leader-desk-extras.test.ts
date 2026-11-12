import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFER_ANSWERS, OFFER_WORDS as OW, isOfferAnswer, parseOfferInfo } from "@/lib/desk/wording";
import { OWNER_OFFER_WORDS as O, offerLine, parseGroupLeader, parseLeadOptions } from "@/lib/god/desk-offers";
import { TABS } from "@/lib/god/desk";
import { WA_WORDS, parseWhatsAppState } from "@/lib/god/desk-send";
import { renderEmail } from "@/lib/messaging/render";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

// The Leader Desk's three extras: "Yes, as assistant" on an offer, "Recommend as leader" on a waiting member's row, and WhatsApp for the Desk. These check the words
// and the readers (what the screens say, and that they say nothing the database did not), and read the source for the rules the screens keep.

const ROOT = join(__dirname, "../..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const SITE = "https://unitedtribes.example";

const message = (template: string, params: Params): ClaimedMessage => ({
  id: "00000000-0000-4000-8000-000000000009",
  template,
  channel: "email",
  params,
  urgency: "normal",
  attempts: 1,
  reply_token: "ab".repeat(32),
  to: { email: "ngozi.example@example.org", phone: null, name: "Ngozi Example", first_name: "Ngozi" },
});

describe("Yes, as assistant: what the member reads", () => {
  it("is one more answer the page can send", () => {
    expect(OFFER_ANSWERS).toContain("assist");
    expect(isOfferAnswer("assist")).toBe(true);
    expect(OW.buttons.assist).toBe("Yes, as assistant");
  });

  it("promises nothing: it says it is a no to leading, that the church office decides, and that a pastor decides every application", () => {
    const said = [OW.notice.assistWhy, OW.notice.assistNothingYet, OW.done.assist].join(" ");
    expect(said).toMatch(/no to leading/i);
    expect(said).toMatch(/church office/);
    expect(said).toMatch(/pastor decides every application/);
    expect(said).toMatch(/promises nothing and appoints nobody/);
    expect(said).not.toMatch(/you are now|you have been appointed|congratulations/i);
    expect(said).toMatch(/new leader will be told your first name/);
  });

  it("asks for 18, not 21, and says it plainly when that is missing or the place is taken", () => {
    expect(OW.yes.assistAge).toMatch(/18/);
    expect(OW.yes.needAssistAge).toMatch(/18/);
    expect(OW.taken).toMatch(/another member has already offered/i);
    expect(OW.taken).toMatch(/nothing has changed for you/i);
  });

  it("reads whether the button is still free, and is closed when the database says nothing", () => {
    const base = { found: true, open: true, status: "open", first: "Ada", details: { community: "Professionals", goal: "Lead", slot: "weeknight-evening", mode: "online", ends: "Fri" } };
    expect(parseOfferInfo({ ...base, assist_open: true })?.assistOpen).toBe(true);
    expect(parseOfferInfo({ ...base, assist_open: false })?.assistOpen).toBe(false);
    expect(parseOfferInfo(base)?.assistOpen).toBe(false);
  });

  it("sits in the private page as a form of its own, shown only while it is free, with the age box and nothing from the lead form", () => {
    const page = read("src/app/(public)/o/[token]/page.tsx");
    expect(page).toContain("info.assistOpen ?");
    expect(page).toContain('data-testid="offer-assist"');
    const form = page.slice(page.indexOf('data-testid="offer-assist"'), page.indexOf('data-testid="offer-not-season"'));
    expect(form).toContain('name="answer" value="assist"');
    expect(form).toContain('name="age"');
    expect(form).not.toMatch(/name="lead"|name="relation"|name="reason"/);
    // a missing box on one form does not open the other
    expect(page).toContain('const leadNeed = pointed === "lead" ? need : null');
    expect(page).toContain('testid="offer-assisting"');
    expect(page).toContain('testid="offer-assist-taken"');
  });

  it("sends the database only what the answer needs, checks the age box first, and sends 'taken' to its own note", () => {
    const action = read("src/app/(public)/o/[token]/actions.ts");
    const branch = action.slice(action.indexOf('if (answer === "assist")'), action.indexOf('if (answer === "not_season")'));
    expect(branch).toContain('formData.get("age") === "on"');
    expect(branch).toContain("need=age");
    expect(branch).not.toMatch(/lead\s*=|relation\s*=/);
    expect(action).toContain('result.reason === "taken" ? "taken=1"');
  });
});

describe("Yes, as assistant: what the owner reads", () => {
  const offer = (over: Record<string, unknown> = {}) => ({ id: ID, round: 1, seq: 1, person_id: ID2, name: "Dayo", status: "declined", answer: "assist", ...over });

  it("is a no to leading that is called what it is", () => {
    expect(offerLine({ status: "declined", answer: "assist", seq: 1, callMe: false })).toBe("Said no, would rather assist");
    expect(O.answer.assist).toBe("would rather assist");
  });

  it("reads who offered to assist, and where the office has got to once the group has a leader", () => {
    const g = parseGroupLeader({
      leader: { person_id: ID, name: "Ngozi", tribe_id: ID2, tribe_status: "draft", certified: false },
      assistant: { person_id: ID2, name: "Dayo", since: "2026-11-10T10:00:00Z", status: "requested" },
      offers: [offer()],
    });
    expect(g.assistant).toEqual({ personId: ID2, name: "Dayo", since: "2026-11-10T10:00:00Z", status: "requested" });
    expect(g.offers[0].answer).toBe("assist");
    expect(parseGroupLeader({ assistant: { person_id: "bad", name: "x" } }).assistant).toBeNull();
    expect(parseGroupLeader({}).assistant).toBeNull();
  });

  it("says in the owner's words only what is true: nothing is decided for them, and the office has the last word", () => {
    expect(O.assistant.waiting("Dayo")).toMatch(/Nothing is decided for them/);
    expect(O.assistant.waiting("Dayo")).toMatch(/church office will be asked/);
    expect(O.assistant.putForward("Dayo")).toMatch(/put forward to the church office/);
    for (const s of ["requested", "invited", "paired", "declined", "withdrawn", "expired", "replaced"]) expect(O.assistant.status[s], s).toBeTruthy();
  });

  it("shows the member who offered on the group's panel, before and after it has a leader", () => {
    const panel = read("src/components/god/DeskLeaderPanel.tsx");
    expect(panel.match(/data-testid="desk-assistant"/g)).toHaveLength(2);
    expect(panel).toContain("O.assistant.waiting(state.assistant.name)");
    expect(panel).toContain("O.assistant.putForward(state.assistant.name)");
  });
});

describe("Recommend as leader, on a waiting member's row", () => {
  it("reads only valid groups, and says why when there are none", () => {
    const r = parseLeadOptions({ rows: [{ group_id: ID, name: "Evening group", community: "Professionals", goal: "Lead well" }, { group_id: "bad", name: "x" }], why: null });
    expect(r).toEqual({ rows: [{ groupId: ID, name: "Evening group", community: "Professionals", goal: "Lead well" }], why: null });
    expect(parseLeadOptions({ rows: [], why: "They already have an offer open." })).toEqual({ rows: [], why: "They already have an offer open." });
    expect(parseLeadOptions("x")).toBeNull();
  });

  it("is on every waiting row, asks twice before anything is sent, and asks only the one member", () => {
    expect(read("src/components/god/DeskWaiting.tsx")).toContain("<DeskRecommend person={r.personId} rehearsal={rehearsal} />");
    const row = read("src/components/god/DeskRecommend.tsx");
    expect(row.indexOf("leadOptionsAction")).toBeLessThan(row.indexOf("sendOfferAction"));
    expect(row).toContain("sendOfferAction(chosen.groupId, [person])");
    expect(row).toContain("setChosen(g)");
    expect(row).toContain("rehearsal ? O.confirmRehearsal : O.confirm");
    expect(row).not.toMatch(/phone|e164|tel:|whatsapp/i);
  });

  it("when no group can be offered, points to the Proposals tab (the Desk has no Groups tab), where a draft group is started", () => {
    const row = read("src/components/god/DeskRecommend.tsx");
    expect(row).toContain('href="/god/leader-desk?tab=proposals"');
    expect(TABS.map((t) => t.key)).toContain("proposals");
    expect(TABS.map((t) => t.label.toLowerCase())).not.toContain("groups");
    expect(read("src/components/god/DeskProposals.tsx")).toContain("Start a draft group");
    expect(read("supabase/migrations/20270125000100_desk_extras.sql")).not.toContain("Groups tab");
  });

  it("uses the group card's own sending, so the card's limits and Rehearsal are the row's too", () => {
    const actions = read("src/app/(app)/god/leader-desk/offer-actions.ts");
    const body = actions.slice(actions.indexOf("export async function leadOptionsAction"), actions.indexOf("export async function sendOfferAction"));
    expect(body).toContain('run("desk_person_lead_options"');
    expect(body).toContain("isUuid(person)");
    expect(body).not.toContain("desk_offer_send");
  });
});

describe("WhatsApp for the Desk", () => {
  it("reads the switch, and treats anything it does not understand as no switch at all", () => {
    expect(parseWhatsAppState({ on: false, mode: "full", paused: false, waiting: 10, reach: 4, reason: null, changed_at: null })).toEqual({
      on: false,
      mode: "full",
      paused: false,
      waiting: 10,
      reach: 4,
      reason: null,
      changedAt: null,
    });
    expect(parseWhatsAppState({ on: true, mode: "saver", paused: true, waiting: 3, reach: 0, reason: "Because", changed_at: "2026-11-10T10:00:00Z" })).toMatchObject({ on: true, mode: "saver", paused: true, reason: "Because" });
    expect(parseWhatsAppState({ mode: "full" })).toBeNull();
    expect(parseWhatsAppState("on")).toBeNull();
    expect(parseWhatsAppState({ on: true, mode: "turbo" })?.mode).toBe("full");
  });

  it("says plainly what Off and On do, and what still applies when it is On", () => {
    expect(WA_WORDS.off).toMatch(/email only/);
    expect(WA_WORDS.on).toMatch(/agreed/);
    expect(WA_WORDS.help).toMatch(/Off, every Desk message goes by email only/);
    for (const part of ["WhatsApp mode", "Master pause", "weekly limit", "email is the fallback", "Rehearsal sends nothing"]) expect(WA_WORDS.help, part).toContain(part);
    expect(WA_WORDS.mode("free")).toMatch(/nothing goes through Meta/);
    expect(WA_WORDS.approval).toMatch(/Meta must approve/);
    expect(WA_WORDS.reach(4, 10)).toBe("4 of the 10 members waiting for a tribe have a number on file and have agreed to WhatsApp, so they would be reached there.");
  });

  it("is one card, with a reason needed, and the action says nothing about numbers", () => {
    const card = read("src/components/god/DeskWhatsApp.tsx");
    expect(card).toContain("reason.trim().length < 3");
    expect(card).toContain("whatsappSwitchAction(next, reason)");
    const actions = read("src/app/(app)/god/leader-desk/send-actions.ts");
    const body = actions.slice(actions.indexOf("export async function whatsappSwitchAction"));
    expect(body).toContain("if (!(await ownerOnly())) return NOT_AVAILABLE;");
    expect(body).toContain('typeof on !== "boolean"');
    expect(body).toContain('run("desk_whatsapp_set"');
  });

  it("goes by email until the owner turns it On: the migration forces email in all three places the Desk queues a message", () => {
    const sql = read("supabase/migrations/20270125000100_desk_extras.sql");
    expect(sql).toMatch(/whatsapp_on boolean not null default false/);
    for (const fn of ["desk_mail_send", "desk_offer_open", "desk_offer_tick"]) {
      const start = sql.indexOf(`create or replace function public.${fn}(`);
      expect(start, fn).toBeGreaterThan(0);
      const body = sql.slice(start, sql.indexOf("\n$$;", start));
      expect(body, fn).toMatch(/case when (s\.whatsapp_on|public\.desk_whatsapp_on\(\)) then null else 'email' end/);
      expect(body, fn).not.toMatch(/'normal', 'email'\)/);
    }
  });
});

describe("the notes about an assistant", () => {
  it("tells a new leader, truthfully, that a member who was asked to lead offered to assist and was put forward", () => {
    const mail = renderEmail(message("desk_assistant_offer", { tribe: "Builders Tribe", assistant_first: "Dayo" }), SITE);
    expect(mail.subject).toBe("Dayo would like to assist Builders Tribe");
    expect(mail.text).toContain("Dayo was asked whether they would lead Builders Tribe");
    expect(mail.text).toContain("Nothing is decided");
    expect(mail.text).toMatch(/A pastor decides every application/);
    expect(mail.text).toMatch(/withdraw this on your tribe page/);
    expect(mail.text).toContain(`${SITE}/lead/tribe`);
  });

  it("tells the office the true thing about where the recommendation came from, and keeps the old wording for a leader's own", () => {
    const desk = renderEmail(message("office_assistant_recommended", { tribe: "Builders Tribe", young: false, from_desk: true, path: "/admin/assistants" }), SITE);
    expect(desk.text).toContain("A member who was asked to lead Builders Tribe said they would rather assist");
    expect(desk.text).not.toMatch(/has recommended an assistant leader/);
    const own = renderEmail(message("office_assistant_recommended", { tribe: "Builders Tribe", leader_first: "Ngozi", young: false, path: "/admin/assistants" }), SITE);
    expect(own.text).toContain("Ngozi has recommended an assistant leader for Builders Tribe.");
  });
});
