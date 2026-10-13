/**
 * Cloudflare Turnstile, the bot check on sign-in. Two halves:
 *
 *  - In the browser, a small widget gives the visitor a one-time token (NEXT_PUBLIC_TURNSTILE_SITE_KEY switches it on).
 *    Sign-in sends the token to Supabase, which checks it with Cloudflare itself once Auth's CAPTCHA protection is turned
 *    on in the dashboard with the matching secret key.
 *  - On this server, `verifyTurnstile` checks a token directly. Pages that anyone with a link can submit (a parent's answer,
 *    a referee's reference) use it, when TURNSTILE_SECRET_KEY is set.
 *
 * Neither half does anything until its key is set, so a fresh install works with no account at all.
 */

/** The address a token is checked at. Tests point it at a stand-in. */
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Whether the widget is shown. NEXT_PUBLIC_ values must be written out in full for Next.js to inline them. */
export function turnstileSiteKey(): string | null {
  const key = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "").trim();
  return key || null;
}

export function turnstileScriptUrl(): string {
  return (process.env.NEXT_PUBLIC_TURNSTILE_SCRIPT_URL ?? "").trim() || TURNSTILE_SCRIPT_URL;
}

export type TurnstileCheck = { ok: true } | { ok: false; message: string };

const TRY_AGAIN = "We couldn’t confirm you are a person. Reload the page and try again.";

/**
 * Asks Cloudflare whether a token is genuine. Passes at once when no secret is set. Refuses a missing token, a bad
 * one, or an answer we cannot get (it fails closed: a bot check that lets everyone through when it is down is no check).
 */
export async function verifyTurnstile(
  token: unknown,
  options: { ip?: string | null; secret?: string | null; url?: string; fetcher?: typeof fetch } = {},
): Promise<TurnstileCheck> {
  const secret = options.secret === undefined ? (process.env.TURNSTILE_SECRET_KEY ?? "").trim() : (options.secret ?? "").trim();
  if (!secret) return { ok: true };
  if (typeof token !== "string" || token.length < 10 || token.length > 4096) return { ok: false, message: TRY_AGAIN };

  const body = new URLSearchParams({ secret, response: token });
  if (options.ip) body.set("remoteip", options.ip);
  const url = options.url ?? ((process.env.TURNSTILE_VERIFY_URL ?? "").trim() || TURNSTILE_VERIFY_URL);
  try {
    const res = await (options.fetcher ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, message: TRY_AGAIN };
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? { ok: true } : { ok: false, message: TRY_AGAIN };
  } catch {
    return { ok: false, message: TRY_AGAIN };
  }
}
