import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseEnv } from "@/lib/env";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { currentChannel } from "@/lib/signin/deps";
import { hashSalt } from "@/lib/signin/hash";
import { respond } from "@/lib/signin/outcome";
import { runRequestCode } from "@/lib/signin/request-code";
import { OFF_LINE } from "@/lib/signin/wording";

export const dynamic = "force-dynamic";

const MAX_BODY = 6000;
const bodySchema = z.object({ phone: z.string().min(1).max(40), captchaToken: z.string().max(4096).optional() });

/**
 * The sign-in screen asks for a WhatsApp code here, not at the sign-in service directly. This is where a network's
 * requests are counted, and where a paused channel is turned away early. The sign-in service still does the bot
 * check (the token passes straight through) and still decides whether the number has an account.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY) return respond({ status: 413, body: { error: "too_large", message: "That request was too large." } });
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(body));
  } catch {
    return respond({ status: 400, body: { error: "bad_request", message: "Something went wrong. Reload the page and try again." } });
  }

  const channel = await currentChannel();
  const token = workerToken();
  const env = getSupabaseEnv();
  if (!channel.available || !token || !env) return respond({ status: 503, body: { error: "off", message: OFF_LINE } });

  return respond(
    await runRequestCode(
      { phone: parsed.phone, captchaToken: parsed.captchaToken, headers: request.headers },
      {
        available: true,
        rpc: workerRpc(token),
        salt: hashSalt(),
        otp: async (phone, captchaToken) => {
          const client = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
          const { error } = await client.auth.signInWithOtp({ phone, options: { channel: "whatsapp", shouldCreateUser: false, captchaToken } });
          return { error: error ? { code: error.code, message: error.message, status: error.status } : null };
        },
      },
    ),
  );
}
