import { whatsappSignInEnabled } from "@/lib/env";
import type { WorkerRpc } from "@/lib/messaging/worker";
import type { CodeSender } from "@/lib/whatsapp/provider";

/**
 * What the sign-in screen needs to know about WhatsApp codes, and nothing more.
 *   available  the website is set up for it (switch on, a sender, the sending token, a salt). When false the screen
 *              shows email only, as it did before.
 *   status     on, off (the director switched it off) or paused (the breaker tripped). Off and paused look the same on
 *              the screen: WhatsApp greyed out, email selected, and one line saying why.
 *   mode       normal: we send the code. reply_first: the person messages our number first, and we reply with the code.
 *   number     the number the person saves and messages, digits only. Public by nature.
 */
export type SignInChannel = {
  available: boolean;
  status: "on" | "off" | "paused";
  mode: "normal" | "reply_first";
  number: string | null;
};

export const UNAVAILABLE: SignInChannel = { available: false, status: "off", mode: "normal", number: null };

export type ChannelDeps = {
  env: Record<string, string | undefined>;
  sender: CodeSender | null;
  rpc: WorkerRpc | null;
  salt: string | null;
};

const cleanNumber = (raw: string | undefined) => {
  const digits = (raw ?? "").replace(/\D/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
};

export async function loadChannel(deps: ChannelDeps): Promise<SignInChannel> {
  const number = cleanNumber(deps.env.WHATSAPP_SIGNIN_NUMBER);
  if (!whatsappSignInEnabled(deps.env) || !deps.sender || !deps.rpc || !deps.salt) return UNAVAILABLE;

  let status: SignInChannel["status"] = "paused";
  let mode: SignInChannel["mode"] = "normal";
  try {
    const result = await deps.rpc("worker_signin_status");
    const data = result.data as { status?: unknown; mode?: unknown } | null;
    if (!result.error && data && (data.status === "on" || data.status === "off" || data.status === "paused")) {
      status = data.status;
      mode = data.mode === "reply_first" ? "reply_first" : "normal";
    }
  } catch {
    // The database could not be asked: say paused, so nobody is offered a code that cannot be sent.
  }
  // The official route sends the code itself, whatever the setting says. Only the ordinary number can wait for a reply.
  if ((deps.sender.route ?? "official") !== "linked") mode = "normal";
  // Reply-first needs a number to tell people to message.
  if (mode === "reply_first" && !number) return UNAVAILABLE;
  return { available: true, status, mode, number };
}
