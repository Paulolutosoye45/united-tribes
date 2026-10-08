/**
 * Only allow redirects to a path inside this app. Anything else (another
 * site, a protocol-relative URL, a backslash trick) falls back to /home.
 */
export function safeNext(next: string | null | undefined, fallback = "/home"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  // Never bounce back into the sign-in screen or an auth endpoint.
  if (next.startsWith("/sign-in") || next.startsWith("/auth/")) return fallback;
  return next;
}
