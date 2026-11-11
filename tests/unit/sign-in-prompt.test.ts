import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_KEYS } from "@/lib/features/types";
import {
  LINK_TASKS,
  NO_PROMPT,
  PROMPT_KINDS,
  PROMPT_WORDS as W,
  hiddenOn,
  isLinkKind,
  isPromptKind,
  meetsText,
  parsePromptQueue,
  whenText,
} from "@/lib/prompt/prompt";
import { KIND_LABELS, OVERVIEW_WORDS, PROMPT_RANGES, checkPromptSettings, parsePromptOverview, parsePromptSettings } from "@/lib/prompt/office";

// The sign-in prompt, as the website reads and draws it. The database decides what a person owes (the database tests prove that); these check that the site reads that answer
// defensively, says nothing the database did not, opens only the pages each kind of task is allowed to open, and keeps its promises in words and in source.

const ROOT = join(__dirname, "../..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const OFFER = "11111111-1111-4111-8111-111111111111";
const SLOT = "22222222-2222-4222-8222-222222222222";

describe("reading the database's answer", () => {
  it("shows nothing for Off, for Rehearsal, and for anything it cannot read", () => {
    expect(parsePromptQueue(null)).toEqual(NO_PROMPT);
    expect(parsePromptQueue("on")).toEqual(NO_PROMPT);
    expect(parsePromptQueue([])).toEqual(NO_PROMPT);
    expect(parsePromptQueue({ state: "off", tasks: [{ kind: "number", can_skip: true }] })).toEqual(NO_PROMPT);
    expect(parsePromptQueue({ state: "nonsense", tasks: [] })).toEqual(NO_PROMPT);
    // Rehearsal counts who would see what and shows nobody anything, whatever the answer carries
    expect(parsePromptQueue({ state: "rehearsal", tasks: [{ kind: "number", can_skip: true }], total: 1 })).toEqual({ state: "rehearsal", tasks: [], total: 0 });
  });

  it("reads a placement in a person’s words: the tribe, the leader’s first name, when it meets, how long the place is held", () => {
    const q = parsePromptQueue({
      state: "on",
      total: 1,
      tasks: [
        {
          kind: "placement",
          tribe: "Builders on Wednesday",
          leader_first: "Lara",
          meeting_day: 3,
          meeting_time: "20:00",
          mode: "in_person",
          season: "Autumn",
          deadline_at: "2026-11-18T15:00:00Z",
          can_skip: true,
          more_answers: true,
          has_number: false,
        },
      ],
    });
    expect(q.state).toBe("on");
    expect(q.tasks).toHaveLength(1);
    expect(q.tasks[0]).toMatchObject({ kind: "placement", tribe: "Builders on Wednesday", leaderFirst: "Lara", meets: "Wednesdays at 8:00 pm, in person", canSkip: true, moreAnswers: true, hasNumber: false });
    expect((q.tasks[0] as { until: string }).until).toBe("Wednesday 18 November, 4:00 pm");
  });

  it("does not offer “Not this season” or “Call me” unless the database said so", () => {
    const q = parsePromptQueue({ state: "on", total: 1, tasks: [{ kind: "placement", tribe: "A", leader_first: "B", can_skip: true }] });
    expect(q.tasks[0]).toMatchObject({ kind: "placement", moreAnswers: false, hasNumber: false });
  });

  it("treats Not now as allowed unless the database said it is not", () => {
    const q = parsePromptQueue({ state: "on", total: 2, tasks: [{ kind: "placement", tribe: "A", can_skip: false }, { kind: "number" }] });
    expect(q.tasks.map((t) => t.canSkip)).toEqual([false, true]);
  });

  it("drops a task of a kind it does not know, and an interview or an offer it cannot act on", () => {
    const q = parsePromptQueue({
      state: "on",
      total: 5,
      tasks: [
        { kind: "bitcoin", can_skip: true },
        { kind: "interview", can_skip: true, options: [] },
        { kind: "interview", can_skip: true, options: [{ id: "not-an-id", starts_at: "2026-11-18T15:00:00Z" }, { id: SLOT, starts_at: "nonsense" }] },
        { kind: "leader_offer", can_skip: true, offer_id: "nope" },
        { kind: "number", can_skip: true },
      ],
    });
    expect(q.tasks.map((t) => t.kind)).toEqual(["number"]);
    expect(q.total).toBeGreaterThanOrEqual(q.tasks.length);
  });

  it("reads the open interview times with the day, the hour and how long", () => {
    const q = parsePromptQueue({
      state: "on",
      total: 1,
      tasks: [{ kind: "interview", can_skip: true, options: [{ id: SLOT, starts_at: "2026-11-18T15:00:00Z", minutes: 30, mode: "online" }] }],
    });
    expect(q.tasks[0]).toEqual({ kind: "interview", canSkip: true, options: [{ id: SLOT, when: "Wednesday 18 November, 4:00 pm · 30 minutes, online" }] });
  });

  it("reads an offer to lead a group", () => {
    const q = parsePromptQueue({ state: "on", total: 1, tasks: [{ kind: "leader_offer", can_skip: true, offer_id: OFFER, goal: "Young adults", community: "Iganmu", expires_at: "2026-11-18T15:00:00Z" }] });
    expect(q.tasks[0]).toMatchObject({ kind: "leader_offer", offerId: OFFER, goal: "Young adults", community: "Iganmu", until: "Wednesday 18 November, 4:00 pm" });
  });

  it("never lets the database choose where a task opens: each kind has its own page, and the one the database sent is ignored", () => {
    const sent = { guardian: "/tribe", ai_consent: "/lead", joining_form: "/join", application: "/lead", tribe_card: "/lead/tribe", care: "/care" };
    expect(LINK_TASKS).toEqual(sent);
    const q = parsePromptQueue({
      state: "on",
      total: 3,
      tasks: [
        { kind: "joining_form", can_skip: true, href: "https://evil.example/join" },
        { kind: "tribe_card", can_skip: true, href: "//evil.example", changes_asked: true },
        { kind: "care", can_skip: true, href: "/god", count: 400 },
      ],
    });
    expect(q.tasks.map((t) => (t as { href: string }).href)).toEqual(["/join", "/lead/tribe", "/care"]);
    expect(q.tasks[1]).toMatchObject({ changesAsked: true });
    expect(q.tasks[2]).toMatchObject({ count: 99 });
  });

  it("carries at most five tasks, and a total never smaller than what it carries", () => {
    const many = Array.from({ length: 9 }, () => ({ kind: "number", can_skip: true }));
    const q = parsePromptQueue({ state: "on", total: 9, tasks: many });
    expect(q.tasks).toHaveLength(5);
    expect(q.total).toBeLessThanOrEqual(5);
    expect(q.total).toBeGreaterThanOrEqual(q.tasks.length);
    expect(parsePromptQueue({ state: "on", total: 0, tasks: [{ kind: "number" }, { kind: "whatsapp" }] }).total).toBe(2);
  });

  it("knows its eleven kinds, and which of them open their own page", () => {
    expect(PROMPT_KINDS).toHaveLength(11);
    expect(PROMPT_KINDS.every(isPromptKind)).toBe(true);
    expect(isPromptKind("nonsense")).toBe(false);
    expect(isPromptKind(7)).toBe(false);
    expect(PROMPT_KINDS.filter(isLinkKind).sort()).toEqual(Object.keys(LINK_TASKS).sort());
    for (const k of PROMPT_KINDS) expect(KIND_LABELS[k], k).toBeTruthy();
  });

  it("is never drawn over the owner’s console", () => {
    expect(hiddenOn("/god")).toBe(true);
    expect(hiddenOn("/god/features")).toBe(true);
    expect(hiddenOn("/godfather")).toBe(false);
    expect(hiddenOn("/tribe")).toBe(false);
    expect(hiddenOn(null)).toBe(false);
  });
});

describe("times and meeting places in words", () => {
  it("says a moment in Lagos time, and says nothing for anything that is not a moment", () => {
    expect(whenText("2026-11-18T15:00:00Z")).toBe("Wednesday 18 November, 4:00 pm");
    expect(whenText("2026-11-18T23:30:00Z")).toBe("Thursday 19 November, 12:30 am");
    expect(whenText("tomorrow")).toBeNull();
    expect(whenText(null)).toBeNull();
    expect(whenText(5)).toBeNull();
  });

  it("says when a tribe meets, with whatever it has", () => {
    expect(meetsText(0, "09:30", "online")).toBe("Sundays at 9:30 am, online");
    expect(meetsText(6, "00:15", "in_person")).toBe("Saturdays at 12:15 am, in person");
    expect(meetsText(2, null, null)).toBe("Tuesdays");
    expect(meetsText(null, "18:00", null)).toBe("6:00 pm");
    expect(meetsText(9, "25:99", "hybrid")).toBe("");
  });
});

describe("the words", () => {
  const everything = JSON.stringify(W) + JSON.stringify(OVERVIEW_WORDS);

  it("says Not now closes it for today and that it comes back, and never threatens", () => {
    expect(W.later).toBe("Not now");
    expect(W.laterNote).toMatch(/closes it for today/);
    expect(W.laterNote).toMatch(/comes back the next time you sign in/);
    expect(everything).not.toMatch(/must|or else|lose your|last chance|final warning|urgent|hurry|deadline passed/i);
  });

  it("keeps the choice with the member: yes is a choice, the other answers stay, and when Not now is not offered the answers above still are", () => {
    expect(W.placement.choice).toMatch(/your choice/);
    expect(W.noLater("Wednesday")).toMatch(/can still choose any of the answers above/);
    expect(W.noLater("Wednesday")).toMatch(/nothing is decided for you/);
    expect(W.noLater(null)).toMatch(/can still choose any of the answers above/);
    expect(W.placement.held("Wednesday")).toContain("Wednesday");
  });

  it("says plainly what Not this season, Call me and a No to WhatsApp do", () => {
    expect(W.placement.notSeasonNote).toMatch(/give up this place/);
    expect(W.placement.callNote).toMatch(/Nothing is decided by the call/);
    expect(W.whatsapp.noNote).toMatch(/final/);
    expect(W.whatsapp.noNote).toMatch(/change your mind any time on your profile/);
    expect(W.whatsapp.body("+234 ••• 2233")).toMatch(/Email stays as it is, whatever you choose/);
  });

  it("says the number is optional for WhatsApp, and that without the yes it is kept for email", () => {
    expect(W.number.whatsappNote).toMatch(/Optional/);
    expect(W.number.whatsappNote).toMatch(/message you by email/);
  });

  it("says a leader’s yes starts a Tribe Card and that a pastor still approves it", () => {
    expect(W.leader_offer.note).toMatch(/pastor still approves/);
    expect(W.leader_offer.note).toMatch(/nothing is final until then/);
  });

  it("uses no jargon a member would not know", () => {
    expect(everything).not.toMatch(/rung|queue|rpc|jwt|session|rehearsal mode|class a/i);
    // the care line is built from a count, not a sentence of its own
    expect(W.care(1)).toBe("You have one care task that is due.");
    expect(W.care(4)).toBe("You have 4 care tasks that are due.");
    expect(W.step(2, 3)).toBe("2 of 3");
  });
});

describe("what the office and the owner read", () => {
  it("reads the office’s counts, drops kinds it does not know, and shows no name or number", () => {
    const o = parsePromptOverview({
      state: "on",
      days: 7,
      visit_hours: 4,
      max_tasks: 3,
      last_hours: 6,
      worth_call_after: 5,
      kinds_off: ["care", "bitcoin"],
      people_seen: 12,
      people_would: 0,
      worth_a_call: 2,
      kinds: [
        { kind: "placement", shown: 10, would_show: 0, answered: 6, not_now: 3, opened: 1, people: 9, name: "Ada Yes", phone: "+2348031112233" },
        { kind: "bitcoin", shown: 99 },
      ],
    });
    expect(o).not.toBeNull();
    expect(o!.kinds).toEqual([{ kind: "placement", shown: 10, wouldShow: 0, answered: 6, notNow: 3, opened: 1, people: 9 }]);
    expect(o!.kindsOff).toEqual(["care"]);
    expect(JSON.stringify(o)).not.toMatch(/Ada|2348031112233/);
    expect(parsePromptOverview({ state: "weird" })).toBeNull();
    expect(parsePromptOverview(null)).toBeNull();
    expect(parsePromptOverview({ state: "off", days: -3, people_seen: "many" })).toMatchObject({ days: 7, peopleSeen: 0 });
  });

  it("reads the owner’s numbers only when it has all four", () => {
    expect(parsePromptSettings({ visit_hours: 4, max_tasks: 3, last_hours: 6, worth_call_after: 5, kinds_off: ["care"] })).toEqual({ visitHours: 4, maxTasks: 3, lastHours: 6, worthCallAfter: 5, kindsOff: ["care"] });
    expect(parsePromptSettings({ visit_hours: 4, max_tasks: 3 })).toBeNull();
    expect(parsePromptSettings(null)).toBeNull();
  });

  const good = { visit: "4", tasks: "3", last: "6", worth: "5", kindsOff: ["care"], reason: "Fewer on a Sunday" };
  it("accepts sensible numbers with a reason, and returns them as numbers", () => {
    expect(checkPromptSettings(good)).toEqual({ ok: true, value: { visit: 4, tasks: 3, last: 6, worth: 5, kindsOff: ["care"], reason: "Fewer on a Sunday" } });
  });

  it("holds each number to its range, as the database does", () => {
    expect(PROMPT_RANGES).toEqual({ visit: [1, 48], tasks: [1, 5], last: [0, 48], worth: [3, 20] });
    for (const bad of [{ visit: "0" }, { visit: "49" }, { tasks: "0" }, { tasks: "6" }, { last: "49" }, { worth: "2" }, { worth: "21" }, { visit: "four" }, { tasks: "" }, { last: "-1" }, { worth: "3.5" }]) {
      expect(checkPromptSettings({ ...good, ...bad }).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(checkPromptSettings({ ...good, last: "0" }).ok).toBe(true);
  });

  it("needs a reason of 5 to 300 characters, and only kinds that exist", () => {
    expect(checkPromptSettings({ ...good, reason: "ok" }).ok).toBe(false);
    expect(checkPromptSettings({ ...good, reason: "   " }).ok).toBe(false);
    expect(checkPromptSettings({ ...good, reason: "x".repeat(301) }).ok).toBe(false);
    expect(checkPromptSettings({ ...good, reason: "x".repeat(300) }).ok).toBe(true);
    expect(checkPromptSettings({ ...good, kindsOff: ["care", "nonsense"] }).ok).toBe(false);
  });

  it("is a switch on the Switchboard like every other", () => {
    expect(FEATURE_KEYS).toContain("sign_in_prompt");
  });
});

describe("what the site does with it (source)", () => {
  const layout = read("src/app/(app)/layout.tsx");
  const component = read("src/components/prompt/SignInPrompt.tsx");
  const actions = read("src/app/(app)/prompt-actions.ts");
  const server = read("src/lib/prompt/server.ts");
  const results = read("src/components/placed/PromptResults.tsx");
  const placedPage = read("src/app/(app)/admin/placed/page.tsx");
  const godPage = read("src/app/(app)/god/features/page.tsx");

  it("is asked once, in the layout every signed-in page shares, and never for the owner’s unlocked console", () => {
    expect(layout).toContain("loadPromptQueue");
    expect(layout).toMatch(/session\.god === "open" \? null : await loadPromptQueue/);
    expect(layout).toMatch(/prompt\.state === "on" \? <SignInPrompt/);
    expect(read("src/app/(public)/o/[token]/page.tsx")).not.toContain("SignInPrompt");
  });

  it("can never stop a page: any fault is “no screen”", () => {
    expect(server).toMatch(/catch \{\s*return NO_PROMPT;/);
    expect(server).toMatch(/error \? NO_PROMPT/);
  });

  it("is a real dialog: opened as a modal, closed by Escape as Not now only where Not now is allowed, and hidden on /god", () => {
    expect(component).toContain("showModal()");
    expect(component).toMatch(/onCancel=\{\(e\) => \{[\s\S]*?e\.preventDefault\(\)/);
    expect(component).toMatch(/else if \(task\?\.canSkip\) void later\(\)/);
    expect(component).toContain("hiddenOn(path)");
    expect(component).toContain('aria-labelledby="prompt-title"');
  });

  it("asks the database the questions, and writes answers only through the functions the site already used for them", () => {
    expect(actions).toContain('rpc("placement_my_confirm"');
    expect(actions).toContain('rpc("prompt_placement_answer"');
    expect(actions).toContain('rpc("prompt_save_number"');
    expect(actions).toContain('rpc("prompt_whatsapp_answer"');
    expect(actions).toContain('rpc("leader_offer_respond"');
    expect(actions).toContain('rpc("book_interview_slot"');
    expect(actions).toContain('rpc("prompt_log_set"');
    // nothing here writes to a table
    expect(actions).not.toMatch(/\.from\(/);
    expect(server).not.toMatch(/\.from\(/);
  });

  it("checks who is signed in before every answer, and says so when the session has ended", () => {
    const answerers = actions.match(/export async function \w+Action/g) ?? [];
    expect(answerers.length).toBe(6);
    expect(actions.match(/const supabase = await authed\(\);\n  if \(!supabase\) return \{ ok: false, message: SESSION_ENDED \}/g)).toHaveLength(6);
  });

  it("tells a second answer it is already recorded, rather than failing or doing it twice", () => {
    expect(actions).toMatch(/why === "not_active"[\s\S]*?already: true/);
    expect(component).toContain("W.already");
  });

  it("never ticks the yes to WhatsApp for anyone", () => {
    expect(component).toContain("useState(false)");
    expect(component).not.toMatch(/defaultChecked|useState\(true\)/);
  });

  it("does not ask a person for a number again once the answer is No: the screen has no way to ask twice", () => {
    expect(component).toContain("promptWhatsappAction(false)");
    expect(W.whatsapp.noNote).toMatch(/not ask again/);
  });

  it("opens only the page the kind of task is allowed to open, and leaves the rest of the tasks for the next sign-in when a person goes to do one", () => {
    expect(component).toContain("LINK_TASKS[t.kind]");
    expect(component).toMatch(/router\.push\(href\)/);
    expect(component).toMatch(/tasks\.map\(\(x\) => x\.kind\)/);
    expect(component).not.toContain("window.location");
  });

  it("shows the office counts and nothing else: no name, no number, no address", () => {
    expect(results).not.toMatch(/full_name|preferred_name|phone|email|\.name\b/);
    expect(results).toContain("data-testid=\"prompt-results\"");
    expect(placedPage).toContain("<PromptResults overview={prompt} />");
    expect(placedPage).toContain("loadPromptOverview");
  });

  it("puts the owner’s numbers on the Switchboard page, behind the owner’s check", () => {
    expect(godPage).toContain("<PromptSettingsCard");
    expect(godPage).toContain("loadPromptSettings");
    const actionsFile = read("src/app/(app)/god/features/actions.ts");
    expect(actionsFile).toMatch(/export async function promptSettingsAction[\s\S]*?if \(!\(await ownerOnly\(\)\)\) return NOT_AVAILABLE;/);
  });

  it("does not replace the notices it sits beside: the banners are still drawn from the same state", () => {
    for (const f of ["NumberNotice", "ReachNotice", "StillRightStrip"]) {
      expect(read(`src/components/profile/${f}.tsx`).length, f).toBeGreaterThan(0);
    }
  });
});
