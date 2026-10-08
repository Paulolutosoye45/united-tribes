import { NextResponse, type NextRequest } from "next/server";
import { claimInvitations } from "@/lib/auth/after-sign-in";
import { safeNext } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/** Google sign-in lands here with a one-time code to exchange for a session. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");

  if (!code) return NextResponse.redirect(`${origin}/sign-in?error=link`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/sign-in?error=link`);

  await claimInvitations(supabase);
  return NextResponse.redirect(`${origin}${next}`);
}
