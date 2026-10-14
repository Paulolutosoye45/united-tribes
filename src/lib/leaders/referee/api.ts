import "server-only";
import { getSession } from "@/lib/auth/session";
import { friendly, SESSION_ENDED } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "cache-control": "no-store" } as const;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" } });
}

export const problem = (message: string, status: number) => json({ ok: false, message }, status);

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Every endpoint under /api/referees begins here: another site cannot trigger it for a signed-in person, and someone who is not
 * signed in is told so. What the person may do is decided by the database, which answers for them.
 */
export async function guard(request: Request): Promise<{ supabase: Supabase } | Response> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return problem("Open this from the pastors’ list page.", 403);
  const session = await getSession();
  if (!session) return problem(SESSION_ENDED, 401);
  return { supabase: await createClient() };
}

/** A database refusal as an answer: a missing permission is a 403, a rule the person can fix is a 422, anything else is our side. */
export function refusal(error: { code?: string; message?: string }): Response {
  const status = error.code === "42501" ? 403 : error.code === "22023" || error.code === "P0002" ? 422 : 502;
  return problem(friendly(error), status);
}
