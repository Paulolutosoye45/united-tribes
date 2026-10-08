import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type TestDb } from "./helpers";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

describe("one person, one account (WhatsApp sign-in)", () => {
  it("still makes a person and a member role for an email account", async () => {
    const user = await db.createUser();
    const person = await db.admin.query("select email from public.people where id = $1", [user.id]);
    expect(person.rows[0].email).toBe(user.email);
    const roles = await db.admin.query("select role::text from public.person_roles where person_id = $1", [user.id]);
    expect(roles.rows.map((r) => r.role)).toEqual(["member"]);
  });

  it("refuses an account that arrives with only a phone number, and keeps nothing", async () => {
    const before = await db.admin.query("select count(*)::int as n from public.people");
    await expectCode(
      db.admin.query("insert into auth.users (phone, phone_confirmed_at) values ('2348031234567', now())"),
      "22023",
    );
    const after = await db.admin.query("select count(*)::int as n from public.people");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("gives a readable reason", async () => {
    await expect(db.admin.query("insert into auth.users (email, phone) values ('', '2348031234568')")).rejects.toThrow(
      /Add your WhatsApp number to it afterwards/,
    );
  });

  it("treats a blank email like a missing one", async () => {
    await expectCode(db.admin.query("insert into auth.users (email, phone) values ('   ', '2348031234569')"), "22023");
  });

  it("lets an existing account add a number later without touching the person", async () => {
    const user = await db.createUser();
    const before = await db.admin.query("select * from public.people where id = $1", [user.id]);
    await db.admin.query("update auth.users set phone = '2348031234570', phone_confirmed_at = now() where id = $1", [user.id]);
    const after = await db.admin.query("select * from public.people where id = $1", [user.id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    const roles = await db.admin.query("select count(*)::int as n from public.person_roles where person_id = $1", [user.id]);
    expect(roles.rows[0].n).toBe(1);
  });

  it("does not let a signed-in person or a visitor run the account trigger function", async () => {
    const user = await db.createUser();
    await expect(db.asUser(user.id, (q) => q("select public.handle_new_user()"))).rejects.toThrow(/permission denied/);
    await expect(db.asAnon((q) => q("select public.handle_new_user()"))).rejects.toThrow(/permission denied/);
  });
});
