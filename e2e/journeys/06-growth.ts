/**
 * Learning and growing, end to end. A young person asks a parent, the parent answers from the link that was emailed to
 * them, the Care Team phones and confirms, and only then can the young person look at tribes; the parent can take
 * their permission back later. A member asks for a different tribe in the first weeks and a coach offers one. A
 * coach plans what happens to each tribe next season. The office reads the matching model. A director who works in
 * two centres moves between them once the church has switched that on.
 */
import type { Page } from "playwright-core";
import { kit } from "../../tests/db/builders";
import type { TestDb } from "../../tests/db/helpers";
import { MESSAGING } from "../env";
import { BASE, botCheckRefuses, check, db, finish, launch, newPage, noOverflow, open, signIn, state, text } from "../lib";

type Row = Record<string, unknown>;

const choice = (page: Page, name: string, value: string) => page.locator(`label.choice:has(input[name="${name}"][value="${value}"])`);
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();

/** Set E2E_SHOTS=<folder> to keep a picture of each screen as it is reached (for looking at, not for checking). */
const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  return { status: r.status, body: (await r.json()) as { claimed: number; sent: number; problems: string[] } };
};
const mailbox = async () => (await (await fetch(`${state().stubUrl}/__sent?channel=email`)).json()) as { body: { to: string[]; subject: string; text: string } }[];

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Row[];
  const adapter = {
    admin: q,
    async createUser(opts: { email?: string } = {}) {
      const email = (opts.email ?? `e2e${Math.random().toString(16).slice(2, 10)}@example.org`).toLowerCase();
      const made = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]))!.id as string;
      return { id: made, email };
    },
    async grant(userId: string, role: string) {
      await q.query("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [userId, role]);
    },
  };
  const k = await kit(adapter as unknown as TestDb);
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
  const idOf = async (email: string) => (await one("select id from public.people where email = $1", [email]))!.id as string;
  const sade = await idOf("coach.sade@example.org");

  const browser = await launch();

  // --- 1. the teen track is closed, and then opened ------------------------------------------------------------------
  const newbie = await k.person("Kayode");
  const young = await newPage(browser);
  await signIn(young.page, newbie.email, "/join");
  await open(young.page, "/join");
  await choice(young.page, "consent-matching", "yes").click();
  await young.page.getByRole("button", { name: "I agree, let’s begin" }).click();
  await heading(young.page, "How old are you?").waitFor({ timeout: 15000 });
  await choice(young.page, "age", "13-17").click();
  check(/open in a later release/.test(await text(young.page)), "while tribes for teens are closed, choosing 13 to 17 says so");
  check(await young.page.getByRole("button", { name: "Continue" }).isDisabled(), "…and does not let them carry on");

  await q.query("update public.platform_flags set enabled = true where key = 'teen_track'");
  await q.query("update public.tracks set active = true where slug = 'teens'");
  await open(young.page, "/join");
  await heading(young.page, "How old are you?").waitFor({ timeout: 15000 });
  await choice(young.page, "age", "13-17").click();
  const opened = await text(young.page);
  check(/Because you are under 18, a parent or guardian will need to say yes/.test(opened), "once the church opens them, the form explains the parent or guardian step");
  check(await young.page.getByRole("button", { name: "Continue" }).isEnabled(), "…and lets them carry on");
  check(!/page.*adjacent|group just before or after mine/.test(opened), "…and does not offer a neighbouring age group");
  await young.ctx.close();

  // --- 2. a young person asks a parent ------------------------------------------------------------------------------------
  const teen = await k.person("Tolu");
  await k.profile(teen.id, S, { age: "13-17" });
  const teenPage = await newPage(browser);
  await signIn(teenPage.page, teen.email, "/tribe");
  await open(teenPage.page, "/tribe");
  check(await heading(teenPage.page, /Almost there, Tolu/).isVisible(), "a young person without permission sees what is needed, not tribes");
  check(/Ask your parent or guardian/.test(await text(teenPage.page)), "…and a way to ask");
  check((await teenPage.page.getByRole("link", { name: /See my tribes|Choose/ }).count()) === 0, "…with no tribe to choose");
  await noOverflow(teenPage.page, "the teen waiting page on a phone");
  await shot(teenPage.page, "teen-ask");

  await teenPage.page.getByLabel("Their name").fill("Mrs Folake Okafor");
  await teenPage.page.getByLabel("Who they are to you").selectOption("mother");
  await teenPage.page.getByLabel("Their email").fill("folake.okafor@example.org");
  await teenPage.page.getByRole("button", { name: "Send them the link" }).click();
  await teenPage.page.getByRole("heading", { name: /Waiting for Mrs Folake Okafor/ }).waitFor({ timeout: 15000 });
  const waiting = await text(teenPage.page);
  check(/f•••@example\.org/.test(waiting), "the young person sees where it was sent, with most of the address hidden");
  check(!/folake\.okafor@example\.org/.test(waiting), "…and never the whole address");
  await shot(teenPage.page, "teen-waiting");
  const queued = await one("select params->>'token' as token, status from public.messages where template = 'guardian_request' order by created_at desc limit 1");
  const token = String(queued?.token ?? "");
  check(/^[a-f0-9]{64}$/.test(token) && queued?.status === "queued", "a private link was queued for the parent");
  check(!(await teenPage.page.content()).includes(token), "…and it is nowhere on the young person’s page");
  const own = await teenPage.page.getByLabel("Their email").count();
  check(own === 0, "once sent, the form gives way to the waiting message");

  const beat = await tick();
  check(beat.status === 200 && beat.body.problems.length === 0, "the heartbeat sent it");
  const mails = (await mailbox()).filter((m) => m.body.to.includes("folake.okafor@example.org"));
  check(mails.length === 1, "the parent received one email");
  const link = /https?:\/\/[^\s"<>]+\/guardian\/([a-f0-9]{64})/.exec(mails[0]?.body.text ?? "");
  check(link?.[1] === token, "…with their private link in it");
  check(!/Tolu Test|conflict|faith/i.test(mails[0]?.body.text ?? ""), "…and nothing about the young person beyond their first name");
  const scrubbed = await one("select status, params::text as params from public.messages where template = 'guardian_request' order by created_at desc limit 1");
  check(scrubbed?.status === "sent" && !String(scrubbed.params).includes(token), "once it is sent the outbox no longer holds the link");

  // --- 3. the parent answers by the link ---------------------------------------------------------------------------------
  const parent = await newPage(browser);
  await open(parent.page, `/guardian/${token}`);
  check(await heading(parent.page, "Tolu would like to join a tribe.").isVisible(), "the link opens without signing in, for the right young person");
  const read = await text(parent.page);
  check(/two adults/.test(read) && /own age group/.test(read) && /phone or write to you/.test(read) && /take your permission back/.test(read), "…and says what the parent is agreeing to");
  check((await parent.page.locator('meta[name="robots"]').getAttribute("content"))?.includes("noindex") === true, "the page tells search engines to leave it out");
  check((await parent.page.locator('meta[name="referrer"]').getAttribute("content")) === "no-referrer", "…and not to pass the link on");
  const yes = parent.page.getByRole("button", { name: "Yes, I give my permission" });
  check(await yes.isDisabled(), "yes stays switched off until the parent confirms they have read it");
  await noOverflow(parent.page, "the parent page on a phone");
  await shot(parent.page, "guardian-ask");
  await parent.page.getByLabel(/I am this young person’s parent or legal guardian/).check();
  await parent.page.getByLabel("Anything you would like us to know").fill("Please phone after 6pm.");
  // The bot check fails closed: while it cannot confirm a person, a yes is refused and nothing is recorded.
  await botCheckRefuses(true);
  await yes.click();
  await parent.page.getByRole("alert").filter({ hasText: /couldn’t confirm you are a person/ }).waitFor({ timeout: 15000 });
  check(true, "if the bot check cannot be passed, a yes is refused in plain words");
  check((await one("select status from public.guardian_consents where person_id = $1", [teen.id]))?.status !== "approved", "…and nothing is recorded as approved");
  await botCheckRefuses(false);
  await yes.click();
  await heading(parent.page, /Thank you, Mrs Folake Okafor/).waitFor({ timeout: 15000 });
  check(true, "the parent says yes and is thanked");
  const g = await one("select status, consent_version, verified_at from public.guardian_consents where person_id = $1", [teen.id]);
  check(g?.status === "approved" && g.consent_version === "2026-12-g2" && g.verified_at === null, "the wording version is recorded, and the call has not been made yet");

  await open(teenPage.page, "/tribe");
  const said = await text(teenPage.page);
  check(/Mrs Folake Okafor said yes/.test(said) && /One step left/.test(said), "the young person is told, and that one step is left");
  await shot(teenPage.page, "teen-said-yes");
  check(/Almost there/.test(said), "…and still cannot see tribes");

  // --- 4. the Care Team phones, and records it ----------------------------------------------------------------------------
  const care = await newPage(browser, "desktop");
  await signIn(care.page, "care_lead.dayo@example.org", "/care/teens");
  await open(care.page, "/care/teens");
  const desk = await text(care.page);
  check(/To phone/.test(desk) && /Tolu Test/.test(desk) && /folake\.okafor@example\.org/.test(desk), "the Care Lead sees who to phone, and how");
  check(/Please phone after 6pm\./.test(desk), "…with what the parent wrote");
  await shot(care.page, "care-teens");
  await care.page.getByLabel("Note about the call").fill("Spoke at 6.30pm, confirmed it was her.");
  await care.page.getByRole("button", { name: "I have spoken to them, and it was them" }).click();
  await care.page.getByText("Nobody is waiting for a call.").waitFor({ timeout: 15000 });
  check(true, "recording the call clears it from the list");
  const v = await one("select verified_at, verified_by, verified_note from public.guardian_consents where person_id = $1", [teen.id]);
  check(v?.verified_at !== null && v?.verified_by === (await idOf("care_lead.dayo@example.org")) && /6\.30pm/.test(String(v?.verified_note)), "who made the call, when, and the note are kept");
  check(/1 young person cleared to be placed/.test(await text(care.page)), "…and the count of those cleared goes up");

  await open(teenPage.page, "/tribe");
  const cleared = await text(teenPage.page);
  check(!/Almost there/.test(cleared) && !/One step left/.test(cleared), "the young person now reaches the tribe page, not the waiting message");

  // a pastor can look; a member cannot
  const plain = await newPage(browser);
  await signIn(plain.page, "member@example.org", "/care/teens");
  await plain.page.waitForURL(/\/home/, { timeout: 15000 });
  check(true, "an ordinary member who opens the Care Team page is sent home");
  await plain.ctx.close();

  // --- 5. the parent takes their permission back ------------------------------------------------------------------------
  await open(parent.page, `/guardian/${token}`);
  check(/What you agreed to/.test(await text(parent.page)), "coming back to the link shows what was agreed");
  await shot(parent.page, "guardian-approved");
  await parent.page.getByRole("button", { name: "I want to take my permission back" }).click();
  // Taking permission back is never held up by the bot check, even when it is failing.
  await botCheckRefuses(true);
  await parent.page.getByRole("button", { name: "Yes, take it back" }).click();
  await heading(parent.page, "Your permission has been taken back.").waitFor({ timeout: 15000 });
  check(true, "the parent can take their permission back from the same link, even while the bot check is failing");
  await botCheckRefuses(false);
  await open(teenPage.page, "/tribe");
  check(/took their permission back/.test(await text(teenPage.page)), "the young person is told");
  const gone = await one("select status, verified_at from public.guardian_consents where person_id = $1", [teen.id]);
  check(gone?.status === "withdrawn" && gone.verified_at === null, "the record shows it, and the earlier call no longer counts");
  await open(care.page, "/care/teens");
  check(/Said no/.test(await text(care.page)) && (await care.page.getByRole("button", { name: "Let them ask again" }).count()) === 1, "the Care Team sees it, and can let the family start again");
  const alerts = await all("select params->>'what' as what from public.messages where template = 'guardian_update' order by created_at");
  check(alerts.map((a) => a.what).join(",") === "approved,withdrawn", "the Care Lead was messaged about each answer");

  const bad = await newPage(browser);
  await open(bad.page, `/guardian/${"a".repeat(64)}`);
  check(/This link isn’t valid\./.test(await text(bad.page)), "a link that does not exist says so, and says nothing else");
  await open(bad.page, "/guardian/not-a-token");
  check(/This link isn’t valid\./.test(await text(bad.page)), "…and so does one that is not even the right shape");
  await bad.ctx.close();
  await parent.ctx.close();
  await teenPage.ctx.close();

  // --- 6. a member asks for a different tribe, and a coach offers one ---------------------------------------------------
  const alpha = await k.tribe(S, { name: "Alpha Six", coach: sade });
  await k.tribe(S, { name: "Beta Six", coach: sade });
  const femi = await k.seat(alpha.tribe, S, "Femi");
  await k.meetings(alpha.tribe, alpha.leader.id, 1, [[femi.id, 1]]);

  const member = await newPage(browser);
  await signIn(member.page, femi.email, "/tribe");
  await open(member.page, "/tribe");
  check(await member.page.getByRole("heading", { name: "Not the right tribe for you?" }).isVisible(), "in the first weeks a member is told they can ask for a different tribe");
  await member.page.getByRole("button", { name: "Ask for a different tribe" }).click();
  await shot(member.page, "swap-ask");
  await choice(member.page, "swap-reason", "time").click();
  await member.page.getByLabel("Anything you would like your coach to know").fill("My shift changed to Wednesday nights.");
  await member.page.getByRole("button", { name: "Send to my coach" }).click();
  await member.page.getByRole("heading", { name: "You asked for a different tribe" }).waitFor({ timeout: 15000 });
  check(true, "the request is sent, and the member sees where it stands");
  check(/You stay in Alpha Six|you stay in Alpha Six/i.test(await text(member.page)), "…and that they stay where they are until they say yes");

  const coach = await newPage(browser, "desktop");
  await signIn(coach.page, "coach.sade@example.org", "/growth/swaps");
  await open(coach.page, "/growth/swaps");
  const queue = await text(coach.page);
  check(/Femi Test/.test(queue) && /The time doesn’t work/.test(queue) && /My shift changed to Wednesday nights\./.test(queue), "the coach sees who asked, the reason and the note");
  await shot(coach.page, "swap-queue");
  check(/Beta Six/.test(queue) && !/Tribes that still fit[\s\S]*Alpha Six[\s\S]*Offer this tribe/.test(queue.split("Beta Six")[0]), "…and the tribes that still fit, never the one they are in");
  const leaderMsgs = await all("select params::text as p from public.messages where person_id = $1", [alpha.leader.id]);
  check(leaderMsgs.every((m) => !/shift|Wednesday|time/i.test(String(m.p))), "the tribe’s own leader is told nothing about why");
  // The innermost row only: an outer list item holds every option, and "first button" would pick another tribe
  await coach.page.locator("li:not(:has(li))", { hasText: "Beta Six" }).getByRole("button", { name: "Offer this tribe" }).click();
  await coach.page.getByRole("button", { name: "Offered" }).waitFor({ timeout: 15000 });
  check(true, "the coach offers Beta Six");

  await open(member.page, "/tribe");
  await member.page.getByRole("heading", { name: /Beta Six is offered to you/ }).waitFor({ timeout: 15000 }).catch(() => {});
  check(await member.page.getByRole("heading", { name: /Beta Six is offered to you/ }).isVisible(), "the member sees the offer, with the tribe’s Success Picture and Covenant");
  check(/The Tribe Covenant/.test(await text(member.page)), "…and the Covenant they would agree to");
  await shot(member.page, "swap-offer");
  const moveBtn = member.page.getByRole("button", { name: /Yes, move me to Beta Six/ });
  check(await moveBtn.isDisabled(), "they cannot say yes without agreeing to the new Covenant");
  await member.page.getByLabel(/I agree to this Success Picture and to the Tribe Covenant/).check();
  await moveBtn.click();
  await member.page.getByRole("heading", { name: /You are now in Beta Six/ }).waitFor({ timeout: 15000 });
  check(true, "saying yes moves them");
  const now = await one("select c.name from public.tribe_members m join public.tribes c on c.id = m.tribe_id where m.person_id = $1 and m.status = 'active'", [femi.id]);
  check(now?.name === "Beta Six", "the database agrees: one active seat, in Beta Six");
  await noOverflow(member.page, "the tribe page after a move on a phone");

  // --- 7. a coach plans next season --------------------------------------------------------------------------------------
  const gamma = await k.tribe(S, { name: "Gamma Six", coach: sade, assistant: "certified" });
  await open(coach.page, "/growth/multiply");
  const board = await text(coach.page);
  check(/Gamma Six/.test(board) && /Assistant is certified/.test(board), "the coach sees their tribes, and which assistant is ready");
  await shot(coach.page, "multiply");
  check(!/Where new tribes are most needed/.test(board), "…and not the office’s view of where new tribes are needed");
  const card = (name: string) => coach.page.locator("article", { hasText: name });
  check(await card("Alpha Six").getByRole("button", { name: "Assistant leads a new tribe" }).isDisabled(), "a tribe without a certified assistant cannot plan for one to lead");
  await card("Gamma Six").getByRole("button", { name: "Assistant leads a new tribe" }).click();
  await card("Gamma Six").getByLabel("The new tribe's community").selectOption({ label: "Professionals" });
  await card("Gamma Six").getByLabel("Note").fill("Has led twice already.");
  await card("Gamma Six").getByRole("button", { name: "Save the plan" }).click();
  await card("Gamma Six").getByText(/Decided by Sade/).waitFor({ timeout: 15000 });
  const plan = await one("select plan, note from public.multiplication_plans where tribe_id = $1", [gamma.tribe]);
  check(plan?.plan === "assistant_leads" && plan.note === "Has led twice already.", "the plan is saved with the community and the note");
  check((await one("select count(*)::int as n from public.messages where template like 'multiply%'"))?.n === 0, "…and nothing is sent to anyone");
  await card("Gamma Six").getByRole("button", { name: "Take the plan back" }).click();
  await card("Gamma Six").getByText("Not decided yet.").waitFor({ timeout: 15000 });
  check(true, "a plan can be taken back");

  const pastor = await newPage(browser, "desktop");
  await signIn(pastor.page, "pastor.ife@example.org", "/growth");
  await open(pastor.page, "/growth");
  const hub = await text(pastor.page);
  check(/Multiply/.test(hub) && /Matching model/.test(hub) && /Young people/.test(hub) && !/Tribe changes/.test(hub), "the Growth page lists only what a pastor may open");
  await shot(pastor.page, "growth-hub");
  await open(coach.page, "/growth");
  check(/Tribe changes/.test(await text(coach.page)) && !/Matching model/.test(await text(coach.page)), "…and only what a coach may open");

  // --- 8. the matching model ---------------------------------------------------------------------------------------------
  await open(pastor.page, "/growth/model");
  const model = await text(pastor.page);
  check(/Version v1/.test(model) && /In use/.test(model), "the pastor sees the model in use");
  check(!/What the results suggest/.test(model), "…but not what the results suggest changing");
  const director = await newPage(browser, "desktop");
  await signIn(director.page, "director.bola@example.org", "/growth/model");
  await open(director.page, "/growth/model");
  const dm = await text(director.page);
  check(/What the results suggest/.test(dm) && /Not enough yet/.test(dm), "a director sees that there are not yet enough results to learn from");
  check((await director.page.getByRole("button", { name: /Make a new version/ }).count()) === 0, "…and is not offered a button that would only be refused");
  await noOverflow(director.page, "the model page on desktop");
  await shot(director.page, "model");
  const phoneModel = await newPage(browser);
  await signIn(phoneModel.page, "director.bola@example.org", "/growth/model");
  await open(phoneModel.page, "/growth/model");
  await noOverflow(phoneModel.page, "the model page on a phone");
  await phoneModel.ctx.close();

  // --- 9. a director who works in two centres ----------------------------------------------------------------------------
  await open(director.page, "/home");
  await director.page.getByRole("button", { name: "Your account" }).click();
  check((await director.page.getByText("Centre", { exact: true }).count()) === 0, "with one centre, or with the switch off, there is no centre choice");
  await director.page.keyboard.press("Escape");

  const second = (await one("insert into public.centres (slug, name) values ('tcn-e2e-two', 'TCN Second') returning id"))!.id as string;
  const bola = await idOf("director.bola@example.org");
  await q.query("insert into public.person_roles (person_id, role, centre_id) values ($1, 'director', $2)", [bola, second]);
  await open(director.page, "/home");
  await director.page.getByRole("button", { name: "Your account" }).click();
  check((await director.page.getByText("Centre", { exact: true }).count()) === 0, "a second centre alone does not show the choice until the church switches it on");
  await director.page.keyboard.press("Escape");

  await q.query("update public.platform_flags set enabled = true where key = 'multi_centre'");
  await open(director.page, "/home");
  await director.page.getByRole("button", { name: "Your account" }).click();
  check(await director.page.getByText("Centre", { exact: true }).isVisible(), "with two centres and the switch on, the account menu offers the choice");
  await director.page.getByRole("button", { name: /TCN Second/ }).click();
  await director.page.waitForURL(/\/home/, { timeout: 15000 });
  await director.page.waitForTimeout(500);
  check((await one("select centre_id from public.people where id = $1", [bola]))?.centre_id === second, "choosing the other centre moves them to it");
  await open(director.page, "/dashboard");
  check(!/Alpha Six|Beta Six/.test(await text(director.page)), "…and the first centre’s tribes are no longer in front of them");

  // put things back so nothing after this depends on it
  const first = k.centreId;
  await q.query("update public.people set centre_id = $2 where id = $1", [bola, first]);
  await q.query("update public.platform_flags set enabled = false where key in ('multi_centre')");

  finish("06-growth");
}
void main();
