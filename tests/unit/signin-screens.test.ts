import { describe, expect, it } from "vitest";
import { SIGNIN_REASONS } from "@/lib/messaging/templates";
import { SIGNIN_ROLES, DATA_ROLES } from "@/lib/auth/roles";
import { BREAKER_LIMITS, LIMITS, TRIP_ADVICE, TRIP_REASONS, chartMax, eventLine, readOverview, shortDay, tripReason, whenText } from "@/lib/signin/admin";
import { CHOICE_KEY, readChoice, writeChoice } from "@/lib/signin/choice";
import { readTypedNumber, showsNigerianPrefix } from "@/lib/signin/typed-number";

describe("typing a WhatsApp number on the sign-in screen", () => {
  it("reads every ordinary way of writing a Nigerian number as the same number", () => {
    for (const typed of ["0803 123 4567", "803 123 4567", "8031234567", "+234 803 123 4567", "2348031234567", "0803-123-4567", "(0803) 123 4567"]) {
      expect(readTypedNumber(typed), typed).toBe("+2348031234567");
    }
  });

  it("reads a number from another country when it begins with a plus", () => {
    expect(readTypedNumber("+44 7700 900123")).toBe("+447700900123");
  });

  it("refuses what is not a number, and what is too short", () => {
    for (const bad of ["", "abc", "0803", "803 123", "123 456 7890", "+234 803 123"]) expect(readTypedNumber(bad), bad).toBeNull();
  });

  it("shows +234 in front of the box until someone starts an international number", () => {
    expect(showsNigerianPrefix("")).toBe(true);
    expect(showsNigerianPrefix("0803")).toBe(true);
    expect(showsNigerianPrefix("+44")).toBe(false);
    expect(showsNigerianPrefix(" 0044 7700")).toBe(false);
  });
});

describe("remembering the choice on this device", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it("remembers email or whatsapp, and nothing else", () => {
    const store = memory();
    expect(readChoice(store)).toBeNull();
    writeChoice("whatsapp", store);
    expect(readChoice(store)).toBe("whatsapp");
    writeChoice("email", store);
    expect(readChoice(store)).toBe("email");
    store.data.set(CHOICE_KEY, "carrier-pigeon");
    expect(readChoice(store)).toBeNull();
  });

  it("works when the device will not let it store anything", () => {
    const refusing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writeChoice("whatsapp", refusing)).not.toThrow();
    expect(readChoice(refusing)).toBeNull();
    expect(readChoice(null)).toBeNull();
    expect(() => writeChoice("email", null)).not.toThrow();
  });
});

describe("the office page", () => {
  const settings = { whatsapp_on: true, mode: "reply_first", breaker_state: "ok", sender_signal: "unknown" };

  it("reads what the database gives and refuses what is not it", () => {
    expect(readOverview(null)).toBeNull();
    expect(readOverview({})).toBeNull();
    expect(readOverview({ status: "weird", settings })).toBeNull();
    const read = readOverview({ status: "paused", settings, can_raise: true, now: { hour: 2, day: 9 }, blocks_active: 1 });
    expect(read).toMatchObject({ status: "paused", can_raise: true, now: { hour: 2, day: 9 }, blocks_active: 1, daily: [], events: [] });
  });

  it("scales the chart to the busiest day, and never to zero", () => {
    expect(chartMax([])).toBe(1);
    expect(chartMax([{ day: "2026-10-01", asked: 0, delivered: 0, failed: 0, declined: 0, not_collected: 0 }])).toBe(1);
    expect(chartMax([{ day: "2026-10-01", asked: 7, delivered: 5, failed: 1, declined: 0, not_collected: 1 }])).toBe(7);
  });

  it("says the same thing about a pause here as in the email the director is sent", () => {
    expect(TRIP_REASONS).toEqual(SIGNIN_REASONS);
    for (const key of Object.keys(TRIP_REASONS)) expect(TRIP_ADVICE[key], key).toBeTruthy();
    expect(tripReason("nonsense")).toBe("something looked wrong");
    expect(tripReason(null)).toBe("something looked wrong");
  });

  it("reads a day and a time without ever throwing, whatever the database writes", () => {
    expect(shortDay("2026-10-13")).toMatch(/13/);
    expect(shortDay("2026-10-13 00:00:00")).toBe(shortDay("2026-10-13"));
    expect(shortDay("not a day")).toBe("not a day");
    expect(whenText(null)).toBe("");
    expect(whenText("garbage")).toBe("");
    expect(whenText("2026-10-13T10:00:00Z")).toMatch(/Oct/);
  });

  it("writes each kind of log entry in plain words", () => {
    const at = "2026-10-13T10:00:00Z";
    expect(eventLine({ id: 1, at, kind: "tripped", reason: "stop_spike", detail: {}, by: null }).body).toMatch(/replied STOP/);
    expect(eventLine({ id: 2, at, kind: "reset", reason: "Phone relinked", detail: {}, by: "Mary" })).toEqual({ title: "WhatsApp restarted by Mary", body: "Note: Phone relinked" });
    expect(eventLine({ id: 3, at, kind: "switch_off", reason: null, detail: {}, by: "Ada" }).title).toBe("WhatsApp codes switched off by Ada");
    expect(eventLine({ id: 4, at, kind: "mode", reason: "normal", detail: {}, by: null }).body).toBe("Now: send at once.");
    expect(eventLine({ id: 5, at, kind: "settings", reason: null, detail: { cap_number_day: { from: 8, to: 6 } }, by: null }).body).toBe("Codes to one number in a day");
  });

  it("is for the director, a super admin and the data lead, the same people the database lets in", () => {
    expect([...SIGNIN_ROLES].sort()).toEqual(["admin", "data_lead", "director"]);
    expect([...SIGNIN_ROLES].sort()).toEqual([...DATA_ROLES].sort());
  });

  it("lists every limit once, with a range and a usual setting inside it", () => {
    const keys = [...LIMITS, ...BREAKER_LIMITS].map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const l of [...LIMITS, ...BREAKER_LIMITS]) {
      expect(l.min, l.key).toBeLessThanOrEqual(l.fallback);
      expect(l.fallback, l.key).toBeLessThanOrEqual(l.max);
    }
  });
});
