import { workerRpc, workerToken } from "@/lib/messaging/worker";
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
  return loadChannel({ env: process.env, sender: senderFromEnv(), rpc, salt: hashSalt() });
}
