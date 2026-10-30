import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// WhatsApp that cannot fail quietly, stage 3: the WhatsApp number is compulsory. What these prove:
//   * it ships Off, and Off means save_contact, the prompt, the mismatch notice and the leader's list behave exactly as before
//   * On: an adult member cannot save contact details without a number, and cannot save a number that is plainly made up
//   * a teenager, and a person with no member profile (the office), are never asked
//   * saying yes to WhatsApp stays a separate choice: a number alone is enough, with WhatsApp, text and email all declined
//   * a member without a number sees the prompt; "not now" hides it for a week; adding a number ends it
//   * a sign-in number that differs from the contact number is shown to the member (both numbers), never to anyone else
//   * a leader sees how many of their people have no number, and their first names; a teenager is never counted; outsiders see nothing
//   * pausing the church's switchboard turns it off again

let c: Cast;
let n = 0;

beforeAll(async () => {
  c = await makeCast();
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await c.sql("delete from public.number_prompts");
  await c.sql("delete from public.contact_preferences");
  await c.sql("update auth.users set phone = null");
});

const REASON = "Trying the number rule with everyone";
const on = () => c.set("number_required", "on", { reason: REASON });
const rule = (who: string) => c.as(who, "my_number_rule");
const save = (who: string, phone: string | null, over: { wa?: boolean; sms?: boolean; email?: boolean; pref?: string } = {}) =>
  c.as(who, "save_contact", phone, over.pref ?? "email", over.wa ?? false, over.sms ?? false, over.email ?? true, "contact-v1");
const real = () => `+23480${String(30000000 + ++n * 7919).slice(0, 8)}`;

/** An adult member with a profile and no number. */
async function adult(name: string) {
  const p = await c.k.person(`${name}${++n}`);
  await c.k.profile(p.id, c.season);
  return p.id;
}
/** A teenager: an adult's profile moved to the 13 to 17 range (the teen track itself is closed in the test database). */
async function makeTeen(id: string) {
  // The guard that normally stops this is skipped for the setup, as the activity tests do
  await c.db.admin.query("begin");
  try {
    await c.db.admin.query("set local session_replication_role = replica");
    await c.db.admin.query("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [id]);
    await c.db.admin.query("commit");
  } catch (error) {
    await c.db.admin.query("rollback");
    throw error;
  }
  return id;
}
async function teen(name: string) {
  return makeTeen(await adult(name));
}

describe("it ships Off", () => {
  it("is on the Switchboard for the whole church, starts Off, and offers only Off and On", async () => {
    const r = await c.one("select * from public.feature_registry where key = 'number_required'");
    expect(r).toMatchObject({ default_mode: "off", available: true, platform_only: true, stage: 8 });
    expect(r.modes).toEqual(["off", "on"]);
    const s = await c.one("select public.feature_platform_state('number_required') as s");
    expect(s.s).toBe("off");
  });

  it("changes nothing: an adult member can still save with no number, and the answers are all no", async () => {
    const m = await adult("Quiet");
    await save(m, null);
    expect((await c.one("select phone from public.contact_preferences where person_id = $1", [m])).phone).toBeNull();
    expect(await rule(m)).toEqual({ on: false, required: false, prompt: false, mismatch: null });
    expect(await c.as(m, "number_prompt_dismiss")).toEqual({ ok: true, changed: false });
    expect(await c.sql("select 1 from public.number_prompts")).toHaveLength(0);
    expect(await c.as(c.seasoned.id, "tribe_number_gaps", c.seasoned.tribe)).toEqual({ on: false, count: 0, names: [] });
  });

  it("keeps the old checks: a number without its country code, and WhatsApp with no number, are still refused", async () => {
    const m = await adult("Old");
    await expectCode(save(m, "08031234567"), "22023");
    await expectCode(save(m, null, { wa: true }), "22023");
  });
});

describe("on: save_contact", () => {
  it("refuses an adult member with no number, and gives the reason in plain words", async () => {
    await on();
    const m = await adult("Adult");
    await expectCode(save(m, null), "22023");
    await expect(save(m, null)).rejects.toThrow(/Add your WhatsApp number/);
    await expectCode(save(m, ""), "22023");
    await expectCode(save(m, "   "), "22023");
    expect(await c.sql("select 1 from public.contact_preferences where person_id = $1", [m])).toHaveLength(0);
  });

  it("refuses a number that is plainly made up, however it is written", async () => {
    await on();
    const m = await adult("Made");
    for (const bad of ["+2348111111111", "+234 811 1111111", "+2340000000000", "+2348033333333", "+12222222222"]) {
      await expectCode(save(m, bad), "22023");
    }
    await expect(save(m, "+2348111111111")).rejects.toThrow(/looks made up/);
  });

  it("accepts a real number, with or without WhatsApp, text and email", async () => {
    await on();
    const m = await adult("Real");
    const phone = real();
    await save(m, phone);
    expect((await c.one("select phone from public.contact_preferences where person_id = $1", [m])).phone).toBe(phone);
    // a number alone is enough: all three yeses declined
    await save(m, phone, { email: false, pref: "email" });
    // and a number with a separate yes to WhatsApp still works
    await save(m, phone, { wa: true, pref: "whatsapp" });
    const w = await c.one("select whatsapp from public.member_profiles where person_id = $1", [m]);
    expect(w.whatsapp).toBe(phone);
  });

  it("accepts a number that merely repeats a digit a few times", async () => {
    await on();
    const m = await adult("Plausible");
    await save(m, "+2348033335555");
    await save(m, "+2347011222233");
  });

  it("does not ask a teenager, or anyone without a member profile", async () => {
    await on();
    const t = await teen("Teen");
    await save(t, null);
    await save(c.pastor, null);
    await save(c.member, null);
    expect(await rule(t)).toMatchObject({ on: true, required: false, prompt: false });
    expect(await rule(c.pastor)).toMatchObject({ on: true, required: false, prompt: false });
  });

  it("lets a member who already has a number keep it, and still refuses to remove it", async () => {
    const m = await adult("Keeper");
    const phone = real();
    await save(m, phone); // Off: saved
    await on();
    await save(m, phone, { wa: true, pref: "whatsapp" });
    await expectCode(save(m, null), "22023");
    expect((await c.one("select phone from public.contact_preferences where person_id = $1", [m])).phone).toBe(phone);
  });

  it("turns off again when the switch goes Off or the church's switchboard is paused", async () => {
    await on();
    const m = await adult("Pause");
    await expectCode(save(m, null), "22023");
    await c.sql("update public.feature_master set paused = true, reason = 'testing the pause'");
    await save(m, null);
    expect(await rule(m)).toMatchObject({ on: false, required: false });
    await c.sql("update public.feature_master set paused = false, reason = null");
    await c.set("number_required", "off", { reason: REASON });
    await save(m, null);
  });
});

describe("on: the prompt", () => {
  it("shows to a member with no number, hides for a week after Not now, and comes back", async () => {
    await on();
    const m = await adult("Prompt");
    expect(await rule(m)).toEqual({ on: true, required: true, prompt: true, mismatch: null });
    expect(await c.as(m, "number_prompt_dismiss")).toEqual({ ok: true, changed: true });
    expect(await rule(m)).toMatchObject({ prompt: false, required: true });
    await c.sql("update public.number_prompts set dismissed_at = now() - interval '6 days' where person_id = $1", [m]);
    expect(await rule(m)).toMatchObject({ prompt: false });
    await c.sql("update public.number_prompts set dismissed_at = now() - interval '8 days' where person_id = $1", [m]);
    expect(await rule(m)).toMatchObject({ prompt: true });
    await c.as(m, "number_prompt_dismiss");
    expect((await c.one("select times from public.number_prompts where person_id = $1", [m])).times).toBe(2);
  });

  it("ends when the member adds a number", async () => {
    await on();
    const m = await adult("Adds");
    expect((await rule(m)).prompt).toBe(true);
    await save(m, real());
    expect(await rule(m)).toMatchObject({ prompt: false, required: true });
  });

  it("is never shown to a teenager or the office", async () => {
    await on();
    expect((await rule(await teen("Young"))).prompt).toBe(false);
    expect((await rule(c.admin)).prompt).toBe(false);
  });

  it("belongs to each person alone: one person dismissing does not hide it for another", async () => {
    await on();
    const a = await adult("A");
    const b = await adult("B");
    await c.as(a, "number_prompt_dismiss");
    expect((await rule(a)).prompt).toBe(false);
    expect((await rule(b)).prompt).toBe(true);
  });
});

describe("on: the two-numbers notice", () => {
  it("shows both numbers to the member when the sign-in number differs from the contact number", async () => {
    await on();
    const m = await adult("Two");
    const phone = real();
    await save(m, phone);
    await c.sql("update auth.users set phone = '2349012345678', phone_confirmed_at = now() where id = $1", [m]);
    expect((await rule(m)).mismatch).toEqual({ signin: "+2349012345678", contact: phone });
  });

  it("says nothing when they match, or when there is no sign-in number or no contact number", async () => {
    await on();
    const m = await adult("Same");
    const phone = real();
    await save(m, phone);
    await c.sql("update auth.users set phone = $2 where id = $1", [m, phone.replace("+", "")]);
    expect((await rule(m)).mismatch).toBeNull();
    await c.sql("update auth.users set phone = null where id = $1", [m]);
    expect((await rule(m)).mismatch).toBeNull();
    const o = await adult("Other");
    await c.sql("update auth.users set phone = '2349012345678' where id = $1", [o]);
    expect((await rule(o)).mismatch).toBeNull();
  });

  it("is each person's own: the answer is only about the person asking", async () => {
    await on();
    const a = await adult("Mine");
    const b = await adult("Yours");
    await save(a, real());
    await c.sql("update auth.users set phone = '2349012345678' where id = $1", [a]);
    expect((await rule(a)).mismatch).not.toBeNull();
    expect((await rule(b)).mismatch).toBeNull();
  });
});

describe("on: the leader's list", () => {
  it("counts the people in the tribe with no number, by first name, and the count falls as they add one", async () => {
    await on();
    const r = await c.as(c.seasoned.id, "tribe_number_gaps", c.seasoned.tribe);
    expect(r.on).toBe(true);
    expect(r.count).toBe(2);
    expect(r.names).toHaveLength(2);
    expect(r.names.join(" ")).toMatch(/Bola/);
    expect(r.names.join(" ")).toMatch(/Chidi/);
    expect(JSON.stringify(r)).not.toMatch(/Test|@|\+/);
    await c.sql("insert into public.contact_preferences (person_id, phone) values ($1, $2)", [c.seasoned.members[0], real()]);
    const r2 = await c.as(c.seasoned.id, "tribe_number_gaps", c.seasoned.tribe);
    expect(r2.count).toBe(1);
    expect(r2.names).toHaveLength(1);
  });

  it("is open to the people who run the tribe and the pastorate, and to nobody else", async () => {
    await on();
    expect((await c.as(c.pastor, "tribe_number_gaps", c.seasoned.tribe)).count).toBe(2);
    expect((await c.as(c.director, "tribe_number_gaps", c.seasoned.tribe)).count).toBe(2);
    await expectCode(c.as(c.member, "tribe_number_gaps", c.seasoned.tribe), "42501");
    await expectCode(c.as(c.seasoned.members[0], "tribe_number_gaps", c.seasoned.tribe), "42501");
    await expectCode(c.as(c.appointed.id, "tribe_number_gaps", c.seasoned.tribe), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.tribe_number_gaps($1)", [c.seasoned.tribe])), "42501");
  });

  it("never counts a teenager", async () => {
    await on();
    const t = await c.k.seat(c.seasoned.tribe, c.season, "Youngster");
    await makeTeen(t.id);
    const r = await c.as(c.seasoned.id, "tribe_number_gaps", c.seasoned.tribe);
    expect(r.count).toBe(2);
    expect(r.names.join(" ")).not.toMatch(/Youngster/);
    expect(t.id).toBeTruthy();
  });
});

describe("access", () => {
  it("keeps the table and the two helpers out of reach of members and visitors", async () => {
    const m = await adult("Reach");
    await expectCode(c.db.asUser(m, (q) => q("select * from public.number_prompts")), "42501");
    await expectCode(c.db.asAnon((q) => q("select * from public.number_prompts")), "42501");
    await expectCode(c.as(m, "number_required_for", m), "42501");
    await expectCode(c.as(m, "number_looks_made_up", "+2348111111111"), "42501");
  });

  it("answers no visitor", async () => {
    await expectCode(c.db.asAnon((q) => q("select public.my_number_rule()")), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.number_prompt_dismiss()")), "42501");
  });

  it("takes no step from anyone but the owner: the switch itself", async () => {
    await expectCode(c.as(c.admin, "god_feature_set", "number_required", "platform", null, "on", [], REASON, null), "42501");
  });

  it("refuses to be scoped to one group: it is for the whole church only", async () => {
    await expect(c.set("number_required", "on", { scope: "role", roles: ["leader"], reason: REASON })).rejects.toThrow();
  });
});
