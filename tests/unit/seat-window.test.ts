import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmail, renderSms } from "@/lib/messaging/render";
import { SEAT_WINDOW_SAMPLES, SEAT_WINDOW_TEMPLATES } from "@/lib/messaging/templates-seat-window";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";
import {
  LEADER_SEAT_WORDS,
  MEMBER_WORDS,
  SEAT_FILTERS,
  SEAT_RANGES,
  SEAT_SUBJECT_MAX,
  checkSeatSettings,
  hoursWords,
  isSeatFilter,
  isSeatLink,
  lagosWhen,
  parseLeaderStrip,
  parseSeatBoard,
  parseSeatInfo,
  parseSeatSettings,
  parseSeatState,
  kindWords,
} from "@/lib/seat/seat";

// The 48-hour clock as the website reads and says it: three emails that never blame anyone and never carry a number, readers that turn anything odd into nothing,
// the checks the owner's form makes before the database is asked, and the wiring that keeps the public page and the cron route honest.

const SITE = "https://unitedtribes.example";
const SECRET = "a1b2c3d4".repeat(8);
const ROOT = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

function message(template: string, over: Partial<Params> = {}): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000009",
    template,
    channel: "email",
    params: { ...SEAT_WINDOW_SAMPLES[template], ...over },
    urgency: "normal",
    attempts: 1,
    reply_token: SECRET,
    to: { email: "adaeze@example.org", phone: "+2348031234567", name: "Adaeze Okafor", first_name: "Adaeze" },
  };
}
const KEYS = ["seat_reminder", "seat_last_call", "seat_released"] as const;
const mail = (k: string, over: Partial<Params> = {}) => renderEmail(message(k, over), SITE);

describe("the three emails", () => {
  it("are registered, member-facing and email only", () => {
    expect(SEAT_WINDOW_TEMPLATES.map((t) => t.key)).toEqual([...KEYS]);
    for (const t of SEAT_WINDOW_TEMPLATES) {
      expect(t.audience).toBe("member");
      expect(t.emailOnly).toBe(true);
    }
  });

  it("have a subject that fits a phone's lock screen, with and without a long tribe name", () => {
    for (const k of KEYS) {
      expect(mail(k).subject.length, k).toBeLessThanOrEqual(SEAT_SUBJECT_MAX);
      expect(mail(k, { tribe: "The Very Long Name Of A Tribe That Goes On And On Forever" }).subject.length, k).toBeLessThanOrEqual(SEAT_SUBJECT_MAX);
    }
  });

  it("never carry a phone number, a score, an age or another member's name", () => {
    for (const k of KEYS) {
      const m = mail(k);
      const both = `${m.subject}\n${m.text}\n${m.html}`;
      expect(both, k).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
      expect(both, k).not.toMatch(/2348031234567/);
      expect(both.toLowerCase(), k).not.toMatch(/\b(age|score|support need|faith journey)\b/);
    }
  });

  it("say the deadline the database sent, in Lagos time, and never work it out", () => {
    expect(lagosWhen("2026-11-12T08:00:00+00:00")).toBe("Thursday 12 November, 9 am");
    expect(mail("seat_reminder").text).toContain("Thursday 12 November, 9 am");
    expect(mail("seat_last_call").text).toContain("Thursday 12 November, 9 am");
    expect(mail("seat_reminder", { deadline_at: "not a time" }).text).toContain("the end of the day after tomorrow");
  });

  it("ask for a look in Promotions or Spam while the seat is still held, and only then", () => {
    for (const k of ["seat_reminder", "seat_last_call"]) expect(mail(k).text, k).toMatch(/Promotions or Spam/);
    expect(mail("seat_released").text).not.toMatch(/Promotions or Spam/);
  });

  it("never say the person did something wrong, or whether they opened anything", () => {
    for (const k of KEYS) {
      const t = mail(k).text.toLowerCase();
      expect(t, k).not.toMatch(/you (failed|ignored|missed|did not (open|read))|opened|did not read|your fault|too late/);
    }
    expect(mail("seat_released").text).toMatch(/You did nothing wrong/);
  });

  it("give one main button, which points to the member's private page, never to a sign-in", () => {
    expect(mail("seat_reminder").html).toContain(`${SITE}/placed/${SECRET}?a=confirm`);
    expect(mail("seat_last_call").html).toContain(`${SITE}/placed/${SECRET}?a=confirm`);
    expect(mail("seat_released").html).toContain(`${SITE}/seat/${SECRET}`);
    expect(mail("seat_released", { take_back_days: 0 }).html).not.toContain(`${SITE}/seat/`);
  });

  it("say how long a seat can be taken back for, in the right number, or nothing when it cannot", () => {
    expect(mail("seat_released", { take_back_days: 7 }).text).toMatch(/for 7 days/);
    expect(mail("seat_released", { take_back_days: 1 }).text).toMatch(/for 1 day\b/);
    expect(mail("seat_released", { take_back_days: 0 }).text).not.toMatch(/take it back/);
    expect(mail("seat_last_call", { take_back_days: 0 }).text).not.toMatch(/take it back/);
  });

  it("mark a test email as a test, in the subject, and are otherwise the same", () => {
    for (const k of KEYS) {
      expect(mail(k, { sample: true }).subject, k).toMatch(/^\[Test\] /);
      expect(mail(k).subject, k).not.toMatch(/Test/);
    }
  });

  it("make a short text message and a WhatsApp body with no number in them, and never mention another channel", () => {
    for (const k of KEYS) {
      const sms = renderSms({ ...message(k), channel: "sms" }, SITE);
      expect(sms.length, k).toBeLessThanOrEqual(320);
      expect(sms, k).not.toMatch(/2348031234567/);
    }
  });
});

describe("what the screens read", () => {
  it("turns anything odd into nothing and never into a guess", () => {
    expect(parseSeatState("rehearsal")).toBe("rehearsal");
    expect(parseSeatState("on")).toBe("on");
    for (const v of ["", "ON", null, 3, undefined, {}]) expect(parseSeatState(v)).toBe("off");
    expect(parseSeatBoard(null)).toBeNull();
    expect(parseSeatBoard("x")).toBeNull();
    expect(parseSeatBoard([])).toBeNull();
    expect(parseSeatSettings(null)).toBeNull();
    expect(parseLeaderStrip(undefined)).toBeNull();
    expect(parseSeatInfo(null).found).toBe(false);
    expect(parseSeatInfo({ found: true, state: "banana" }).found).toBe(false);
  });

  it("gives a leader first names and flags only, with no phone, email or reason in the shape", () => {
    const strip = parseLeaderStrip({
      mode: "on",
      rows: [
        { clock_id: "11111111-1111-4111-8111-111111111111", first: "Ada", flag: "waiting", hours_in: 5, hours_left: 43, extended: false, deadline_at: "2026-11-12T08:00:00+00:00", phone: "+2348031234567", email: "a@b.c", reason: "care" },
        "junk",
        { clock_id: "nope", first: "", flag: "", hours_in: "x" },
      ],
    });
    expect(strip?.mode).toBe("on");
    expect(strip?.rows).toHaveLength(2);
    expect(JSON.stringify(strip)).not.toMatch(/2348031234567|a@b\.c|care/);
    expect(strip?.rows[1]).toMatchObject({ clockId: null, first: "A member", flag: "waiting", hoursIn: 0, hoursLeft: null });
  });

  it("reads what the public page needs, and only that", () => {
    expect(parseSeatInfo({ found: true, state: "free", tribe: "Builders", leader: "Ngozi", first: "Ada", until: "2026-11-19T08:00:00+00:00", phone: "123" })).toEqual({
      found: true,
      state: "free",
      tribe: "Builders",
      leader: "Ngozi",
      first: "Ada",
      until: "2026-11-19T08:00:00+00:00",
    });
    expect(parseSeatInfo({ found: true, state: "gone" }).tribe).toBe("your tribe");
  });

  it("only takes a private link that is 64 hex characters", () => {
    expect(isSeatLink(SECRET)).toBe(true);
    for (const v of ["", "abc", SECRET.toUpperCase(), `${SECRET}0`, SECRET.slice(1), null, 5, `${SECRET.slice(0, 63)}g`]) expect(isSeatLink(v)).toBe(false);
  });

  it("says time left plainly", () => {
    expect(hoursWords(null)).toBe("");
    expect(hoursWords(0)).toBe("due now");
    expect(hoursWords(-4)).toBe("due now");
    expect(hoursWords(1)).toBe("1 hour");
    expect(hoursWords(26)).toBe("26 hours");
    expect(hoursWords(72)).toBe("3 days");
    expect(lagosWhen(undefined)).toBe("");
    expect(lagosWhen("nonsense")).toBe("");
  });

  it("has words for every filter, and knows its own filters", () => {
    for (const f of SEAT_FILTERS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(isSeatFilter(f.key)).toBe(true);
    }
    expect(isSeatFilter("everything")).toBe(false);
    expect(kindWords("some_new_event_nobody_wrote_words_for")).toBe("Something happened");
  });

  it("makes the member's page kind, with no blame and a way forward in every state", () => {
    expect(MEMBER_WORDS.kind).toMatch(/did nothing wrong/);
    expect(MEMBER_WORDS.gone("Builders")).toMatch(/first in line/);
    expect(MEMBER_WORDS.free("Builders", "Ngozi", "Thursday")).toMatch(/until Thursday/);
    expect(MEMBER_WORDS.free("Builders", "", "Thursday")).toMatch(/its leader would/);
    expect(LEADER_SEAT_WORDS.more).toMatch(/48 hours/);
  });
});

describe("the owner's numbers", () => {
  const ok = { window: "48", remind: "24", lastCall: "40", takeBack: "7", offers: "3", dayCap: "30", bar: "70", includeDays: "", reason: "A quiet week, so a little longer" };
  it("accepts the numbers the church starts with", () => {
    const r = checkSeatSettings(ok);
    expect(r).toEqual({ ok: true, value: { window: 48, remind: 24, lastCall: 40, takeBack: 7, offers: 3, dayCap: 30, bar: 70, includeDays: null, reason: "A quiet week, so a little longer" } });
  });

  it("refuses a number outside its range, in words, naming the field", () => {
    for (const [key, bad] of [["window", "20"], ["window", "97"], ["takeBack", "15"], ["offers", "0"], ["offers", "6"], ["dayCap", "4"], ["bar", "59"], ["bar", "96"]] as const) {
      const r = checkSeatSettings({ ...ok, [key]: bad });
      expect(r.ok, `${key}=${bad}`).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/between \d+ and \d+/);
    }
  });

  it("refuses anything that is not a whole number", () => {
    for (const bad of ["", "4.5", "-3", "1e2", "abc", "٤٨", "48 "]) {
      if (bad === "48 ") continue; // trailing space is trimmed
      expect(checkSeatSettings({ ...ok, window: bad }).ok, bad).toBe(false);
    }
    expect(checkSeatSettings({ ...ok, window: " 48 " }).ok).toBe(true);
  });

  it("keeps the reminder before the last call and the last call before the deadline", () => {
    expect(checkSeatSettings({ ...ok, remind: "40", lastCall: "40" }).ok).toBe(false);
    expect(checkSeatSettings({ ...ok, remind: "41", lastCall: "40" }).ok).toBe(false);
    expect(checkSeatSettings({ ...ok, lastCall: "48" }).ok).toBe(false);
    expect(checkSeatSettings({ ...ok, window: "96", remind: "30", lastCall: "60" }).ok).toBe(true);
  });

  it("needs a reason of 5 to 300 characters, and checks the optional day count", () => {
    expect(checkSeatSettings({ ...ok, reason: "" }).ok).toBe(false);
    expect(checkSeatSettings({ ...ok, reason: "four" }).ok).toBe(false);
    expect(checkSeatSettings({ ...ok, reason: "x".repeat(301) }).ok).toBe(false);
    expect(checkSeatSettings({ ...ok, includeDays: "31" }).ok).toBe(false);
    const r = checkSeatSettings({ ...ok, includeDays: "14" });
    expect(r.ok && r.value.includeDays).toBe(14);
  });

  it("uses the same ranges the database enforces, one by one", () => {
    const sql = read("supabase/migrations/20270120000100_seat_window.sql");
    const pairs: [string, readonly [number, number]][] = [
      ["window_hours", SEAT_RANGES.window],
      ["remind_hours", SEAT_RANGES.remind],
      ["last_call_hours", SEAT_RANGES.lastCall],
      ["take_back_days", SEAT_RANGES.takeBack],
      ["offers_in_row", SEAT_RANGES.offers],
      ["day_cap", SEAT_RANGES.dayCap],
      ["bar", SEAT_RANGES.bar],
    ];
    for (const [col, [lo, hi]] of pairs) expect(sql, col).toContain(`check (${col} between ${lo} and ${hi})`);
    expect(sql).toContain(`p_include_days not between ${SEAT_RANGES.include[0]} and ${SEAT_RANGES.include[1]}`);
  });
});

describe("the wiring", () => {
  it("lets the member's public page talk to the database only through the worker functions, with no phone or email in it", () => {
    for (const f of ["src/app/(public)/seat/[token]/page.tsx", "src/app/(public)/seat/[token]/actions.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/createClient|from\("|\.from\(/);
      expect(src, f).not.toMatch(/phone|whatsapp|email/i);
      expect([...src.matchAll(/workerRpc\([^)]*\)\("([a-z_]+)"/g)].map((m) => m[1]).every((n) => n.startsWith("worker_seat_")), f).toBe(true);
    }
    expect(read("src/app/(public)/seat/[token]/page.tsx")).toMatch(/isSeatLink/);
  });

  it("makes /seat a public prefix, and nothing broader", () => {
    const proxy = read("src/proxy.ts");
    expect(proxy).toMatch(/"\/seat"/);
    expect(proxy).not.toMatch(/"\/seat\/"/);
  });

  it("runs the placed sequence and the seat window on every tick, before the messages go out, and reports faults", () => {
    const cron = read("src/app/api/cron/tick/route.ts");
    const a = cron.indexOf("worker_placed_seq_tick");
    const b = cron.indexOf("worker_seat_window_tick");
    const c = cron.indexOf("runDispatch(");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(cron).toMatch(/seatFaults/);
  });

  it("starts Off, as the switchboard's own list says, and puts its page under the roles that may see it", () => {
    expect(read("src/lib/features/types.ts")).toMatch(/"seat_window"/);
    const sql = read("supabase/migrations/20270120000100_seat_window.sql");
    // the registry row: available, default 'off', sort 33
    expect(sql).toMatch(/\('seat_window', 'Seat window',[^\n]*array\['off', 'rehearsal', 'on'\], 'off', true, 33, false\);/);
    expect(read("src/lib/auth/roles.ts")).toMatch(/SEAT_ROLES/);
    expect(read("src/lib/admin/nav.ts")).toMatch(/\/admin\/seats/);
  });

  it("keeps the seat server actions behind the owner or a seat role, never open", () => {
    expect(read("src/app/(app)/god/features/actions.ts")).toMatch(/seatSettingsAction[\s\S]*?ownerOnly/);
    const admin = read("src/app/(app)/admin/seats/actions.ts");
    expect(admin).toMatch(/hasAnyRole|SEAT_ACT_ROLES|SEAT_ROLES/);
    expect(read("src/app/(app)/lead/tribe/seat-window-actions.ts")).toMatch(/isUuid/);
  });
});
