import { NextResponse } from "next/server";
import { NO_STORE, refuse, sameOrigin } from "@/lib/ai/route";
import { getSupabaseEnv } from "@/lib/env";
import { parseTrack } from "@/lib/activity/track-body";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The one door a screen uses to tell the activity log it was opened (or that someone signed in). It answers the same way
 * whatever happens inside, so nobody learns anything from it, including whether they are the owner (who is never recorded).
 *
 * Who is asking is decided by the sign-in cookie, never by the body. The body can only pick from fixed lists, and the
 * database checks them again, caps a person at 1,500 events a day, and counts the same screen only once in twenty seconds.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse("forbidden", 403);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return refuse("unsupported", 415);
  if (!getSupabaseEnv()) return new NextResponse(null, { status: 204, headers: NO_STORE });

  const text = await request.text();
  const body = parseTrack(text);
  if (!body) return refuse("bad request", 400);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return refuse("sign in", 401);

  try {
    await supabase.rpc("activity_track", {
      p_kind: body.kind,
      p_screen: body.screen ?? null,
      p_device: body.device ?? null,
      p_method: body.method ?? null,
      p_speed: body.speed ?? null,
    });
  } catch {
    // A fault here is never the person's problem.
  }
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
