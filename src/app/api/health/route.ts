import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";
import { bearerMatches } from "@/lib/messaging/auth";
import { providersFromEnv } from "@/lib/messaging/providers";
import { workerRpc, workerToken } from "@/lib/messaging/worker";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * A check for uptime monitors. Anyone may ask whether the site and database are up
 * and gets a plain yes or no. With the cron secret it also says how the message
 * queue is doing and which channels are set up, so a monitor can alert when sending
 * has stopped. No names, numbers or message text are ever included.
 */
export async function GET(request: Request) {
  const env = getSupabaseEnv();
  let database = false;
  if (env) {
    const client = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc("ping");
    database = !error && (data as { ok?: boolean } | null)?.ok === true;
  }

  const token = workerToken();
  const detailed = Boolean(token) && bearerMatches(request, [process.env.CRON_SECRET, token]);
  const body: Record<string, unknown> = { ok: database, database };

  if (detailed && token) {
    const providers = providersFromEnv();
    body.channels = {
      whatsapp: providers.whatsapp?.name ?? null,
      email: providers.email?.name ?? null,
      sms: providers.sms?.name ?? null,
    };
    const status = await workerRpc(token)("worker_status");
    body.queue = status.error ? { error: "unavailable" } : status.data;
    const queue = status.data as { stuck?: number; oldest_due_minutes?: number } | null;
    if (queue && ((queue.stuck ?? 0) > 0 || (queue.oldest_due_minutes ?? 0) > 60)) body.ok = false;
  }
  return Response.json(body, { status: body.ok ? 200 : 503, headers: NO_STORE });
}
