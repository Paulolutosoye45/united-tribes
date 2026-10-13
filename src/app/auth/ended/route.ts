import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Where someone is sent when their browser still holds a valid sign-in but the person it was issued to is no longer here
 * (the account was deleted). Their sign-in is cleared in this browser and they land on the sign-in page with a plain
 * explanation, instead of being bounced between "home" and "sign in" until the token runs out.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  // "local": clear the cookies here. There is nothing to revoke at the other end, the account is gone.
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(`${request.nextUrl.origin}/sign-in?ended=1`, { headers: { "cache-control": "no-store" } });
}
