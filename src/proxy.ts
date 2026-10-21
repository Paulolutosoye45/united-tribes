import { NextResponse, type NextRequest } from "next/server";
import { BROWSER_COOKIE, BROWSER_COOKIE_SECONDS, isBrowserMarker, newBrowserMarker, wantsMarker } from "@/lib/leaders/referee/marker";
import { buildCsp, cspHeaderName, makeNonce } from "@/lib/security/csp";
import { turnstileScriptUrl, turnstileSiteKey } from "@/lib/security/turnstile";
import { updateSession } from "@/lib/supabase/proxy";

/** Pages anyone can open without signing in. */
const PUBLIC_PREFIXES = ["/sign-in", "/auth", "/design", "/brand", "/icon", "/apple-icon", "/privacy", "/reference", "/r", "/placed", "/e", "/guardian", "/manifest.webmanifest", "/sw.js", "/offline"];

/**
 * Called by a service, not a person: the sign-in hook, the scheduler, the monitor, the message providers, and the optional
 * WhatsApp sender (inbound messages and receipts). Each proves itself with a signature or secret instead.
 * Two are called by a person who is not signed in yet, because that is what signing in is: asking for a WhatsApp code
 * (request-code, which checks the bot token and the limits itself) and asking whether WhatsApp is on (channel-status,
 * which answers on, off or paused and nothing else).
 */
const HOOK_PATHS = [
  "/api/auth/send-code",
  "/api/auth/request-code",
  "/api/auth/channel-status",
  "/api/auth/whatsapp-inbound",
  "/api/auth/whatsapp-receipt",
  "/api/cron/tick",
  "/api/health",
  "/api/webhooks/whatsapp",
  "/api/webhooks/email",
  // The unsubscribe button a mail program shows by itself. It carries the long secret of one email.
  "/api/email/unsubscribe",
];

function isPublic(pathname: string) {
  return HOOK_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The security policy for a page, made fresh for this request. The nonce travels to the page in the request headers (the
 * framework reads it from the policy and stamps its own scripts) and the policy goes back to the browser in the response.
 */
function withPolicy(request: NextRequest) {
  const nonce = makeNonce();
  const policy = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    turnstileScriptUrl: turnstileSiteKey() ? turnstileScriptUrl() : null,
    upgradeInsecure: process.env.NODE_ENV === "production" && request.nextUrl.protocol === "https:",
  });
  const reportOnly = (process.env.CSP_REPORT_ONLY ?? "").trim().toLowerCase() === "true";
  const name = cspHeaderName(reportOnly);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set(name, policy);
  return { headers, name, policy };
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Pages get a policy; the JSON endpoints that services call do not need one.
  const policy = pathname.startsWith("/api/") ? null : withPolicy(request);
  const { response, signedIn, configured } = await updateSession(request, policy?.headers);
  if (policy) response.headers.set(policy.name, policy.policy);

  // Not set up yet: let pages explain what is missing rather than failing.
  if (!configured) return response;

  if (!signedIn && !isPublic(pathname) && pathname !== "/") {
    // Background requests get a plain "sign in" answer, not a page to follow.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "sign in" }, { status: 401, headers: { "cache-control": "no-store" } });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // A browser marker for the applicant's pages and the referee's link, so an applicant answering as their own referee on the
  // same browser can be noticed. Random, httpOnly, and only ever hashed before it reaches the database.
  if (wantsMarker(pathname) && !isBrowserMarker(request.cookies.get(BROWSER_COOKIE)?.value)) {
    response.cookies.set(BROWSER_COOKIE, newBrowserMarker(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: BROWSER_COOKIE_SECONDS,
    });
  }

  return response;
}

export const config = {
  matcher: [
    // Skip Next internals and files with an extension (images, fonts, icons).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|avif|ico|woff2?)$).*)",
  ],
};
