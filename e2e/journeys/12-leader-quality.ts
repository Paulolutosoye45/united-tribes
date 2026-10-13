/**
 * The first check on leader applications, end to end on a phone.
 *
 * The director moves the switch from Off to Recording only to On, and the wording an applicant agrees to changes with it.
 * Tobi writes an application start to finish: a too-short answer gets a kind note and he adds to it, the rest pass, and
 * once sent the first check clears him, his referee links open and a message says so.
 * Wale's last two answers are thin or about fixing rather than listening. After sending he is asked to add to them, sees
 * only kind notes (never a score), cannot swap an answer for filler, rewrites both, and clears.
 * Femi tries the same box three times with keyboard mashing. The third try goes through (nobody is stuck), and the
 * application is held for a pastor, who reads it and lets it through with a note that is recorded with their name.
 *
 * Set E2E_SHOTS=1 to keep a picture of the main screens in .e2e/shots, for looking at.
 */
import type { Page } from "playwright-core";
import { MESSAGING } from "../env";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();
const choice = (page: Page, name: string, value: string) => page.locator(`label.choice:has(input[name="${name}"][value="${value}"])`);
const announce = (page: Page) => page.locator("main p.sr-only[aria-live=polite]");

/** Set E2E_SHOTS=1 to keep a picture of a screen in .e2e/shots. */
async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `.e2e/shots/${name}.png`, fullPage: true });
}

async function tick() {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  if (!r.ok) throw new Error(`tick answered ${r.status}`);
}

/** Press Continue (or another button) and wait for the next screen. */
async function next(page: Page, label: string | RegExp, arrivesAt: string | RegExp) {
  await page.getByRole("button", { name: label }).click();
  await heading(page, arrivesAt).waitFor({ timeout: 20000 });
}

/** Press Continue until the screen with this heading appears. For the stretches where every answer is already in. */
async function carryOn(page: Page, until: string | RegExp) {
  for (let i = 0; i < 24; i++) {
    if (await heading(page, until).isVisible().catch(() => false)) return true;
    const before = await announce(page).textContent();
    await page.getByRole("button", { name: /^Continue$/ }).click();
    await page.waitForFunction((b) => document.querySelector("main p.sr-only[aria-live=polite]")?.textContent !== b, before, { timeout: 15000 }).catch(() => {});
  }
  return heading(page, until).isVisible().catch(() => false);
}

const WORDS = {
  tobi: {
    goalStory:
      "In January 2022 I was moved from analyst to team lead at the bank in Ikoyi, with six people reporting to me and no training. For the first months I micromanaged because I was afraid of looking weak, and two people nearly resigned. I asked my own manager for a weekly check-in and started asking my team what they needed from me. I learned that leading is mostly listening and that my fear was making me controlling.",
    why: "When I lost my father in 2020, a small group from church came to the house every Thursday and mostly sat with us. They never tried to fix anything. I want to be that kind of presence for other people, and I want to learn it myself because I still talk too much when someone is hurting.",
    walked:
      "My neighbour Funmi lost her husband last year. I went round on Saturdays and listened, even when she told the same story many times. I did not tell her to move on or lend her money. I prayed with her when she asked, and when she needed more than I could give I helped her speak to our pastor's wife.",
    walkNote: "I would say 3 out of 5. I read my Bible most mornings but I am often distracted and I skip prayer when work gets busy. I do not want to pretend it is higher than it is.",
    obstacles:
      "I travel for work two weeks in November and my mother needs me on Sunday afternoons. I would tell my assistant early and ask her to lead the meetings I miss, and I would move one meeting online rather than cancel it.",
  },
  wale: {
    goalStory:
      "In 2023 I set a goal to finish my master's while working. I failed my first two exams and wanted to quit. My supervisor sat down with me and I admitted I had been hiding how overwhelmed I was. I finished last month. I learned that asking for help early costs less than pretending.",
    why: "I want to lead because I know what it is to be silently struggling in a room full of people who look fine. If someone had asked me properly in 2023 I would have said something sooner. I do not feel ready, but I want to learn to ask good questions and to listen.",
    thinWalked: "I told her what to do and I paid for it, so the problem was fixed.",
    walkNote: "A 2, honestly. I have been dry for about eight months and I pray less than I used to. I still come to church but my heart feels distant. I am telling you because I would rather be honest than look strong.",
    thinObstacles: "Nothing much, I am free most of the time.",
    walked:
      "My colleague Amaka was running out of money after her divorce. I did not lend money or tell her what to do. I took her to lunch on Fridays, listened, and when she asked, I went with her to meet our church counsellor.",
    obstacles:
      "My thesis defence is in January and I get tired easily. I would tell my coach early and ask my assistant to take the weeks when I am overloaded. I also have a long commute, so I would plan some meetings online.",
  },
  femi: {
    goalStory: "I left teaching in 2019 to start a catering business. It nearly failed twice. I learned to ask my husband and my pastor for help early, before things got bad.",
    junkWhy: [
      "asdkjh qwlkej zxmnbv poiuyt lkjhgf mnbvcx qazwsx edcrfv tgbyhn ujmikl",
      "ghjkl fdsa qwert yuiop zxcvb nmasdf ghjkl poiuy trewq lkjhg mnbvc",
      "sdfghj wertyu xcvbnm dfghjk ertyui cvbnmk rtyuio fghjkl tyuiop bnmqwe",
    ],
    walked: "My sister lost her baby. I stayed with her for a week, listened, and did not try to explain anything to her.",
    walkNote: "About a 3. I pray daily but I get tired and skip my Bible reading in busy weeks, and I know it shows.",
    obstacles: "Catering season in December is my busiest time. I would tell my assistant early and ask her to lead those weeks.",
  },
} as const;

const OLD_WORDING = "keep a record of the review.";
const NEW_WORDING = /computer program \(an AI service\)/;

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Row[];

  async function person(email: string, name: string) {
    const id = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]))!.id as string;
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [id, name, name.split(" ")[0]]);
    return id;
  }
  const tobi = await person("tobi.apply@example.org", "Tobi Adeyemi");
  const wale = await person("wale.apply@example.org", "Wale Bakare");
  const femi = await person("femi.apply@example.org", "Femi Coker");

  /** A draft with everything in but the written answers named in `calling`, left at the step the person would be on. */
  async function draftAt(personId: string, step: string, calling: Record<string, unknown>, walkRating?: number) {
    const answers = {
      eligibility: { member6: true, foundation: true, serving: true, age21: true, time: true, safeguarding: true, confidentiality: true },
      calling: { track: "builders", community: "professionals", goal: "step-into-a-leadership-role", goalRelation: "pursuing", ...(walkRating ? { walkRating } : {}), ...calling },
      scenarios: {
        s1: { best: "b", worst: "d" },
        s2: { best: "b", worst: "c" },
        s3: { best: "a", worst: "d" },
        s4: { best: "a", worst: "c" },
        s5: { best: "a", worst: "b" },
        s6: { best: "a", worst: "c" },
      },
      style: { styleSocial: 1, styleStructure: -1, leadBest: "connection" },
      contact: { whatsapp: "+2348031234567" },
    };
    const id = (
      await one("insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, $2, $3::jsonb, '2026-12-l2') returning id", [personId, step, JSON.stringify(answers)])
    )!.id as string;
    const refs: [number, string, string, string, boolean][] = [
      [1, "Pastor Ife Adeyemi", "My unit head at church", "ife.adeyemi@example.org", true],
      [2, "Sister Bola Ade", "A friend from work", "bola.ade@example.org", false],
    ];
    for (const [slot, name, rel, contact, head] of refs) {
      await q.query(
        "insert into public.leader_references (application_id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, token_hash, token_expires_at) values ($1, $2, $3, $4, $5, $6, md5(gen_random_uuid()::text), now() + interval '30 days')",
        [id, slot, name, rel, contact, head],
      );
    }
    return id;
  }

  /** Waits for the heartbeat and the reading to do their work. */
  async function until<T>(label: string, read: () => Promise<T | null | undefined | false>, seconds = 45): Promise<T | null> {
    const end = Date.now() + seconds * 1000;
    let lastTick = 0;
    while (Date.now() < end) {
      const v = await read();
      if (v) return v;
      if (Date.now() - lastTick > 3000) {
        lastTick = Date.now();
        await tick();
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    console.log(`  (gave up waiting for: ${label})`);
    return null;
  }
  const stateOf = async (appId: string) => (await one("select state, basis, rewrites_used, feedback, cleared_by from public.leader_ai_state where application_id = $1", [appId])) as { state: string; basis: string; rewrites_used: number; feedback: Record<string, string>; cleared_by: string | null } | undefined;
  const inState = (appId: string, ...states: string[]) => async () => {
    const s = await stateOf(appId);
    return s && states.includes(s.state) ? s : null;
  };
  const messagesFor = async (personId: string, template: string) => (await one("select count(*)::int as n from public.messages where person_id = $1 and template = $2", [personId, template]))!.n as number;

  const browser = await launch();

  // --- 1. The switch is off: nothing is different ---------------------------------------------------------------
  const t = await newPage(browser);
  const tp = t.page;
  await signIn(tp, "tobi.apply@example.org", "/lead/apply");
  await heading(tp, "Lead a tribe.").waitFor({ timeout: 15000 });
  let welcome = await text(tp);
  check(welcome.includes(OLD_WORDING) && !NEW_WORDING.test(welcome), "with the switch off, the first screen carries the original wording and says nothing about a computer program");
  check((await one("select mode from public.leader_ai_settings"))?.mode === "off", "the first check starts off");

  // --- 2. The director moves the switch, by hand, with the thresholds in view ------------------------------------
  const d = await newPage(browser, "desktop");
  const dp = d.page;
  await signIn(dp, "director.bola@example.org", "/admin/leader-quality");
  await heading(dp, "Leader quality").waitFor({ timeout: 15000 });
  check((await dp.getByTestId("mode-now").innerText()).trim() === "Off", "the director sees the first check is Off");
  check((await dp.getByTestId("held-list").count()) === 1 && (await dp.getByTestId("thresholds").count()) === 1, "the held list and the thresholds are on the same page");
  await choice(dp, "leader-mode", "shadow").click();
  await dp.getByRole("button", { name: "Switch to recording only" }).click();
  await dp.getByRole("button", { name: "Yes, switch it" }).click();
  await dp.waitForFunction(() => document.querySelector('[data-testid="mode-now"]')?.textContent?.trim() === "Recording only", null, { timeout: 15000 });
  check(true, "she switches it to Recording only, and the page says so");

  await tp.reload();
  await heading(tp, "Lead a tribe.").waitFor({ timeout: 15000 });
  welcome = await text(tp);
  check(NEW_WORDING.test(welcome), "in Recording only the first screen already carries the new wording, so agreement is collected before anything is read");

  await choice(dp, "leader-mode", "on").click();
  check((await dp.getByTestId("mode-cautions").innerText()).includes("test mode"), "switching on with the test stand-in warns that it is not a real model, and does not stop the rehearsal");
  await dp.getByRole("button", { name: "Switch to on" }).click();
  await dp.getByRole("button", { name: "Yes, switch it" }).click();
  await dp.waitForFunction(() => document.querySelector('[data-testid="mode-now"]')?.textContent?.trim() === "On", null, { timeout: 15000 });
  const settings = (await one("select mode, activated_at is not null as stamped, updated_by from public.leader_ai_settings"))!;
  check(settings.mode === "on" && settings.stamped === true && settings.updated_by !== null, "…and then On: stored, stamped with the date, and recorded with her name");
  await noOverflow(dp, "admin leader quality (desktop)");
  await shot(dp, "1-admin-switch");
  await d.ctx.close();

  // --- 3. Tobi: a whole application, with one short answer along the way ----------------------------------------
  await tp.reload();
  await heading(tp, "Lead a tribe.").waitFor({ timeout: 15000 });
  await choice(tp, "consent-leader", "yes").click();
  await next(tp, "I agree, start my application", "First, seven quick questions.");
  const yes = tp.locator(".segmented label", { hasText: /^Yes$/ });
  for (let i = 0; i < (await yes.count()); i++) await yes.nth(i).click();
  await next(tp, /^Continue$/, "How can the panel reach you?");
  await tp.getByLabel("WhatsApp number").fill("0803 123 4567");
  await next(tp, /^Continue$/, "Which stage of life are you in?");
  await choice(tp, "track", "builders").click();
  await next(tp, /^Continue$/, "Which community is home for you?");
  await choice(tp, "community", "professionals").click();
  await next(tp, /^Continue$/, "Which Season Goal could you lead a tribe toward?");
  await choice(tp, "goal", "step-into-a-leadership-role").click();
  await choice(tp, "goalRelation", "pursuing").click();
  await next(tp, /^Continue$/, "Tell us your story with this goal.");
  const tobiApp = (await one("select id, consent_version from public.leader_applications where person_id = $1", [tobi]))!;
  check(tobiApp.consent_version === "2026-12-l2", "his application stores the wording he agreed to, which includes the computer program");

  // a short answer: kind note, tries left, and he adds to it
  await tp.locator("textarea[name=goalStory]").fill("I got promoted at work last year.");
  check(/\d+ more words? to go/.test(await text(tp)), "the counter counts words, not characters, because the first check is on");
  await tp.getByRole("button", { name: /^Continue$/ }).click();
  await tp.getByTestId("answer-feedback").waitFor({ timeout: 20000 });
  const note = await tp.getByTestId("answer-feedback").innerText();
  check(/Not quite yet/.test(note) && /Change it and press Continue again/.test(note), "a too-short answer gets “Not quite yet”, a kind note, and what to do next");
  check(!/score|flag|\d\s*\/\s*5|AI/.test(note), "…and the note never mentions a score, a flag or an AI");
  check((await heading(tp, "Tell us your story with this goal.").isVisible()), "…and he stays on the same screen");
  await noOverflow(tp, "apply feedback");
  await shot(tp, "2-apply-feedback");
  await tp.locator("textarea[name=goalStory]").fill(WORDS.tobi.goalStory);
  check((await tp.getByTestId("answer-feedback").count()) === 0, "the note goes away as soon as he starts changing the answer");
  check(/That’s enough/.test(await text(tp)), "…and the counter says it is enough");
  await next(tp, /^Continue$/, "Why do you want to lead a tribe?");
  await tp.locator("textarea[name=why]").fill(WORDS.tobi.why);
  await next(tp, /^Continue$/, "Tell us about a time you walked with someone through a hard season.");
  await tp.locator("textarea[name=walked]").fill(WORDS.tobi.walked);
  await next(tp, /^Continue$/, "How is your walk with God right now?");
  await tp.locator('label:has(input[name="walkRating"][value="3"])').click();
  await tp.locator("textarea[name=walkNote]").fill(WORDS.tobi.walkNote);
  await next(tp, /^Continue$/, "What could get in the way of leading well for twelve weeks?");
  await tp.locator("textarea[name=obstacles]").fill(WORDS.tobi.obstacles);
  await tp.getByRole("button", { name: /^Continue$/ }).click();
  await tp.getByText("Situation 1 of 6").waitFor({ timeout: 20000 });
  const tobiChecks = (await one("select count(*)::int as total, count(*) filter (where passes)::int as passed from public.leader_answer_checks where application_id = $1", [tobiApp.id]))!;
  check(tobiChecks.total === 6 && tobiChecks.passed === 5, `all five written answers were checked and passed, the short one only the second time (${tobiChecks.passed} of ${tobiChecks.total})`);

  // six situations, one best and one worst each
  for (let n = 1; n <= 6; n++) {
    await tp.getByText(`Situation ${n} of 6`).waitFor({ timeout: 10000 });
    await tp.locator("ul.stagger > li").nth(0).getByRole("button", { name: "Best" }).click();
    await tp.locator("ul.stagger > li").nth(1).getByRole("button", { name: "Worst" }).click();
    const before = await announce(tp).textContent();
    await tp.getByRole("button", { name: /^Continue$/ }).click();
    await tp.waitForFunction((b) => document.querySelector("main p.sr-only[aria-live=polite]")?.textContent !== b, before, { timeout: 15000 });
  }
  await carryOn(tp, "I lead best by");
  await choice(tp, "leadBest", "connection").click();
  await next(tp, /^Continue$/, "Who can speak for you?");
  await tp.getByLabel("Their name").fill("Pastor Ife Adeyemi");
  await tp.getByLabel("How do you know them?").fill("My unit head at church");
  await tp.getByLabel("Their phone number or email").fill("ife.adeyemi@example.org");
  await choice(tp, "referee-1-head", "yes").click();
  await next(tp, /^Continue$/, "And a second person.");
  await tp.getByLabel("Their name").fill("Sister Bola Ade");
  await tp.getByLabel("How do you know them?").fill("A friend from work");
  await tp.getByLabel("Their phone number or email").fill("bola.ade@example.org");
  await next(tp, /^Continue$/, "Here is your application.");
  await noOverflow(tp, "review");
  await tp.getByRole("button", { name: "Send my application" }).click();
  await heading(tp, /Sent, Tobi/).waitFor({ timeout: 25000 });
  check(/We are reading it now/.test(await text(tp)), "once sent, the screen says it is being read and that his referees’ links open afterwards");

  const readTobi = await until("Tobi's reading", inState(tobiApp.id as string, "clear", "held", "strengthen"));
  check(readTobi?.state === "clear" && readTobi.basis === "ai", `the first check clears a strong application (${readTobi?.state}, basis ${readTobi?.basis})`);
  check((await messagesFor(tobi, "leader_check_clear")) === 1, "…and a message tells him so");
  await open(tp, "/lead");
  const tobiPage = await text(tp);
  check((await tp.locator("#referees-heading").count()) === 1, "his referee links are open on the Lead page");
  check(!/score|flag|confidence|first check|\d\s*\/\s*5\b/i.test(tobiPage), "…and nothing on the page shows him a score, a flag or a reading");
  await noOverflow(tp, "lead page (cleared)");
  await t.ctx.close();

  // --- 4. Wale: asked to add to two answers, kindly ----------------------------------------------------------------
  const wApp = await draftAt(wale, "goal-story", {}, 2);
  const w = await newPage(browser);
  const wp = w.page;
  await signIn(wp, "wale.apply@example.org", "/lead/apply");
  await heading(wp, "Tell us your story with this goal.").waitFor({ timeout: 15000 });
  check(!NEW_WORDING.test(await text(wp)), "a draft that already agreed to the new wording is not asked again");
  await wp.locator("textarea[name=goalStory]").fill(WORDS.wale.goalStory);
  await next(wp, /^Continue$/, "Why do you want to lead a tribe?");
  await wp.locator("textarea[name=why]").fill(WORDS.wale.why);
  await next(wp, /^Continue$/, "Tell us about a time you walked with someone through a hard season.");
  await wp.locator("textarea[name=walked]").fill(WORDS.wale.thinWalked);
  await next(wp, /^Continue$/, "How is your walk with God right now?");
  await wp.locator("textarea[name=walkNote]").fill(WORDS.wale.walkNote);
  await next(wp, /^Continue$/, "What could get in the way of leading well for twelve weeks?");
  await wp.locator("textarea[name=obstacles]").fill(WORDS.wale.thinObstacles);
  check(await carryOn(wp, "Here is your application."), "the quick check lets honest but thin answers through: it asks only whether they answer the question");
  await wp.getByRole("button", { name: "Send my application" }).click();
  await heading(wp, /Sent, Wale/).waitFor({ timeout: 25000 });

  const asked = await until("Wale asked to add", inState(wApp, "strengthen", "clear", "held"));
  check(asked?.state === "strengthen", `the first check asks him to add to answers instead of holding or passing (${asked?.state})`);
  check(Object.keys(asked?.feedback ?? {}).includes("obstacles") && Object.keys(asked?.feedback ?? {}).includes("walked"), `…naming both thin answers (${Object.keys(asked?.feedback ?? {}).join(", ")})`);
  check((await messagesFor(wale, "leader_check_strengthen")) === 1, "…and a message tells him to open the application");
  check((await messagesFor(wale, "leader_check_clear")) === 0, "…and not that his referees’ links are open");

  await open(wp, "/lead");
  const asking = wp.getByTestId("first-check-strengthen");
  await asking.waitFor({ timeout: 10000 });
  const askText = await asking.innerText();
  check(/A little more would help/.test(askText) && /Add to my answers/.test(await text(wp)), "his Lead page says a little more would help, with a button to add to his answers");
  check(askText.includes("Tell us what you did and what you chose not to do") && askText.includes("who you would tell and what you would do"), "…and gives one kind note for each answer");
  check(!/score|flag|confidence|\d\s*\/\s*5\b|“/i.test(askText), "…with no score, no flag and none of his words quoted back");
  check((await wp.locator("#referees-heading").count()) === 0, "his referee links stay closed until the check is done");
  await noOverflow(wp, "lead page (asked to add)");
  await shot(wp, "3-lead-strengthen");

  await wp.getByRole("link", { name: "Add to my answers" }).click();
  await wp.getByTestId("update-note").first().waitFor({ timeout: 15000 });
  check((await wp.getByTestId("update-note").count()) === 2, "the update page shows his two answers, each with its note");
  check((await wp.locator("textarea[name=walked]").inputValue()) === WORDS.wale.thinWalked, "…each ready to edit");
  await wp.locator("textarea[name=walked]").fill("ok ok ok ok ok ok ok ok ok ok ok ok");
  await wp.getByRole("button", { name: "Send my update" }).click();
  await wp.getByTestId("answer-feedback").waitFor({ timeout: 20000 });
  check(/Change it and press Send again/.test(await wp.getByTestId("answer-feedback").innerText()), "swapping an answer for filler is turned back with a note, here as on the apply screens");
  const unchanged = await stateOf(wApp);
  check(unchanged?.state === "strengthen" && unchanged.rewrites_used === 0, "…and it costs him none of his updates");
  await noOverflow(wp, "update answers");
  await shot(wp, "4-update-feedback");
  await wp.locator("textarea[name=walked]").fill(WORDS.wale.walked);
  await wp.locator("textarea[name=obstacles]").fill(WORDS.wale.obstacles);
  await wp.getByRole("button", { name: "Send my update" }).click();
  await wp.waitForURL((u) => u.pathname === "/lead", { timeout: 25000 });
  const second = await until("Wale's second reading", async () => {
    const s = await stateOf(wApp);
    return s && s.state !== "checking" && s.rewrites_used === 1 && s.state !== "strengthen" ? s : null;
  });
  check(second?.state === "clear", `after he adds to both, the second reading clears him (${second?.state})`);
  check((await one("select count(*)::int as n from public.leader_answer_versions where application_id = $1 and round = 0", [wApp]))!.n === 2, "the two answers as first sent are kept for the panel");
  check((await messagesFor(wale, "leader_check_clear")) === 1, "…and a message says his referee links are open");
  await open(wp, "/lead");
  check((await wp.locator("#referees-heading").count()) === 1 && (await wp.getByTestId("first-check-strengthen").count()) === 0, "his referee links open and the request to add is gone");
  await w.ctx.close();

  // --- 5. Femi: three tries at the same box, then a person ----------------------------------------------------------
  // Her story is already in the draft, as for someone who started before the check existed: pressing Continue checks it.
  const fApp = await draftAt(femi, "goal-story", { goalStory: WORDS.femi.goalStory });
  const f = await newPage(browser);
  const fp = f.page;
  await signIn(fp, "femi.apply@example.org", "/lead/apply");
  await heading(fp, "Tell us your story with this goal.").waitFor({ timeout: 15000 });
  check((await fp.locator("textarea[name=goalStory]").inputValue()) === WORDS.femi.goalStory, "her draft opens with the story she had already written");
  await next(fp, /^Continue$/, "Why do you want to lead a tribe?");
  await fp.locator("textarea[name=why]").fill(WORDS.femi.junkWhy[0]);
  await fp.getByRole("button", { name: /^Continue$/ }).click();
  await fp.getByTestId("answer-feedback").waitFor({ timeout: 20000 });
  check(!/If it is still not right after that/.test(await fp.getByTestId("answer-feedback").innerText()), "after the first try she is only asked to change it");
  await fp.locator("textarea[name=why]").fill(WORDS.femi.junkWhy[1]);
  await fp.getByRole("button", { name: /^Continue$/ }).click();
  await fp.getByText(/If it is still not right after that, it will go through and a person will read it/).waitFor({ timeout: 20000 });
  check(true, "after the second try she is told, kindly, what happens if it is still not right");
  await shot(fp, "5-last-try");
  await fp.locator("textarea[name=why]").fill(WORDS.femi.junkWhy[2]);
  await next(fp, /^Continue$/, "Tell us about a time you walked with someone through a hard season.");
  check(true, "the third try goes through: nobody is stuck on a question");
  await fp.locator("textarea[name=walked]").fill(WORDS.femi.walked);
  await next(fp, /^Continue$/, "How is your walk with God right now?");
  await fp.locator('label:has(input[name="walkRating"][value="3"])').click();
  await fp.locator("textarea[name=walkNote]").fill(WORDS.femi.walkNote);
  await next(fp, /^Continue$/, "What could get in the way of leading well for twelve weeks?");
  await fp.locator("textarea[name=obstacles]").fill(WORDS.femi.obstacles);
  await carryOn(fp, "Here is your application.");
  await fp.getByRole("button", { name: "Send my application" }).click();
  await heading(fp, /Sent, Femi/).waitFor({ timeout: 25000 });

  const held = await until("Femi held", inState(fApp, "held", "clear", "strengthen"));
  check(held?.state === "held", `an answer that went through only on the third try is held for a person (${held?.state})`);
  await open(fp, "/lead");
  const heldText = await fp.getByTestId("first-check-held").innerText();
  check(/A person is reading your application/.test(heldText), "she is told a person is reading it, and that there is nothing for her to do");
  const femiPage = await text(fp);
  check(!/asdkjh|ghjkl|sdfghj|gibberish|flag|score|AI\b/i.test(femiPage), "…and nothing on her page says why, or what was read");
  check((await fp.locator("#referees-heading").count()) === 0, "her referee links wait until a person has read it");
  await noOverflow(fp, "lead page (held)");
  await shot(fp, "6-lead-held");
  await f.ctx.close();

  // --- 6. A pastor reads the held application and lets it through ----------------------------------------------------
  const p = await newPage(browser, "desktop");
  const pp = p.page;
  await signIn(pp, "pastor.ife@example.org", "/admin/leader-quality");
  await heading(pp, "Leader quality").waitFor({ timeout: 15000 });
  const heldNow = (await one("select count(*)::int as n from public.leader_ai_state where state = 'held'"))!.n as number;
  check(heldNow >= 1 && (await pp.getByTestId("count-held").innerText()).trim() === String(heldNow), `the pastor sees the applications held for a person (${heldNow}), and Femi’s is one of them`);
  const row = pp.getByTestId("held-list").getByRole("link", { name: /Femi Coker/ });
  check((await row.count()) === 1 && /Held for a person/.test(await row.innerText()), "…and it is in the list, by name, marked as held");
  await noOverflow(pp, "admin leader quality (pastor)");
  await row.click();
  await pp.getByTestId("ai-scorecard").waitFor({ timeout: 20000 });
  check(/Held for a person/.test(await pp.getByTestId("first-check-state").innerText()), "its page opens with the first check’s state");
  check(/plain checks stopped it first/.test(await pp.getByTestId("ai-scorecard").innerText()), "…and says no AI score was asked for, because the plain checks stopped it");
  await shot(pp, "7-review-held");
  await pp.getByRole("button", { name: "I have read it. Let it through" }).click();
  await pp.getByLabel(/Why \(optional\)/).fill("Read all five answers. She is a real person, the box was a bad day.");
  await pp.getByRole("button", { name: "Yes, let it through" }).click();
  await pp.waitForFunction(() => /Let through by a person/.test(document.querySelector('[data-testid="first-check-state"]')?.textContent ?? ""), null, { timeout: 20000 });
  check(true, "she lets it through, and the page now says a person did");
  const letThrough = await stateOf(fApp);
  check(letThrough?.state === "cleared_by_person" && letThrough.basis === "person" && letThrough.cleared_by !== null, "…recorded with her name, and reviewers (not the AI) give the calling score");
  check((await messagesFor(femi, "leader_check_clear")) === 1, "…and Femi is told that her referee links are open");
  await p.ctx.close();

  // --- 7. Phones: the pastor’s list, and the numbers --------------------------------------------------------------
  const m = await newPage(browser, "phone");
  await signIn(m.page, "pastor.ife@example.org", "/admin/leader-quality");
  await heading(m.page, "Leader quality").waitFor({ timeout: 15000 });
  await noOverflow(m.page, "admin leader quality (phone)");
  const passedNow = (await one("select count(*)::int as n from public.leader_ai_state where state in ('clear', 'cleared_by_person')"))!.n as number;
  check(passedNow >= 3 && (await m.page.getByTestId("count-clear").innerText()).trim() === String(passedNow), `on a phone the count of those who passed matches (${passedNow}): Tobi, Wale (by the check) and Femi (by a person) are among them`);
  await m.ctx.close();

  const runs = await all("select origin, shadow, outcome from public.leader_ai_scores where application_id = any($1::uuid[]) order by created_at", [[tobiApp.id, wApp, fApp]]);
  check(runs.length >= 4 && runs.every((r) => r.shadow === false), `every reading of the three applications was recorded (${runs.length}), none as recording-only, because the switch was On when each was sent`);

  await browser.close();
  await q.end();
  finish("leader-quality");
}
void main();
