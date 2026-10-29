/**
 * The smart form end to end, on a phone: a member types an area and the zone follows; speaks a voice note
 * and gets words back; sees what the assistant "heard" and corrects it; chooses a second community; gets a drafted
 * week-12 sentence and suggested meeting times; picks the part they play in a group; writes private notes that
 * are sealed before they reach the database; chooses how to be reached; and finally sees a tribe whose leader
 * has a portrait. The leader then sees the member's brief, including the private note, and nobody else's page does.
 */
import path from "node:path";
import type { Page } from "playwright-core";

type Row = Record<string, unknown>;
import { BASE, check, db, finish, launch, newPage, noOverflow, open, settle, signIn, text } from "../lib";

const NOTE_FOR_US = "Mama passed in March and I still cry in the car";
const NOTE_FOR_LEADER = "I am shy at first, so please start with a short message";

const choice = (page: Page, name: string, value: string) => page.locator(`label.choice:has(input[name="${name}"][value="${value}"])`);
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();

/** Taps the big button at the bottom, then waits for the next heading. */
async function next(page: Page, label: string | RegExp, arrivesAt: string | RegExp) {
  await page.getByRole("button", { name: label }).click();
  await heading(page, arrivesAt).waitFor({ timeout: 15000 });
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Row[];
  async function person(email: string, name: string, roles: string[] = []) {
    const made = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]))!.id as string;
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [made, name, name.split(" ")[0]]);
    for (const role of roles) {
      await q.query("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [made, role]);
    }
    return made;
  }

  // --- arrange: a leader with an approved tribe that fits the member we are about to create ---------------------
  const bisi = await person("bisi.lead@example.org", "Bisi Adeleke", ["leader"]);
  await q.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [bisi]);
  const tobi = await person("tobi.intake@example.org", "Tobi Adeyemi");
  await q.query(
    `insert into public.tribes (season_id, leader_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story, meeting_day, meeting_time, slot,
        meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     select (select id from public.seasons order by starts_on limit 1), $1, 'approved', 'Bisi’s Builders', (select id from public.tracks where slug = 'builders'),
        (select id from public.communities where slug = 'professionals'), (select id from public.season_goals where slug = 'step-into-a-leadership-role'),
        '{}', 'mixed', 'A tribe for people growing at work without losing their peace, long enough to be a real story.', 3, '20:00', 'weeknight-evening',
        'online', 'mainland', 'Online', 12, 'Pray daily for each other.', 'Call each other weekly.', 'Take one step a week.', now()`, [bisi]);

  const browser = await launch();

  // --- 1. the leader adds a portrait ---------------------------------------------------------------------------
  const lead = await newPage(browser);
  await signIn(lead.page, "bisi.lead@example.org", "/profile");
  await open(lead.page, "/profile");
  check(await heading(lead.page, "Your photo").isVisible(), "a tribe leader’s profile page has a “Your photo” card");
  const plain = await newPage(browser);
  await signIn(plain.page, "member@example.org", "/profile");
  await open(plain.page, "/profile");
  check((await plain.page.getByRole("heading", { name: "Your photo" }).count()) === 0, "an ordinary member does not see the photo card");
  await plain.ctx.close();

  await lead.page.locator('[data-testid="photo-file"]').setInputFiles(path.resolve(__dirname, "../fixtures/portrait.png"));
  await lead.page.getByText("Saved. Members see it on your tribe card.").waitFor({ timeout: 15000 });
  const photo = await one("select mime, octet_length(data) as bytes, encode(substring(data from 1 for 3), 'hex') as magic from public.person_photos where person_id = $1", [bisi]);
  check(photo?.mime === "image/jpeg" && photo.magic === "ffd8ff", "the picture is stored as a JPEG");
  check(Number(photo?.bytes) > 1000 && Number(photo?.bytes) <= 150000, `a 900×600 photo was shrunk in the browser to ${photo?.bytes} bytes`);
  check((await lead.page.locator('[data-testid="avatar-photo"]').count()) === 1, "the card shows the new portrait straight away");

  // --- 2. a member walks the whole form ------------------------------------------------------------------------
  const member = await newPage(browser, "phone", { permissions: ["microphone"] });
  const page = member.page;
  await signIn(page, "tobi.intake@example.org", "/join");
  await open(page, "/join");
  check(await heading(page, "Let’s find your tribe.").isVisible(), "a new member starts on the welcome screen");
  const welcome = await text(page);
  check(/locked so only you can read it/.test(welcome) && /note you write to them/.test(welcome), "the welcome screen says who sees what, including the locked notes");
  await choice(page, "consent-matching", "yes").click();
  await choice(page, "consent-ai", "yes").click();
  await next(page, "I agree, let’s begin", "How old are you?");

  // age
  await choice(page, "age", "33-40").click();
  await choice(page, "openToAdjacent", "yes").click();
  check(await page.locator('input[name="openToAdjacent"]').isChecked(), "“also happy in the age group before or after” can be ticked");
  await next(page, "Continue", "What should we call you?");

  // name
  await page.getByLabel("First name or what you go by").fill("Tobi");
  await page.getByLabel("Full name").fill("Tobi Adeyemi");
  await next(page, "Continue", "Which describes you?");

  // gender
  await choice(page, "gender", "male").click();
  await choice(page, "tribeMix", "mixed").click();
  await next(page, "Continue", "Where are you based?");

  // where: type, pick, and the zone follows
  const area = page.getByRole("combobox");
  await area.fill("Yab");
  await page.getByRole("option", { name: /Yaba/ }).waitFor({ timeout: 5000 });
  check(true, "typing “Yab” offers Yaba from the list");
  await page.getByRole("option", { name: /Yaba/ }).click();
  check((await area.inputValue()) === "Yaba", "choosing it fills the box");
  check(await page.locator('input[name="zone"][value="mainland"]').isChecked(), "…and the zone follows: Lagos Mainland");
  await noOverflow(page, "where step");
  await next(page, "Continue", "Tell us about your season.");

  // story: a voice note becomes words
  const mic = page.getByRole("button", { name: "Record a voice note, up to one minute" });
  await mic.waitFor({ timeout: 5000 });
  check(true, "the story step offers a voice note when transcription is set up");
  await mic.click();
  await page.getByRole("button", { name: "Stop recording" }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.waitForFunction(() => (document.querySelector("textarea[name=story]") as HTMLTextAreaElement | null)?.value.includes("Yaba"), null, { timeout: 20000 });
  const story = await page.locator("textarea[name=story]").inputValue();
  check(/bank/.test(story) && /Married/.test(story), "the recording came back as words in the story box");
  const voice = await one("select count(*)::int as n, bool_or(fallback) as fell from public.ai_calls where person_id = $1 and field = 'voice'", [tobi]);
  check(voice?.n === 1 && voice.fell === false, "the voice note is logged once, with no text");
  await next(page, "Continue", "Here is what we heard.");

  // heard: the assistant read the story; the person corrects it
  const pressed = async (label: string) => (await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().getAttribute("aria-pressed")) === "true";
  await page.getByRole("button", { name: /^Married/ }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll("button[aria-pressed=true]").length >= 3, null, { timeout: 15000 }).catch(() => {});
  check(await pressed("Married"), "the story’s “Married” was heard and is already ticked");
  check(await pressed("Children under 12"), "“two small kids” was heard as children under 12");
  check(await pressed("Employed"), "working in a bank was heard as employed");
  check(await pressed("Banking and finance"), "…in banking and finance");
  check((await page.getByRole("button", { name: /^Widowed/ }).count()) === 1 && !(await pressed("Widowed")), "painful answers such as Widowed are there to choose but never suggested");
  await page.getByRole("button", { name: /^Employed/ }).click();
  await page.getByRole("button", { name: /^Own business/ }).click();
  check((await pressed("Own business")) && !(await pressed("Employed")), "the person can change what was heard");
  await page.getByRole("button", { name: /^Own business/ }).click();
  await page.getByRole("button", { name: /^Employed/ }).click();
  await next(page, "Continue", "Which community feels like home right now?");

  // community + a second choice
  await choice(page, "community", "professionals").click();
  await heading(page, "A second choice?").waitFor({ timeout: 5000 });
  const second = page.locator('[role=group][aria-labelledby="second-heading"] button');
  check((await second.count()) === 10, "every other community is offered as a second choice");
  if ((await second.locator("xpath=self::*[@aria-pressed='true']").count()) === 0) await second.first().click();
  const secondName = (await page.locator('[role=group][aria-labelledby="second-heading"] button[aria-pressed=true]').first().innerText()).replace(/\s*\(suggested\)/, "").trim();
  check(secondName.length > 0 && secondName !== "Professionals", `a second community is chosen: ${secondName}`);
  await next(page, "Continue", "Where are you on your walk with God?");

  // faith, goal
  await choice(page, "faith", "growing").click();
  await next(page, "Continue", "What do you want to move forward this season?");
  await choice(page, "goal", "step-into-a-leadership-role").click();
  await next(page, "Continue", "In twelve weeks, what would you love to say?");

  // success: a drafted sentence
  const success = page.locator("textarea[name=successStatement]");
  await page.waitForFunction(() => (document.querySelector("textarea[name=successStatement]") as HTMLTextAreaElement | null)?.value.startsWith("By week 12"), null, { timeout: 15000 });
  const drafted = await success.inputValue();
  check(/^By week 12, .*leadership role/.test(drafted), `a sentence is drafted from the goal: “${drafted}”`);
  await success.fill(`${drafted.replace(/\.$/, "")}, and still have my peace.`);
  check(await page.getByRole("button", { name: "Use the suggestion again" }).isVisible(), "an edited sentence offers “Use the suggestion again”");
  await page.getByRole("radiogroup", { name: "Where you are on this goal today" }).getByText("3", { exact: true }).click();
  await next(page, "Continue", "How and when could you meet?");

  // rhythm: suggested times
  await page.getByRole("radiogroup", { name: "How you would like to meet" }).getByText("Online", { exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("label.choice.suggested").length >= 2, null, { timeout: 5000 });
  // The Companion ticks them in the render after the suggestions appear, so wait for the ticks rather than read them in the same instant.
  await page.waitForFunction(() => document.querySelectorAll("label.choice.suggested input:checked").length >= 2, null, { timeout: 5000 }).catch(() => undefined);
  const suggestedTimes = await page.locator("label.choice.suggested input:checked").count();
  check(suggestedTimes >= 2, `${suggestedTimes} meeting times are suggested and already ticked`);
  check(/traffic|evening|weeknight|Sunday/i.test(await page.locator("label.choice.suggested").first().innerText()), "each suggestion says why");
  await next(page, "Continue", "This or that?");

  // style + roles
  const roleGroup = page.locator('[role=group][aria-labelledby="roles-heading"] button');
  check((await roleGroup.count()) === 8, "eight group roles are offered");
  const auto = await page.locator('[role=group][aria-labelledby="roles-heading"] button[aria-pressed=true]').allInnerTexts();
  check(auto.some((t) => /Peacemaker/.test(t)), `the story’s “peace” suggests Peacemaker (${auto.join(", ").replace(/\s*\(suggested\)/g, "")})`);
  await roleGroup.filter({ hasText: "Host" }).click();
  await roleGroup.filter({ hasText: "Thinker" }).click();
  check((await page.locator('[role=group][aria-labelledby="roles-heading"] button[aria-pressed=true]').count()) === 2, "no more than two roles stay chosen");
  await next(page, "Continue", "Anything you would like us to know?");

  // care: private notes
  await page.getByRole("button", { name: "I am grieving" }).click();
  await page.getByRole("button", { name: "A quieter, smaller tribe" }).click();
  await page.locator("textarea[name=supportNote]").fill(NOTE_FOR_US);
  await page.locator("textarea[name=leaderNote]").fill(NOTE_FOR_LEADER);
  await page.getByRole("radiogroup", { name: "Open to leading a tribe" }).getByText("Maybe later").click();
  check(/Only you can read what you choose here/.test(await text(page)), "the care screen says in plain words who reads what");
  await next(page, "Continue", "How should we reach you?");

  // autosave: the sealed draft never holds the words
  let draft: Row | undefined;
  for (let i = 0; i < 20; i++) {
    draft = await one("select sealed is not null as sealed, answers::text as answers, coalesce(sealed, '') as sealed_text from public.intake_drafts where person_id = $1", [tobi]);
    if (draft?.sealed) break;
    await page.waitForTimeout(500);
  }
  check(draft?.sealed === true, "the draft saved on the way holds the private notes only in sealed form");
  const draftText = `${draft?.answers}${draft?.sealed_text}`;
  check(!draftText.includes("Mama") && !draftText.includes("shy at first") && !/grief/i.test(String(draft?.answers)), "…and neither the answers column nor the sealed text shows a single word of them");

  // contact
  await page.locator('input[name="phone"]').fill("0803 987 6543");
  check(await page.locator('input[name="emailOk"]').isChecked(), "email is on by default, because the sign-in address is already known");
  await choice(page, "whatsappOk", "on").click();
  const preferred = page.getByRole("radiogroup", { name: "Preferred way" });
  await preferred.getByText("WhatsApp", { exact: true }).click();
  await next(page, "Continue", "Here is what we have.");
  const review = await text(page);
  check(/Yaba/.test(review) && /Professionals/.test(review), "the review shows the area and community");
  check(!review.includes("Mama passed"), "the review does not print the private care note");
  await noOverflow(page, "review step");
  await page.getByRole("button", { name: "Save my answers" }).click();
  await page.getByRole("heading", { name: /You’re in, Tobi/ }).waitFor({ timeout: 20000 });
  check(true, "saving finishes with “You’re in, Tobi.”");

  // --- 3. what the database now holds ------------------------------------------------------------------------
  const p = (await one(
    `select mp.*, (select slug from public.communities where id = mp.community_id) as community_slug, (select slug from public.communities where id = mp.second_community_id) as second_slug
       from public.member_profiles mp where person_id = $1`, [tobi]))!;
  check(p.area_slug === "yaba" && p.zone === "mainland", "area and zone are saved: Yaba, Lagos Mainland");
  check(p.relationship === "married" && (p.children as string[]).join() === "under_12" && p.work_status === "employed" && p.work_field === "finance", `relationship, children, work and field are saved as corrected (${p.relationship}, ${JSON.stringify(p.children)}, ${p.work_status}, ${p.work_field})`);
  check(p.open_to_adjacent === true, "“open to an adjacent age group” is saved");
  check(p.second_slug && p.second_slug !== p.community_slug, `the second community is saved (${p.second_slug})`);
  check(Array.isArray(p.group_roles) && (p.group_roles as string[]).length === 2 && (p.group_roles as string[]).includes("host"), "two group roles are saved");
  check(/^By week 12, .*peace\.$/.test(String(p.success_statement)), "the edited success sentence is saved");
  check(p.support_load === 2, "the matching engine learns one thing from the private note: a hard season (2), nothing more");
  const sealed = /^e2e1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  check(sealed.test(String(p.support_enc)) && sealed.test(String(p.leader_note_enc)), "both private notes are stored as sealed tokens");
  const everywhere = (await one(
    `select (select count(*) from public.member_profiles where row_to_json(member_profiles)::text ~* 'Mama passed|shy at first|grieving|grief')
          + (select count(*) from public.intake_drafts where row_to_json(intake_drafts)::text ~* 'Mama passed|shy at first|grieving|grief')
          + (select count(*) from public.event_log where meta::text ~* 'Mama passed|shy at first|grieving|grief')
          + (select count(*) from public.ai_calls where row_to_json(ai_calls)::text ~* 'Mama passed|shy at first|grieving|grief') as n`))!;
  check(Number(everywhere.n) === 0, "none of the private words appear in profiles, drafts, the audit log or the assistant log");
  check(!(await one("select 1 from public.intake_drafts where person_id = $1", [tobi])), "the draft is gone once the answers are saved");
  const assist = (p.ai_assist ?? {}) as Record<string, { shown: string[]; chosen: string | null; kept?: string[] }>;
  check(Boolean(assist.community && assist.community_second && assist.relationship && assist.children && assist.group_roles && assist.meeting_times), `the quality log records what was suggested and what was kept (${Object.keys(assist).join(", ")})`);
  check(assist.children?.shown.includes("under_12") && assist.children.kept?.join() === "under_12", "…including that “children under 12” was shown and kept");
  check(assist.success_sentence === undefined, "…and a sentence the assistant did not change is not counted as an assistant draft");
  const noPrivate = JSON.stringify(assist);
  check(!/Mama|shy|grief/i.test(noPrivate), "…without a word of the private notes");
  const contact = (await one("select phone, preferred from public.contact_preferences where person_id = $1", [tobi]))!;
  check(contact.phone === "+2348039876543" && contact.preferred === "whatsapp", "the number is saved in international form with WhatsApp preferred");
  const ledger = await all("select purpose, granted from public.consents where person_id = $1 and purpose in ('whatsapp', 'email') order by id", [tobi]);
  check(ledger.some((r) => r.purpose === "whatsapp" && r.granted === true) && !ledger.some((r) => r.purpose === "email" && r.granted === false), "WhatsApp consent is in the ledger and email has not been opted out");
  const calls = await all("select field from public.ai_calls where person_id = $1 order by field", [tobi]);
  const fields = new Set(calls.map((c) => c.field as string));
  check(["voice", "community", "success_sentence"].every((f) => fields.has(f)), `the assistant log has one row per request (${[...fields].join(", ")}) and no text`);

  // --- 4. the member sees a tribe with the leader’s portrait -------------------------------------------------
  await open(page, "/tribe");
  const card = page.getByRole("article").filter({ hasText: "Bisi’s Builders" }).first();
  await card.waitFor({ timeout: 20000 }).catch(async (e) => {
    console.log("--- /tribe showed:\n" + (await text(page)).split("\n").slice(0, 40).join("\n"));
    const prof = await one("select * from public.member_profiles where person_id = $1", [tobi]);
    const circ = await all("select id, season_id, status, zone, slot, meeting_mode, community_id, track_id, fixed, published_at from public.tribes");
    console.log("--- profile:", JSON.stringify({ ...prof, support_enc: "…", leader_note_enc: "…" }), "\n--- tribes:", JSON.stringify(circ));
    console.log("--- candidates:", JSON.stringify(await all("select * from public.match_candidates($1)", [tobi])));
    console.log("--- runs:", JSON.stringify(await all("select candidates, shown from public.match_runs where person_id = $1", [tobi])));
    throw e;
  });
  check(true, "the member’s three-tribe screen shows Bisi’s tribe");
  const avatar = card.locator('[data-testid="avatar-photo"]');
  check((await avatar.count()) === 1, "its card carries the leader’s portrait");
  const loaded = await avatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0).catch(() => false);
  check(loaded, "…and the portrait actually loads");
  const served = await member.ctx.request.get(`${BASE}/api/photo/${bisi}`);
  check(served.status() === 200 && served.headers()["content-type"] === "image/jpeg" && served.headers()["cache-control"]?.startsWith("private"), "the photo route serves a signed-in member a private JPEG");
  const stranger = await fetch(`${BASE}/api/photo/${bisi}`);
  check(stranger.status === 401 || stranger.status === 404, `…and refuses someone who is not signed in (${stranger.status})`);
  check((await member.ctx.request.get(`${BASE}/api/photo/not-a-person`)).status() === 404, "…and a made-up id is a plain 404");
  await noOverflow(page, "tribe cards");

  // join
  await card.getByRole("link", { name: "Choose this tribe" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Join this tribe" }).click();
  await page.waitForURL((u) => u.pathname === "/tribe", { timeout: 15000 });
  await settle(page);
  check(!!(await one("select 1 from public.tribe_members where person_id = $1 and status = 'active'", [tobi])), "the member joins the tribe");

  // --- 5. the leader’s brief ---------------------------------------------------------------------------------
  await open(lead.page, "/lead/tribe");
  await lead.page.getByTestId("member-brief").first().waitFor({ timeout: 15000 });
  const brief = await lead.page.getByTestId("member-brief").first().innerText();
  check(/Host/.test(brief) && /By week 12, Tobi hopes to say/.test(brief) && /peace/.test(brief), "the leader sees the part Tobi plays in a group and his week-12 sentence");
  check((await lead.page.getByTestId("leader-note").innerText()).includes(NOTE_FOR_LEADER), "…and the private note written for the leader, opened on the server");
  const leadPage = await text(lead.page);
  check(!leadPage.includes("Mama passed") && !/grieving/i.test(leadPage), "…but never the care note, which only the member can open");
  check(!(await lead.page.content()).includes("e2e1."), "no sealed token is in the leader’s page source");
  await noOverflow(lead.page, "leader roster");

  await browser.close();
  await q.end();
  finish("intake");
}
void main();
