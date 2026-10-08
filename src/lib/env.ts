/**
 * Public Supabase settings. Next.js only inlines NEXT_PUBLIC_ variables when
 * they are written out in full, so each one is spelled out here.
 *
 * Returns null when the project is not set up yet, so pages can say what is
 * missing instead of crashing.
 */
export function getSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export function requireSupabaseEnv(): { url: string; key: string } {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
  }
  return env;
}

/**
 * Whether to offer sign-in with a code on WhatsApp. Off until the sign-in
 * service has a phone provider (or the send-code hook) behind it, so nobody
 * is shown a button that cannot work. Read on the server and passed down.
 */
export function whatsappSignInEnabled(): boolean {
  return (process.env.WHATSAPP_SIGNIN ?? "").trim().toLowerCase() === "on";
}
