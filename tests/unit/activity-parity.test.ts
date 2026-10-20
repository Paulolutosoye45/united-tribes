import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STEP_IDS as MEMBER_STEPS } from "@/lib/intake/steps";
import { STEP_IDS as LEADER_STEPS } from "@/lib/leaders/steps";
import { DEVICES, METHODS, SCREENS, SPEEDS } from "@/lib/activity/screens";

// The website's lists and the database's must say the same thing: a screen the website names but the database does not know is
// silently refused, and a form step the database does not know breaks the funnel's order. The migration is the source.

const SQL = readFileSync("supabase/migrations/20261215000100_activity.sql", "utf8");

function section(from: string, to: string): string {
  const start = SQL.indexOf(from);
  expect(start, `"${from}" is in the migration`).toBeGreaterThan(-1);
  const end = SQL.indexOf(to, start);
  expect(end, `"${to}" follows it`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe("the website and the database agree", () => {
  it("on the screens that are recorded", () => {
    const text = section("insert into public.activity_screens", ";\n");
    const names = [...text.matchAll(/\('([a-z_]+)',\s*'[^']+',\s*'(?:member|leader|office)'\)/g)].map((m) => m[1]);
    expect(names).toHaveLength(24);
    expect([...names].sort()).toEqual([...SCREENS].sort());
  });

  it("on the member form steps, in order", () => {
    const text = section("insert into public.activity_steps", ";\n");
    const steps = [...text.matchAll(/\('member', (\d+), '([a-z0-9-]+)'/g)].map((m) => [Number(m[1]), m[2]] as const);
    expect(steps.map(([n]) => n)).toEqual(steps.map((_, i) => i + 1));
    expect(steps.map(([, id]) => id)).toEqual([...MEMBER_STEPS]);
  });

  it("on the leader application steps, in order", () => {
    const text = section("insert into public.activity_steps", ";\n");
    const steps = [...text.matchAll(/\('leader', (\d+), '([a-z0-9-]+)'/g)].map((m) => [Number(m[1]), m[2]] as const);
    expect(steps.map(([n]) => n)).toEqual(steps.map((_, i) => i + 1));
    expect(steps.map(([, id]) => id)).toEqual([...LEADER_STEPS]);
  });

  it("on every step being a short identifier the log may carry", () => {
    for (const id of [...MEMBER_STEPS, ...LEADER_STEPS]) expect(id).toMatch(/^[a-z0-9_.-]{1,24}$/);
    for (const id of SCREENS) expect(id).toMatch(/^[a-z0-9_.-]{1,24}$/);
  });

  it("on the device classes, sign-in methods and speed bands the door accepts", () => {
    const door = section("create function public.activity_track(", "-- Form progress");
    const list = (needle: RegExp) => [...(door.match(needle)?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(list(/p_device not in \(([^)]*)\)/)).toEqual([...DEVICES]);
    expect(list(/p_method not in \(([^)]*)\)/)).toEqual([...METHODS]);
    expect(list(/p_speed not in \(([^)]*)\)/)).toEqual([...SPEEDS]);
  });

  it("on the kinds the door accepts being the three a screen may send", () => {
    const door = section("create function public.activity_track(", "-- Form progress");
    expect([...(door.match(/p_kind not in \(([^)]*)\)/)?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual(["visit", "screen", "signin"]);
  });
});
