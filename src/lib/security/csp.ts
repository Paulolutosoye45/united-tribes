/**
 * The Content Security Policy.
 *
 * Scripts are the part that matters: only the framework's own scripts, each carrying this request's secret nonce, may
 * run, and any script they load in turn ('strict-dynamic'). An injected <script> or an inline handler is refused, so a
 * mistake somewhere in the pages cannot become stolen sessions.
 *
 * Styles allow inline style attributes ('unsafe-inline') because the interface sets sizes and colours that way (a bar's
 * width, a ring's fill). That is the weaker half, and the less dangerous one: a style cannot run code.
 *
 * What the browser may talk to is listed: this site, the Supabase project (sign-in and data), and, only when the
 * bot check is switched on, Cloudflare Turnstile. Nothing else can be loaded, framed or posted to.
 */
export type CspOptions = {
  nonce: string;
  /** Development needs eval for readable error stacks; production never does. */
  dev?: boolean;
  /** The Supabase project's address, as set in NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl?: string | null;
  /** Where the Turnstile script comes from, when the bot check is on (Cloudflare's address unless a test points elsewhere). */
  turnstileScriptUrl?: string | null;
  /** Ask the browser to load everything over https. Only for a site served over https. */
  upgradeInsecure?: boolean;
};

/** "https://abc.supabase.co/rest/v1" -> "https://abc.supabase.co". Null when it is not an http(s) address. */
export function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** The websocket twin of an http(s) origin (Supabase realtime), or null. */
function socketOf(origin: string | null): string | null {
  if (!origin) return null;
  return origin.replace(/^http/, "ws");
}

export function buildCsp(o: CspOptions): string {
  const supabase = originOf(o.supabaseUrl);
  const turnstile = originOf(o.turnstileScriptUrl);
  const connect = ["'self'", supabase, socketOf(supabase), turnstile].filter((v): v is string => Boolean(v));
  const frames = turnstile ? [turnstile] : [];

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${o.nonce}'`, "'strict-dynamic'", ...(o.dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "blob:", "data:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connect],
    ["frame-src", frames.length > 0 ? frames : ["'none'"]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (o.upgradeInsecure) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** A fresh, unguessable value for each request. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Report-only mode lets a staging site show what a stricter policy would block without blocking it. Set
 * CSP_REPORT_ONLY=true there; production leaves it unset and the policy is enforced.
 */
export function cspHeaderName(reportOnly: boolean): "Content-Security-Policy" | "Content-Security-Policy-Report-Only" {
  return reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}
