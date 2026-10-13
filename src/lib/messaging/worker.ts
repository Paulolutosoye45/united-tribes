import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

export type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

/** Calls a database function with the sending service's token added. Injectable so tests need no database. */
export type WorkerRpc = (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;

/**
 * The sending service has no account and no powerful key. It holds one random
 * token that only opens a handful of database functions (claim a message, report
 * how it went, record a delivery receipt, run the calendar). If the token leaks,
 * an admin revokes it on the settings page and makes another.
 */
export function workerRpc(token: string, env = getSupabaseEnv()): WorkerRpc {
  if (!env) throw new Error("Supabase is not configured");
  const client = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return async (fn, args = {}) => {
    const { data, error } = await client.rpc(fn, { p_token: token, ...args });
    return { data, error: error ? { message: error.message, code: error.code } : null };
  };
}

export function workerToken(env: Record<string, string | undefined> = process.env): string | null {
  const token = (env.WORKER_TOKEN ?? "").trim();
  return token.length >= 32 ? token : null;
}

/** The public address of the site: the setting, else the Vercel address, else local. */
export function siteUrl(env: Record<string, string | undefined> = process.env, request?: Request): string {
  const configured = (env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (request) {
    try {
      return new URL(request.url).origin;
    } catch {
      // fall through
    }
  }
  const vercel = (env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}
