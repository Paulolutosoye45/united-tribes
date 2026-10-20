import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { recordSignIn } from "@/lib/activity/signin";
import { claimInvitations } from "@/lib/auth/after-sign-in";
import { safeNext } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "recovery", "invite", "email_change"];

/** The link inside the sign-in email lands here (the code works without it). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (!tokenHash || !type || !TYPES.includes(type)) {
    return NextResponse.redirect(`${origin}/sign-in?error=link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(`${origin}/sign-in?error=link`);

  await claimInvitations(supabase);
  await recordSignIn(supabase, "link");
  return NextResponse.redirect(`${origin}${next}`);
}
