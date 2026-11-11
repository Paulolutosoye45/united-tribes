import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The member's other answers on the private page behind "Your tribe" (the five reason chips of "Not this season", Call me, Remind me tonight, Stop, Don't call me). The
// database functions and the words were in place; the page and its action were not. What these prove:
//   * the page shows each answer only when the database says it may be given, with the five reasons offered as an optional choice, and a ring round the one an email pointed at
//   * Stop works from an old email's link even when the answers have since been switched Off, and nothing else does
//   * the action sends the database exactly what it takes, keeps only values from the short lists, and turns every word the database answers into a place to land
//   * every button an email carries has somewhere to go on the page

const state = vi.hoisted(() => ({
  token: "t".repeat(40) as string | null,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  reply: { data: { ok: true, kind: "not_this_season" } as unknown, error: null as null | { message: string; code?: string } },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/messaging/worker", () => ({
  workerToken: () => state.token,
  workerRpc: () => async (fn: string, args: Record<string, unknown> = {}) => {
    state.calls.push({ fn, args });
    return state.reply;
  },
}));
vi.mock("@/app/(public)/placed/[token]/actions", () => ({ placedAnswerAction: "/placed-answer-action" }));

import { AnswerDone, MemberAnswers } from "@/components/placed/MemberAnswers";
import { ANSWER_WORDS as W, ANSWERS_OFF, ANSWER_KINDS, POINTED, REASONS, WINDOWS, type AnswersInfo } from "@/lib/placement/answers";

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const TOKEN = "a".repeat(64);

const info = (over: Partial<AnswersInfo> = {}): AnswersInfo => ({ ...ANSWERS_OFF, on: true, deadline: "2026-11-22", remindPossible: true, number: "+23480 •••• 4567", ...over });
const html = (over: Partial<AnswersInfo> = {}, props: { pointed?: (typeof POINTED)[number] | null; badNumber?: boolean; remindIssue?: "closed" | "too_late" | null } = {}) =>
  renderToStaticMarkup(createElement(MemberAnswers, { token: TOKEN, info: info(over), pointed: props.pointed ?? null, badNumber: props.badNumber ?? false, remindIssue: props.remindIssue ?? null }));
const flat = (s: string) => s.replace(/<!-- -->/g, "").replace(/\s+/g, " ");
const tags = (out: string, name: string) => [...out.matchAll(new RegExp(`<${name} [^>]*>`, "g"))].map((m) => m[0]);
const attr = (tag: string, a: string) => tag.match(new RegExp(`(?:^|\\s)${a}="([^"]*)"`))?.[1];
const named = (out: string, field: string) => tags(out, "input").filter((t) => attr(t, "name") === field);
const rung = (out: string) => [...out.matchAll(/<[a-z]+ [^>]*ring-gold[^>]*>/g)].map((m) => attr(m[0], "data-testid"));

describe("what the page shows", () => {

  it("shows nothing when the answers are Off for this member and no email pointed at Stop", () => {
    for (const pointed of [null, "notnow", "call", "remind"] as const) expect(html({ on: false }, { pointed })).toBe("");
  });

  it("offers the five reasons for Not this season as an optional choice, and the confirm button", () => {
    const out = flat(html());
    const reasons = named(out, "reason").map((t) => attr(t, "value"));
    expect(named(out, "reason").every((t) => attr(t, "type") === "radio")).toBe(true);
    expect(reasons).toEqual(["timing", "place", "busy", "different", "other"]);
    expect(reasons).toEqual(REASONS.map((r) => r.key));
    for (const r of REASONS) expect(out).toContain(r.label);
    expect(named(out, "reason").some((t) => / required/.test(t))).toBe(false);
    expect(out).toContain(W.reasonTitle);
    expect(out).toContain(W.notNowConfirm);
    expect(out).toContain(W.notNowNote);
    expect(named(out, "kind").map((t) => attr(t, "value"))).toContain("not_this_season");
  });

  it("offers Call me with the three times of day and any time, a number box that is needed only when we hold none, and the held number with its middle hidden", () => {
    const held = flat(html());
    expect(named(held, "window").map((t) => attr(t, "value"))).toEqual([...WINDOWS.map((w) => w.key), ""]);
    expect(named(held, "window").filter((t) => / checked/.test(t)).map((t) => attr(t, "value"))).toEqual([""]);
    expect(held).toContain(W.haveNumber("+23480 •••• 4567"));
    expect(named(held, "phone")).toHaveLength(1);
    expect(named(held, "phone")[0]).not.toMatch(/ required/);
    expect(held).toContain(W.callButton);
    const none = flat(html({ number: null }));
    expect(none).toContain(W.noNumber);
    expect(named(none, "phone")[0]).toMatch(/ required/);
  });

  it("says Ask the office about another tribe once joining has closed, and does not show the form again to someone who already asked", () => {
    const closed = flat(html({ closed: true, remindPossible: false }));
    expect(closed).toContain(W.callOffice);
    expect(closed).toContain(W.callOfficeNote);
    expect(closed).not.toContain(`>${W.callButton}<`);
    const asked = flat(html({ callPending: true }));
    expect(asked).toContain(W.doneCallAgain);
    expect(asked).not.toContain(W.callConfirm);
  });

  it("offers the reminder while there is time, says tomorrow after 6 pm, and says it is set once it is", () => {
    expect(flat(html())).toContain(W.remindButton);
    expect(flat(html())).toContain(W.remindNote);
    expect(flat(html({ remindTomorrow: true }))).toContain(W.remindButtonTomorrow);
    expect(flat(html({ remindTomorrow: true }))).toContain(W.remindNoteTomorrow);
    expect(flat(html({ remindSet: true }))).toContain(W.doneRemindAgain);
    expect(flat(html({ remindSet: true }))).not.toContain(W.remindButton);
  });

  it("has no reminder button when there is no time, and says why only when the email pointed at it or the press was refused", () => {
    expect(flat(html({ remindPossible: false }))).not.toContain("answer-remind");
    expect(flat(html({ remindPossible: false }, { pointed: "remind" }))).toContain(W.remindClosed);
    expect(flat(html({ remindPossible: false, closed: true }, { pointed: "remind" }))).toContain(W.closedRemind);
    expect(flat(html({}, { remindIssue: "too_late" }))).toContain(W.remindClosed);
    expect(flat(html({}, { remindIssue: "closed" }))).toContain(W.closedRemind);
  });

  it("offers Stop and Don't call me, says the office may call, and says so when the reminders are already stopped", () => {
    const out = flat(html());
    expect(named(out, "kind").map((t) => attr(t, "value"))).toEqual(expect.arrayContaining(["stop_reminders", "dont_call"]));
    expect(out).toContain(W.stopButton);
    expect(out).toContain(W.noCallButton);
    expect(out).toContain(W.officeMayCall);
    const stopped = flat(html({ stopped: true }));
    expect(named(stopped, "kind").map((t) => attr(t, "value"))).not.toContain("stop_reminders");
    expect(stopped).toContain(W.doneStop.title);
  });

  it("rings the answer the email pointed at, opens it, and rings nothing else", () => {
    for (const [pointed, testid] of [["notnow", "answer-notnow"], ["call", "answer-call"], ["remind", "answer-remind"], ["stop", "answer-stop_reminders"]] as const) {
      expect(rung(flat(html({}, { pointed }))), pointed).toEqual([testid]);
    }
    expect(rung(flat(html()))).toEqual([]);
    const notnow = tags(flat(html({}, { pointed: "notnow" })), "details");
    expect(notnow.filter((t) => / open/.test(t)).map((t) => attr(t, "data-testid"))).toEqual(["answer-notnow"]);
    expect(tags(flat(html()), "details").some((t) => / open/.test(t))).toBe(false);
  });

  it("opens Call me and shows the number problem when the number did not look right", () => {
    const out = flat(html({}, { badNumber: true }));
    expect(tags(out, "details").filter((t) => / open/.test(t)).map((t) => attr(t, "data-testid"))).toEqual(["answer-call"]);
    expect(out).toContain(W.badNumber);
    expect(flat(html())).not.toContain(W.badNumber);
  });

  it("shows only Stop from an old email's link once the answers are Off, and not at all without that link", () => {
    const out = flat(html({ on: false }, { pointed: "stop" }));
    expect(named(out, "kind").map((t) => attr(t, "value"))).toEqual(["stop_reminders"]);
    for (const gone of ["not_this_season", "call_me", "remind_tonight", "dont_call", W.notNowButton, W.moreTitle]) expect(out, gone).not.toContain(gone);
    expect(html({ on: false }, { pointed: null })).toBe("");
  });

  it("posts every button to the one action with the secret link and a kind from the list", () => {
    const out = flat(html());
    const forms = tags(out, "form").map((t) => attr(t, "action"));
    expect(forms.length).toBe(5);
    for (const f of forms) expect(f).toBe("/placed-answer-action");
    const kinds = named(out, "kind").map((t) => attr(t, "value"));
    expect(kinds.sort()).toEqual([...ANSWER_KINDS].sort());
    expect(named(out, "token").map((t) => attr(t, "value"))).toEqual([TOKEN, TOKEN, TOKEN, TOKEN, TOKEN]);
  });
});

describe("what the page says after an answer", () => {
  it("says it in the words written for it, and a window in the member's own word", () => {
    const say = (kind: Parameters<typeof AnswerDone>[0]["kind"], again = false, window: string | null = null) => flat(renderToStaticMarkup(createElement(AnswerDone, { kind, again, window })));
    expect(say("notnow")).toContain(W.doneNotNow.title);
    expect(say("notnow")).toContain("we will not place you in a tribe again this season");
    expect(say("call", false, "morning")).toContain("We will call in the morning, as you chose.");
    expect(say("call", false, null)).toContain("between 8 am and 8 pm");
    expect(say("call", true)).toContain(W.doneCallAgain);
    expect(say("remind")).toContain(W.doneRemind.title);
    expect(say("remind", true)).toContain(W.doneRemindAgain);
    expect(say("stop")).toContain(W.doneStop.title);
    expect(say("nocall")).toContain(W.doneNoCall.title);
    for (const k of ["notnow", "call", "remind", "stop", "nocall"] as const) expect(say(k), k).toContain(`data-testid="answer-done-${k}"`);
  });
});

describe("what the action sends and where it lands", () => {
  const go = async (fields: Record<string, string>) => {
    const { placedAnswerAction } = await vi.importActual<typeof import("@/app/(public)/placed/[token]/actions")>("@/app/(public)/placed/[token]/actions");
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    try {
      await placedAnswerAction(form);
    } catch (e) {
      return (e as Error).message.replace("REDIRECT ", "");
    }
    return "no redirect";
  };
  const sent = () => state.calls[state.calls.length - 1];
  beforeEach(() => {
    state.token = "t".repeat(40);
    state.calls = [];
    state.reply = { data: { ok: true, kind: "not_this_season" }, error: null };
  });

  it("sends the five reasons and nothing that is not one, and only with Not this season", async () => {
    for (const r of REASONS) {
      await go({ token: TOKEN, kind: "not_this_season", reason: r.key });
      expect(sent().args).toEqual({ p_link: TOKEN, p_kind: "not_this_season", p_reason: r.key, p_window: null, p_topic: null, p_phone: null });
    }
    await go({ token: TOKEN, kind: "not_this_season", reason: "because I said so" });
    expect(sent().args.p_reason).toBeNull();
    await go({ token: TOKEN, kind: "not_this_season" });
    expect(sent().args.p_reason).toBeNull();
    await go({ token: TOKEN, kind: "stop_reminders", reason: "busy", window: "morning", phone: "0803" });
    expect(sent().args).toEqual({ p_link: TOKEN, p_kind: "stop_reminders", p_reason: null, p_window: null, p_topic: null, p_phone: null });
  });

  it("sends a time of day and a number only with Call me, and any time as no time at all", async () => {
    state.reply = { data: { ok: true, kind: "call_me", window: "morning" }, error: null };
    await go({ token: TOKEN, kind: "call_me", window: "morning", phone: "  +2348031234567  ", reason: "busy" });
    expect(sent().args).toEqual({ p_link: TOKEN, p_kind: "call_me", p_reason: null, p_window: "morning", p_topic: null, p_phone: "+2348031234567" });
    await go({ token: TOKEN, kind: "call_me", window: "", phone: "" });
    expect(sent().args).toMatchObject({ p_window: null, p_phone: null });
    await go({ token: TOKEN, kind: "call_me", window: "midnight" });
    expect(sent().args.p_window).toBeNull();
    await go({ token: TOKEN, kind: "call_me", phone: "9".repeat(100) });
    expect((sent().args.p_phone as string).length).toBe(40);
  });

  it("lands each answer on its own message", async () => {
    state.reply = { data: { ok: true, kind: "not_this_season" }, error: null };
    expect(await go({ token: TOKEN, kind: "not_this_season" })).toBe(`/placed/${TOKEN}?done=notnow`);
    state.reply = { data: { ok: true, kind: "call_me", window: "evening" }, error: null };
    expect(await go({ token: TOKEN, kind: "call_me", window: "evening" })).toBe(`/placed/${TOKEN}?done=call&w=evening`);
    state.reply = { data: { ok: true, kind: "call_me", again: true }, error: null };
    expect(await go({ token: TOKEN, kind: "call_me" })).toBe(`/placed/${TOKEN}?done=call&again=1`);
    state.reply = { data: { ok: true, kind: "remind_tonight" }, error: null };
    expect(await go({ token: TOKEN, kind: "remind_tonight" })).toBe(`/placed/${TOKEN}?done=remind`);
    state.reply = { data: { ok: true, kind: "stop_reminders" }, error: null };
    expect(await go({ token: TOKEN, kind: "stop_reminders" })).toBe(`/placed/${TOKEN}?done=stop`);
    state.reply = { data: { ok: true, kind: "dont_call" }, error: null };
    expect(await go({ token: TOKEN, kind: "dont_call" })).toBe(`/placed/${TOKEN}?done=nocall`);
  });

  it("turns each word the database refuses with into a place to land, and a number that does not look right back to the form", async () => {
    const refuse = (reason: string) => (state.reply = { data: { ok: false, reason }, error: null });
    refuse("invalid");
    expect(await go({ token: TOKEN, kind: "stop_reminders" })).toBe(`/placed/${TOKEN}?invalid=1`);
    refuse("not_active");
    expect(await go({ token: TOKEN, kind: "not_this_season" })).toBe(`/placed/${TOKEN}?invalid=1`);
    refuse("closed");
    expect(await go({ token: TOKEN, kind: "remind_tonight" })).toBe(`/placed/${TOKEN}?rc=closed&a=remind`);
    refuse("too_late");
    expect(await go({ token: TOKEN, kind: "remind_tonight" })).toBe(`/placed/${TOKEN}?rc=too_late&a=remind`);
    refuse("off");
    expect(await go({ token: TOKEN, kind: "call_me" })).toBe(`/placed/${TOKEN}?problem=1`);
    refuse("not_available");
    expect(await go({ token: TOKEN, kind: "call_me" })).toBe(`/placed/${TOKEN}?problem=1`);
    refuse("started");
    expect(await go({ token: TOKEN, kind: "not_this_season" })).toBe(`/placed/${TOKEN}?started=1`);
    state.reply = { data: null, error: { message: "Write your number", code: "22023" } };
    expect(await go({ token: TOKEN, kind: "call_me", phone: "x" })).toBe(`/placed/${TOKEN}?cn=1&a=call`);
    state.reply = { data: null, error: { message: "boom", code: "XX000" } };
    expect(await go({ token: TOKEN, kind: "call_me" })).toBe(`/placed/${TOKEN}?problem=1`);
    state.reply = { data: null, error: { message: "bad", code: "22023" } };
    expect(await go({ token: TOKEN, kind: "not_this_season" })).toBe(`/placed/${TOKEN}?problem=1`);
  });

  it("sends a link that is not a link, or a kind that is not a kind, home without asking the database", async () => {
    expect(await go({ token: "short", kind: "not_this_season" })).toBe("/");
    expect(await go({ token: TOKEN, kind: "delete_everything" })).toBe("/");
    expect(await go({ token: TOKEN })).toBe("/");
    expect(state.calls).toEqual([]);
  });

  it("says there was a problem, and asks nothing, when the service has no token", async () => {
    state.token = null;
    expect(await go({ token: TOKEN, kind: "not_this_season" })).toBe(`/placed/${TOKEN}?problem=1`);
    expect(state.calls).toEqual([]);
  });
});

describe("the page, the action and the database agree", () => {
  const page = read("src/app/(public)/placed/[token]/page.tsx");
  const actions = read("src/app/(public)/placed/[token]/actions.ts");
  const sql = read("supabase/migrations/20270114000100_placed_answers.sql");

  it("calls the database function with the parameters it declares", () => {
    const decl = sql.match(/create function public\.worker_placed_answer\(p_token text, ([^)]*)\)/)![1];
    const params = [...decl.matchAll(/(p_[a-z]+) text/g)].map((m) => m[1]);
    expect(params).toEqual(["p_link", "p_kind", "p_reason", "p_window", "p_topic", "p_phone"]);
    const call = actions.match(/"worker_placed_answer", \{([\s\S]*?)\n  \}\);/)![1];
    expect([...call.matchAll(/(p_[a-z]+):/g)].map((m) => m[1])).toEqual(params);
    expect(sql).toMatch(/p_kind not in \('not_this_season', 'call_me', 'remind_tonight', 'stop_reminders', 'dont_call'\)/);
    expect(sql).toMatch(/p_reason not in \('timing', 'place', 'busy', 'different', 'other'\)/);
    expect(sql).toMatch(/p_window not in \('morning', 'afternoon', 'evening'\)/);
  });

  it("reads what to show from the database's own answer, and only while the seat is waiting", () => {
    expect(page).toMatch(/"worker_placed_answers_info", \{ p_link: token \}/);
    expect(page).toMatch(/state\?\.active && !state\.confirmed && isAnswerLink\(token\)/);
    expect(page).toMatch(/<MemberAnswers token=\{token\} info=\{answers\}/);
    expect(page).toMatch(/!state\.confirmed \? <MemberAnswers/);
    expect(page).toMatch(/doneAnswer === "notnow" && !state\?\.active/);
  });

  it("has somewhere to go for every button the answer emails carry", () => {
    const seq = read("src/lib/messaging/templates-placed-seq.ts");
    const actionsInEmails = (seq.match(/type Action = ([^;]+);/)![1].match(/"([a-z]+)"/g) ?? []).map((s) => s.replace(/"/g, ""));
    const handled = new Set<string>(["confirm", "change", "withhold", ...POINTED]);
    for (const a of actionsInEmails) expect(handled.has(a), a).toBe(true);
    for (const f of ["templates-seat-window.ts", "templates-placement.ts"]) {
      for (const m of read(`src/lib/messaging/${f}`).matchAll(/\?a=\$\{action\}/g)) expect(m[0]).toBeTruthy();
    }
    expect(actionsInEmails).toEqual(expect.arrayContaining(["notnow", "call", "remind", "stop"]));
  });
});
