import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { asker, gateFetch, senderForMode } from "@/lib/whatsapp/mode";
import { senderFromEnv } from "@/lib/whatsapp/provider";
import { loadChannel, type SignInChannel } from "./channel";
import { hashSalt } from "./hash";

/** The channel as this website is set up right now. Used by the sign-in page and the channel-status route. */
export async function currentChannel(): Promise<SignInChannel> {
  const token = workerToken();
  let rpc = null;
  try {
    rpc = token ? workerRpc(token) : null;
  } catch {
    rpc = null;
  }
  // In Free mode the official road to Meta is shut, so the sign-in screen does not offer WhatsApp on it; the ordinary-number road is unaffected.
  const ask = rpc ? asker(rpc) : null;
  const sender = ask ? await senderForMode(senderFromEnv(process.env, gateFetch(fetch, ask)), ask) : senderFromEnv();
  return loadChannel({ env: process.env, sender, rpc, salt: hashSalt() });
}
