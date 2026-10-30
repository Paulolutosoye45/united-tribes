import { getSession } from "@/lib/auth/session";
import { searchGuides } from "@/lib/guides/pilot";

/**
 * "What do you want to do?" in the How to use this app button. Answers with the guides this person may open that match every word, and
 * nothing else: a visitor who is not signed in finds only the guides that open for anyone with the link. The answer is for one person,
 * so it is never kept for anyone else.
 */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80);
  const session = await getSession();
  const results = searchGuides(session?.roles ?? null, q);
  return Response.json({ results }, { headers: { "cache-control": "private, no-store" } });
}
