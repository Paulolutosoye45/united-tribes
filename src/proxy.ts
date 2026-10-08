import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/** Pages anyone can open without signing in. */
const PUBLIC_PREFIXES = ["/sign-in", "/auth", "/design", "/brand", "/icon", "/apple-icon", "/privacy", "/reference"];

/** Called by the sign-in service, not by a person. It proves itself with a signature instead. */
const HOOK_PATHS = ["/api/auth/send-code"];

function isPublic(pathname: string) {
  return HOOK_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { response, signedIn, configured } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

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

  return response;
}

export const config = {
  matcher: [
    // Skip Next internals and files with an extension (images, fonts, icons).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|avif|ico|woff2?)$).*)",
  ],
};
