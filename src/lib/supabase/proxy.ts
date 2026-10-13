import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Refreshes the sign-in session on each request and says whether the visitor
 * is signed in. getClaims() checks the token's signature, so a forged cookie
 * does not count as signed in.
 */
export async function updateSession(request: NextRequest, requestHeaders?: Headers) {
  const env = getSupabaseEnv();
  // `requestHeaders` carries what the proxy adds for the page to read (the CSP nonce).
  const forward = () => NextResponse.next({ request: requestHeaders ? { headers: requestHeaders } : request });
  let response = forward();
  if (!env) return { response, signedIn: false, configured: false as const };

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  return { response, signedIn: Boolean(data?.claims?.sub), configured: true as const };
}
