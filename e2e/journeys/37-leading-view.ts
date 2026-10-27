/**
 * A leader sees the tribe they lead, and the people who have joined it, however they came to lead.
 *
 * Leaders reached the Lead page by four roads, and the page used to know only two of them (an application, an appointment):
 *  - Chidi: the leader role was given directly. No application, no appointment. His card is approved and two people have joined.
 *  - Dayo: appointed, on a database that has not had the appointed-leader file yet (the lookup is hidden for his visit).
 *  - Ada: approved through an application. Bola: appointed. Both are shown what they were always shown, and now the people too.
 *  - Eze: the role was given directly and his card is still a draft. Femi: an assistant leader. Gozie: began an application for a second tribe.
 *
 * None of them is offered an application they do not need, none is told how they came to lead, and the My tribe tab shows a leader their tribe.
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;

  async function leader(label: string, o: { how: "role" | "application" | "appointment"; status?: string; members?: number; assistant?: boolean }) {
    const t = await k.tribe(S, { status: o.status ?? "approved", name: `${label} tribe`, assistant: o.assistant ? "certified" : null });
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [t.leader.id, `${label} Leader`, label]);
    if (t.assistant) await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [t.assistant.id, `${label} Assistant`, `${label}Assist`]);
    for (let i = 1; i <= (o.members ?? 0); i++) await k.seat(t.tribe, S, `${label}Member${i}`);
    if (o.how === "application") {
      await q.query("insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at) values ($1, 'approved_leader', 'review', '{}'::jsonb, 'test', now(), now())", [t.leader.id]);
    } else if (o.how === "appointment") {
      await q.query("insert into public.leader_appointments (person_id, tribe_id, form, granted_role) values ($1, $2, '{}'::jsonb, true)", [t.leader.id, t.tribe]);
    }
    return { label, email: t.leader.email, assistantEmail: t.assistant?.email ?? null, id: t.leader.id, tribe: t.tribe };
  }

  const chidi = await leader("Chidi", { how: "role", members: 2 });
  const dayo = await leader("Dayo", { how: "appointment", members: 1 });
  const ada = await leader("Ada", { how: "application", members: 2 });
  const bola = await leader("Bola", { how: "appointment", members: 1 });
  const eze = await leader("Eze", { how: "role", status: "draft" });
  const femi = await leader("Femi", { how: "role", members: 1, assistant: true });
  const gozie = await leader("Gozie", { how: "role", members: 1 });
  await q.query("insert into public.leader_applications (person_id, status, step, answers, consent_version) values ($1, 'draft', 'eligibility', '{}'::jsonb, 'test')", [gozie.id]);
  const plain = await adapter.createUser({ email: "plain.member@example.org" });
  await q.query("update public.people set full_name = 'Plain Member', preferred_name = 'Plain' where id = $1", [plain.id]);

  const browser = await launch();
  const visit = async (email: string, path: string, kind: "phone" | "desktop" = "desktop") => {
    const p = await newPage(browser, kind);
    await signIn(p.page, email, path);
    await open(p.page, path);
    return p;
  };

  // ---- Chidi: the role was given directly -------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await visit(chidi.email, "/lead");
    await page.getByTestId("leading").waitFor({ timeout: 20000 });
    const body = await text(page);
    check(/You lead Chidi tribe\./.test(body), "Chidi, whose role was given directly, is told he leads his tribe");
    check(!/Start my application|Lead another tribe|Your leader application/.test(body), "…and is not offered an application");
    check(/The Tribe Card is approved and members can find the tribe\. 2 people have joined\./.test(body), "…is told his card is approved and that two people have joined");
    check(!/appointed|invited|administrator/i.test(body), "…and is not told how he came to lead");
    await page.getByTestId("leading-people").waitFor();
    const names = await page.getByTestId("leading-person").allInnerTexts();
    check(names.length === 2 && names.some((n) => /ChidiMember1 Test/.test(n)) && names.some((n) => /ChidiMember2 Test/.test(n)), "…and sees the two people by name");
    check(await page.getByRole("link", { name: "My Tribe Card" }).first().isVisible(), "…with My Tribe Card to open");
    check(await page.getByRole("link", { name: "This week" }).first().isVisible(), "…and This week");
    await shot(page, "37-chidi-lead");
    await page.getByRole("link", { name: "My Tribe Card" }).first().click();
    await page.waitForURL(/\/lead\/tribe/, { timeout: 15000 });
    await page.getByRole("heading", { name: "Your Tribe Card" }).waitFor();
    check(/Your members/.test(await text(page)) && /ChidiMember1 Test/.test(await text(page)), "My Tribe Card shows the same people");
    await ctx.close();
  }
  {
    const { ctx, page } = await visit(chidi.email, "/lead", "phone");
    await page.getByTestId("leading").waitFor({ timeout: 20000 });
    await noOverflow(page, "Chidi's Lead page on a phone");
    await shot(page, "37-chidi-lead-phone");
    await ctx.close();
  }

  // ---- Chidi's My tribe tab ---------------------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await visit(chidi.email, "/tribe");
    await page.getByTestId("leading-strip").waitFor({ timeout: 20000 });
    const body = await text(page);
    check(/You lead Chidi tribe\./.test(body) && /2 people have joined/.test(body), "the My tribe tab shows Chidi the tribe he leads, with its people");
    check(/Find your tribe/.test(body), "…and still offers the member flow below it");
    await shot(page, "37-chidi-my-tribe");
    await ctx.close();
  }
  {
    const { ctx, page } = await visit(plain.email, "/tribe");
    check((await page.getByTestId("leading-strip").count()) === 0 && /Find your tribe/.test(await text(page)), "a member who leads nothing sees the My tribe tab exactly as before");
    await open(page, "/lead");
    check(/Lead a tribe\./.test(await text(page)) && /Start my application/.test(await text(page)), "…and the Lead page offers a member the application, as before");
    await ctx.close();
  }

  // ---- Dayo: appointed, on a database without the appointed-leader lookup ----------------------------------------------------------------------
  {
    await q.query("alter function public.my_appointment() rename to my_appointment_hidden");
    try {
      const { ctx, page } = await visit(dayo.email, "/lead");
      await page.getByTestId("leading").waitFor({ timeout: 20000 });
      const body = await text(page);
      check(/You lead Dayo tribe\./.test(body) && !/Start my application|Lead another tribe/.test(body), "Dayo is told he leads his tribe even where the appointed lookup is missing, and is offered no application");
      check(/1 person has joined\./.test(body), "…and sees who has joined");
      await ctx.close();
    } finally {
      await q.query("alter function public.my_appointment_hidden() rename to my_appointment");
    }
  }

  // ---- Ada and Bola keep their pages, and now see their people --------------------------------------------------------------------------------
  {
    const { ctx, page } = await visit(ada.email, "/lead");
    await page.getByTestId("leading-people").waitFor({ timeout: 20000 });
    const body = await text(page);
    check(/Approved as a leader/.test(body) && !/Start my application/.test(body), "Ada, approved through an application, still sees her approval");
    check((await page.getByTestId("leading-person").count()) === 2, "…and now sees her two people");
    await shot(page, "37-ada-lead");
    await ctx.close();
  }
  {
    const { ctx, page } = await visit(bola.email, "/lead");
    await page.getByTestId("appointed").waitFor({ timeout: 20000 });
    await page.getByTestId("leading-people").waitFor();
    const body = await text(page);
    check(/You have been appointed to lead Bola tribe\./.test(body) && !/Start my application/.test(body), "Bola, appointed, still sees that she is appointed");
    check((await page.getByTestId("leading-person").count()) === 1, "…and now sees who has joined");
    await ctx.close();
  }

  // ---- A card that is not approved yet --------------------------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await visit(eze.email, "/lead");
    await page.getByTestId("leading").waitFor({ timeout: 20000 });
    const body = await text(page);
    check(/You lead Eze tribe\./.test(body) && /Your Tribe Card is started\. Check it, then send it to a pastor\./.test(body), "Eze, whose card is still a draft, is told so");
    check((await page.getByTestId("leading-people").count()) === 0 && !/Start my application/.test(body), "…with no list of people yet and no application offered");
    await ctx.close();
  }

  // ---- An assistant leader ------------------------------------------------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await visit(femi.assistantEmail!, "/lead");
    await page.getByTestId("leading").waitFor({ timeout: 20000 });
    const body = await text(page);
    check(/You are the assistant leader of Femi tribe\./.test(body) && !/Start my application|Lead another tribe/.test(body), "an assistant leader is told which tribe they assist, and is offered no application");
    check(await page.getByRole("link", { name: "Read the Tribe Card" }).first().isVisible(), "…and may read its Tribe Card");
    await ctx.close();
  }

  // ---- A leader who began an application for a second tribe -------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await visit(gozie.email, "/lead");
    await page.getByTestId("leading-strip").waitFor({ timeout: 20000 });
    const body = await text(page);
    check(/Pick up where you left off/.test(body) && /Continue my application/.test(body), "Gozie, who began an application, still picks it up");
    check(/You lead Gozie tribe\./.test(body) && (await page.getByRole("link", { name: "My Tribe Card" }).first().isVisible()), "…and his own tribe is one tap away");
    await ctx.close();
  }

  await browser.close();
  await q.end();
  finish("37-leading-view");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});
