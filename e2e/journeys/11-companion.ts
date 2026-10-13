/**
 * The Companion, end to end on a phone.
 *
 * Chinwe says no to the AI service and still gets suggestions: starting sentences for her age group, chips that appear as
 * she writes, answers filled in with a reason in her own words, "Why this?" and "Not this one", suggestions that sharpen
 * after she confirms what was heard, times that fit a mother of small children, and a note on the finished form of what
 * was picked for her. None of it leaves her phone.
 *
 * Dayo lives abroad. He takes a chip off, turns suggestions off (and the choice survives a reload), turns them back on, and
 * is told, in plain words, why his tribe meets online.
 */
import type { Page } from "playwright-core";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const choice = (page: Page, name: string, value: string) => page.locator(`label.choice:has(input[name="${name}"][value="${value}"])`);
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();

async function next(page: Page, label: string | RegExp, arrivesAt: string | RegExp) {
  await page.getByRole("button", { name: label }).click();
  await heading(page, arrivesAt).waitFor({ timeout: 15000 });
}

const pressed = async (page: Page, label: string) =>
  (await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().getAttribute("aria-pressed")) === "true";

/** Set E2E_SHOTS=1 to keep a picture of each Companion screen in .e2e/shots, for looking at. */
async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `.e2e/shots/${name}.png`, fullPage: true });
}

const STORY =
  "I run a small provisions shop in Surulere and I'm a mother of two toddlers. I want to grow the business and still be home for the children. I'm quite shy at first, but I love to plan.";

async function begin(page: Page, agreeToAi: boolean) {
  await choice(page, "consent-matching", "yes").click();
  const ai = page.locator('input[name="consent-ai"]');
  if ((await ai.isChecked()) !== agreeToAi) await choice(page, "consent-ai", "yes").click();
  check((await ai.isChecked()) === agreeToAi, agreeToAi ? "agreed to the AI service" : "has not agreed to the AI service");
  await next(page, "I agree, let’s begin", "How old are you?");
}

async function aboutYou(page: Page, input: { age: string; first: string; full: string; gender: string; area?: string; zone?: string }) {
  await choice(page, "age", input.age).click();
  await next(page, "Continue", "What should we call you?");
  await page.getByLabel("First name or what you go by").fill(input.first);
  await page.getByLabel("Full name").fill(input.full);
  await next(page, "Continue", "Which describes you?");
  await choice(page, "gender", input.gender).click();
  await choice(page, "tribeMix", "mixed").click();
  await next(page, "Continue", "Where are you based?");
  if (input.area) {
    const area = page.getByRole("combobox");
    await area.fill(input.area.slice(0, 3));
    await page.getByRole("option", { name: new RegExp(input.area) }).first().click();
  }
  if (input.zone) await choice(page, "zone", input.zone).click();
  await next(page, "Continue", "Tell us about your season.");
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  async function person(email: string, name: string) {
    const made = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]))!.id as string;
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [made, name, name.split(" ")[0]]);
    return made;
  }
  const chinwe = await person("chinwe.companion@example.org", "Chinwe Okoro");
  const dayo = await person("dayo.companion@example.org", "Dayo Bello");
  const browser = await launch();

  // --- 1. Chinwe: no AI service, and still helped ------------------------------------------------------------------
  const a = await newPage(browser);
  const page = a.page;
  await signIn(page, "chinwe.companion@example.org", "/join");
  await open(page, "/join");
  check(/Your Companion/.test(await text(page)), "the welcome screen introduces the Companion, and says it can be turned off");
  await begin(page, false);
  await aboutYou(page, { age: "33-40", first: "Chinwe", full: "Chinwe Okoro", gender: "female", area: "Surulere" });

  // story: starters, then chips as she writes
  const starters = page.locator("button.cmp-starter");
  check((await starters.count()) >= 3, `the story step offers starting sentences written for her age group (${await starters.count()})`);
  const first = (await starters.first().innerText()).trim();
  await starters.first().click();
  check((await page.locator("textarea[name=story]").inputValue()) === first, "tapping one puts it in the box to be made her own");
  const listening = page.getByRole("region", { name: "What your Companion has picked up" });
  await listening.waitFor({ timeout: 5000 });
  check((await listening.locator(".cmp-chip").count()) >= 1, "…and the Companion has already understood it: chips appear as she writes");

  await page.locator("textarea[name=story]").fill(STORY);
  await listening.locator(".cmp-chip", { hasText: "Own business" }).waitFor({ timeout: 5000 });
  const chips = (await listening.locator(".cmp-chip").allInnerTexts()).map((t) => t.trim());
  check(chips.includes("Own business") && chips.includes("Young children") && chips.includes("Growing a business"), `her own words become chips (${chips.join(", ")})`);
  check(/Your words do not go to any AI service/.test(await text(page)), "the screen says plainly that her words stay on her phone");
  check((await page.locator("button.cmp-starter").count()) === 0, "the starting sentences make way once she is writing");
  await noOverflow(page, "story step");
  await shot(page, "1-story");
  await next(page, "Continue", "Here is what we heard.");

  // heard: filled with a reason, questionable, correctable
  await page.getByRole("button", { name: /^Own business/ }).waitFor({ timeout: 5000 });
  check(await pressed(page, "Own business"), "“I run a small provisions shop” was heard as running her own business, and is already ticked");
  check(await pressed(page, "Children under 12"), "“two toddlers” was heard as children under 12");
  check(!(await pressed(page, "Trade and retail")) && (await page.getByRole("button", { name: /^Trade and retail \(suggested\)/ }).count()) === 1, "a fainter hint, her field, is suggested with a sparkle but not ticked for her");
  check((await page.locator(".cmp-tag").count()) >= 2, "what was filled in for her is marked “Picked for you”");
  check(/You wrote “I run a small provisions shop”/.test(await text(page)), "…with her own words as the reason");
  check((await page.getByRole("button", { name: /^Married/ }).count()) === 1 && !(await pressed(page, "Married")), "nothing about her marriage was guessed");
  await shot(page, "2-heard");
  await page.getByRole("button", { name: /^Trade and retail/ }).click();
  check(await pressed(page, "Trade and retail"), "she can tap the suggested field to accept it");
  await page.getByRole("button", { name: /Not this one \(your work\)/ }).click();
  check(!(await pressed(page, "Own business")) && (await page.getByRole("button", { name: /Not this one \(your work\)/ }).count()) === 0, "“Not this one” takes the pick back");
  await page.getByRole("button", { name: /^Own business/ }).click();
  check(await pressed(page, "Own business"), "…and she can still choose it herself");
  await next(page, "Continue", "Which community feels like home right now?");

  // community: sharper now that she has confirmed what was heard
  const suggestedCommunities = page.getByRole("radiogroup", { name: "Suggested communities" });
  await suggestedCommunities.waitFor({ timeout: 5000 });
  check(await suggestedCommunities.locator('input[value="business-entrepreneurship"]').isChecked(), "after she confirmed her work and children, Business & Entrepreneurship is picked for her");
  check((await suggestedCommunities.locator("label.choice").count()) >= 2 && (await suggestedCommunities.locator('input[value="parents-family"]').count()) === 1, "…and Parents & Family is offered beside it, because she is both");
  check(/Because you run your own business/.test(await text(page)), "the reason says what she told us");
  await shot(page, "3-community");
  await page.getByRole("button", { name: /^Why this\?/ }).first().click();
  check((await page.locator("ul.list-disc li").count()) >= 2, "“Why this?” lists what the pick went on");
  await page.getByRole("button", { name: /^Not this one/ }).first().click();
  check(!(await suggestedCommunities.locator('input[value="business-entrepreneurship"]').count()), "“Not this one” removes it from the suggestions, and it is not offered again");
  check(await page.getByRole("button", { name: "Continue" }).isDisabled(), "…and nothing is chosen for her instead");
  await choice(page, "community", "parents-family").click();
  check(await page.getByRole("button", { name: "Continue" }).isEnabled(), "she chooses Parents & Family herself");
  await next(page, "Continue", "Where are you on your walk with God?");
  await choice(page, "faith", "growing").click();
  await next(page, "Continue", "What do you want to move forward this season?");

  // goal: suggestions for the community she chose
  const goals = page.getByRole("radiogroup", { name: "Suggested goals" });
  await goals.waitFor({ timeout: 5000 });
  check((await goals.locator("label.choice").count()) >= 1, "goals for her community are suggested too");
  await shot(page, "4-goal");
  await goals.locator("label.choice").first().click();
  await next(page, "Continue", "In twelve weeks, what would you love to say?");

  // success: pictures to start from, and an honest scale
  const outcomes = page.locator("button.cmp-starter", { hasText: /^By week 12/ });
  check((await outcomes.count()) >= 2, `pictures of success to start from are offered (${await outcomes.count()})`);
  const pictured = (await outcomes.nth(1).innerText()).trim();
  await outcomes.nth(1).click();
  check((await page.locator("textarea[name=successStatement]").inputValue()) === pictured, "tapping one puts it in the box to be changed");
  await shot(page, "5-success");
  await page.getByRole("radiogroup", { name: "Where you are on this goal today" }).getByText("2", { exact: true }).click();
  await next(page, "Continue", "How and when could you meet?");

  // rhythm: times that fit a mother of small children
  await page.getByRole("radiogroup", { name: "How you would like to meet" }).getByText("Online", { exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("label.choice.suggested input:checked").length >= 2, null, { timeout: 5000 });
  check(true, "suggested meeting times are ticked as soon as she chooses how");
  check(/children/i.test(await page.locator("label.choice.suggested").allInnerTexts().then((t) => t.join(" "))), "…and they are timed around her children");
  check(/I ticked the times that suit what you told me/.test(await text(page)), "the screen says it ticked them");
  await shot(page, "6-rhythm");
  await next(page, "Continue", "This or that?");

  // style: a gift picked from her words, and a guess she can take in one tap
  const roles = page.locator('[role=group][aria-labelledby="roles-heading"] button[aria-pressed=true]');
  check((await roles.allInnerTexts()).some((t) => /Organiser/.test(t)), "“I love to plan” picked Organiser as her gift in a group");
  check((await page.getByRole("button", { name: /^Why this\?/ }).count()) >= 1, "…with a reason");
  await shot(page, "7-style");
  const taps = page.getByRole("button", { name: "Use my suggested taps" });
  check((await taps.count()) === 1, "one this-or-that pair has a guess, and she can take it with one tap");
  check((await page.locator('[role=group] button[aria-pressed=true]').count()) === (await roles.count()), "…but none is chosen for her");
  await taps.click();
  check((await taps.count()) === 0 && (await page.locator('button:has-text("A clear plan")[aria-pressed=true]').count()) === 1, "taking it ticks “A clear plan” and nothing else");
  await next(page, "Continue", "Anything you would like us to know?");
  await next(page, "Skip for now", "How should we reach you?");
  await next(page, "Skip for now", "Here is what we have.");

  // review and finish
  check((await page.locator(".cmp-tag").count()) >= 2, "the review marks what the Companion filled in and she kept");
  await noOverflow(page, "review step");
  await shot(page, "8-review");
  await page.getByRole("button", { name: "Save my answers" }).click();
  await page.getByRole("heading", { name: /You’re in, Chinwe/ }).waitFor({ timeout: 20000 });
  check(/Your Companion filled in \d+ answers? for you/.test(await text(page)), "the last screen says how much the Companion filled in");

  // --- 2. what was kept ---------------------------------------------------------------------------------------------
  const p = (await one("select mp.ai_assist, mp.relationship, mp.work_status, mp.work_field, mp.children, mp.group_roles from public.member_profiles mp where person_id = $1", [chinwe]))!;
  const assist = (p.ai_assist ?? {}) as Record<string, { shown: string[]; chosen?: string | null; kept?: string[]; via?: string; auto?: boolean }>;
  check(p.work_status === "self_employed" && p.work_field === "trade_retail" && (p.children as string[]).join() === "under_12" && p.relationship === null, `her answers are saved as she settled them (${p.work_status}, ${p.work_field}, ${JSON.stringify(p.children)}, ${p.relationship})`);
  check(assist.community?.via === "engine" && assist.community.shown.includes("business-entrepreneurship") && assist.community.chosen === "parents-family", "the quality log records that the Companion proposed Business and she chose Parents & Family");
  check(assist.children?.auto === true && assist.children.kept?.join() === "under_12", "…and that it filled in her children and she kept it");
  check(assist.group_roles?.auto === true && assist.group_roles.kept?.includes("organiser") === true, "…and her group gift");
  const words = JSON.stringify(assist);
  check(!/provisions|toddlers|Surulere|shop/i.test(words), "the log holds ids only, never her words");
  const calls = await one("select count(*)::int as n from public.ai_calls where person_id = $1", [chinwe]);
  check(calls?.n === 0, "she made no request to any AI service at all");
  const consent = await one("select count(*)::int as n from public.consents where person_id = $1 and purpose = 'ai_assist' and granted", [chinwe]);
  check(consent?.n === 0, "…and never agreed to one");
  await a.ctx.close();

  // --- 3. Dayo: take a chip off, turn it off, turn it on ----------------------------------------------------------
  const b = await newPage(browser);
  const dp = b.page;
  await signIn(dp, "dayo.companion@example.org", "/join");
  await open(dp, "/join");
  await begin(dp, false);
  await aboutYou(dp, { age: "26-32", first: "Dayo", full: "Dayo Bello", gender: "male", zone: "abroad" });

  await dp.locator("textarea[name=story]").fill("I work in tech in Toronto and I miss home.");
  const card = dp.getByRole("region", { name: "What your Companion has picked up" });
  await card.locator(".cmp-chip", { hasText: "Technology" }).waitFor({ timeout: 5000 });
  await card.getByRole("button", { name: "Not me: Technology" }).click();
  check((await card.locator(".cmp-chip", { hasText: "Technology" }).count()) === 0, "a chip that is not him comes off with one tap");

  await dp.getByRole("button", { name: "Turn them off" }).click();
  check(/Suggestions are off/.test(await text(dp)) && (await card.count()) === 0, "he can turn suggestions off");
  check((await dp.evaluate(() => window.localStorage.getItem("ut-companion"))) === "off", "…and the choice is kept on his phone");
  await dp.reload();
  await heading(dp, "Tell us about your season.").waitFor({ timeout: 15000 });
  check(/Suggestions are off/.test(await text(dp)), "…it survives a reload");
  await dp.locator("textarea[name=story]").fill("I work in tech in Toronto and I miss home.");
  check((await dp.locator("button.cmp-starter").count()) === 0 && (await dp.getByRole("region", { name: "What your Companion has picked up" }).count()) === 0, "with suggestions off, nothing is read and no chips appear");
  await next(dp, "Continue", "A little more about you.");
  check((await dp.locator("button[aria-pressed=true]").count()) === 0 && (await dp.locator(".cmp-tag").count()) === 0, "…and nothing is filled in on the next screen");
  await next(dp, "Skip for now", "Which community feels like home right now?");
  check((await dp.getByRole("radiogroup", { name: "Suggested communities" }).count()) === 0 && (await dp.locator('input[name="community"]').count()) >= 12, "the communities are a plain list");

  await dp.getByRole("button", { name: "Turn them on" }).click();
  const suggested = dp.getByRole("radiogroup", { name: "Suggested communities" });
  await suggested.waitFor({ timeout: 5000 });
  check(await suggested.locator('input[value="global-citizens"]').isChecked(), "turned back on, Global Citizens is picked for him, because he lives abroad");
  await next(dp, "Continue", "Where are you on your walk with God?");
  await choice(dp, "faith", "growing").click();
  await next(dp, "Continue", "What do you want to move forward this season?");
  await dp.locator("label.choice").first().click();
  await next(dp, "Continue", "In twelve weeks, what would you love to say?");
  await dp.getByRole("radiogroup", { name: "Where you are on this goal today" }).getByText("3", { exact: true }).click();
  await next(dp, "Continue", "How and when could you meet?");
  check(await dp.locator('input[name="meetingMode"][value="online"]').isChecked(), "his tribe is set to meet online without his having to say so");
  check(/Because you’re based outside Nigeria, your tribe meets online/.test(await text(dp)), "…and the screen says why");
  check((await dp.getByRole("button", { name: "Continue" }).isEnabled()), "…and he can carry on");
  await noOverflow(dp, "rhythm step");
  await b.ctx.close();
  void dayo;

  await browser.close();
  await q.end();
  finish("companion");
}
void main();
