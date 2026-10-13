import { BASE, check, finish, launch, newPage, open, signIn, text } from "../lib";

/** One step of an address, without following it: the path and query it redirects to, or null if it does not redirect. */
async function step(path: string): Promise<string | null> {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const where = res.headers.get("location");
  if (!(res.status >= 300 && res.status < 400) || !where) return null;
  const u = new URL(where, BASE);
  return u.pathname + u.search;
}

/** Follows an address step by step. True if it comes to rest (a page, or the sign-in page for a visitor), false if it goes round in circles. */
async function settles(path: string): Promise<boolean> {
  let at: string | null = path;
  for (let hops = 0; hops < 8 && at; hops++) {
    if (at.startsWith("/sign-in")) return true;
    at = await step(at);
  }
  return at === null;
}

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  await signIn(page, "member@example.org", "/home");
  await open(page, "/home");
  const body = await text(page);
  check(/Chidi|tribe|find/i.test(body), "a member sees their home page after signing in");

  // Links sent before the new names ("circle" became "tribe", "tribe" became "community") must keep working.
  const id = "3ffaf099-f83f-4cf8-8d22-f5c95a30ee3d";
  const legacy: Array<[string, string]> = [
    ["/circle", "/tribe"],
    [`/circle/choose/${id}`, `/tribe/choose/${id}`],
    ["/circle/testimony", "/tribe/testimony"],
    ["/lead/circle", "/lead/tribe"],
    ["/god/circles", "/god/tribes"],
    [`/god/circles/${id}`, `/god/tribes/${id}`],
    [`/lead/week?circle=${id}`, `/lead/week?tribe=${id}`],
    [`/lead/progress?circle=${id}`, `/lead/progress?tribe=${id}`],
    [`/tribe?tribe=${id}`, `/community?community=${id}`],
    [`/testimonies?tribe=${id}`, `/testimonies?community=${id}`],
  ];
  for (const [from, to] of legacy) {
    const first = await step(from);
    // The old query may travel along with the new one; what matters is that the page it reaches gets the new one.
    const want = new URL(to, BASE);
    const got = first ? new URL(first, BASE) : null;
    check(!!got && got.pathname === want.pathname && [...want.searchParams].every(([k, v]) => got.searchParams.get(k) === v), `the old address ${from} leads to ${to}`);
    check(await settles(from), `the old address ${from} comes to rest (does not redirect for ever)`);
  }
  // A new address must never be sent anywhere by these rules.
  check(!((await step(`/tribe?tribe=not-an-id`)) ?? "").startsWith("/community"), "an address with something other than an id is not redirected as an old link");
  check(!((await step(`/lead/week?tribe=${id}`)) ?? "").includes("circle"), "a current address keeps its own name");
  check(await settles(`/lead/week?tribe=${id}&week=3`), "a current address with a week comes to rest");

  // And in the browser: a signed-in member who follows an old link arrives on the new page, without errors.
  await page.goto(`${BASE}/circle`);
  check(new URL(page.url()).pathname === "/tribe", "a member following an old /circle link lands on /tribe");
  check((await text(page)).length > 40, "the page they land on has content");

  await browser.close();
  finish("smoke");
}
void main();
