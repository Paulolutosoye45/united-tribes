import type { ChannelProvider } from "@/lib/messaging/providers/types";
import type { WorkerRpc } from "@/lib/messaging/worker";
import type { CodeSender } from "./provider";

/**
 * WhatsApp mode, as the website lives with it. The database holds the choice (Full, Saver or Free, set by a person at Admin → Messages → WhatsApp
 * mode) and answers one question for the website: may it speak to Meta at all (worker_whatsapp_allowed)? In Free mode the answer is no, and every
 * road from this website to Meta is shut here: the member messages, the official-route sign-in code, and the health checks. Nothing else in the
 * website needs to know the mode.
 *
 * Three rules, so that the answer can never cost anything:
 *   - Free (or any "no") stops the call before it is made. Nothing is sent and nothing is asked of Meta.
 *   - If the database cannot say (it is unreachable, or the token is refused), the website does NOT speak to Meta. It waits and tries again.
 *   - A database that does not have WhatsApp mode yet (the package has not been applied) is allowed, so the website works as it always did.
 */

export type WhatsAppMode = "full" | "saver" | "free";
export type MetaAllowance = {
  mode: WhatsAppMode;
  meta: boolean;
  /** False when the database did not say (no token, an older database, or an error). */
  known: boolean;
};
export type Ask = () => Promise<MetaAllowance>;

export const FREE_WORDS = "WhatsApp is in Free mode: nothing is sent through Meta";

const ALLOWED: MetaAllowance = { mode: "full", meta: true, known: false };
const UNSURE: MetaAllowance = { mode: "full", meta: false, known: false };
/** What the database says when a function is not there: an older database, the package not yet applied. */
const MISSING = /could not find the function|does not exist|PGRST202|42883/i;

export function readAllowance(data: unknown): MetaAllowance | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const mode = d.mode === "free" || d.mode === "saver" || d.mode === "full" ? d.mode : null;
  if (!mode || typeof d.meta !== "boolean") return null;
  // Free never speaks to Meta, whatever else the answer says.
  return { mode, meta: mode === "free" ? false : d.meta, known: true };
}

/** Asks the database once. Never throws. */
export async function metaAllowance(rpc: WorkerRpc | null): Promise<MetaAllowance> {
  if (!rpc) return ALLOWED;
  try {
    const answer = await rpc("worker_whatsapp_allowed");
    if (answer.error) return MISSING.test(`${answer.error.code ?? ""} ${answer.error.message}`) ? ALLOWED : UNSURE;
    return readAllowance(answer.data) ?? ALLOWED;
  } catch {
    return UNSURE;
  }
}

/** The same question, asked at most once in `ttlMs`, so a batch of messages costs the database one question. */
export function asker(rpc: WorkerRpc | null, ttlMs = 15_000, now: () => number = Date.now): Ask {
  let at = 0;
  let held: Promise<MetaAllowance> | null = null;
  return () => {
    if (!held || now() - at > ttlMs) {
      at = now();
      held = metaAllowance(rpc);
    }
    return held;
  };
}

/** Thrown by a gated fetch when WhatsApp mode forbids speaking to Meta. Nothing was sent. */
export class MetaBlockedError extends Error {
  constructor() {
    super(FREE_WORDS);
    this.name = "MetaBlockedError";
  }
}

/** A fetch that refuses, before any request is made, while WhatsApp mode forbids speaking to Meta. */
export function gateFetch(inner: typeof fetch, ask: Ask): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (!(await ask()).meta) throw new MetaBlockedError();
    return inner(input, init);
  }) as typeof fetch;
}

/**
 * The member-message provider for Meta, with the mode in front of it. In Free mode a message is turned back as "rejected", so the database moves it on
 * to the next channel the person agreed to (or lists it to be sent by hand). If the mode cannot be read, the message waits ten minutes. Other
 * providers (email, text, the log) are returned as they are.
 */
export function guardProvider(inner: ChannelProvider | null, ask: Ask): ChannelProvider | null {
  if (!inner || inner.channel !== "whatsapp" || inner.name !== "meta") return inner;
  return {
    channel: inner.channel,
    name: inner.name,
    async send(msg, site) {
      const allowance = await ask();
      if (allowance.meta) return inner.send(msg, site);
      if (allowance.mode === "free" && allowance.known) return { ok: false, kind: "rejected", error: FREE_WORDS };
      return { ok: false, kind: "retry", error: "WhatsApp mode could not be read", retryMinutes: 10 };
    },
  };
}

/**
 * The sign-in code sender for the official route, or nothing while WhatsApp mode forbids Meta. The ordinary-number route (the sender service) is
 * not Meta and is left alone: it is how a church in Free mode still signs people in by WhatsApp.
 */
export async function senderForMode(sender: CodeSender | null, ask: Ask): Promise<CodeSender | null> {
  if (!sender || sender.route === "linked") return sender;
  return (await ask()).meta ? sender : null;
}
