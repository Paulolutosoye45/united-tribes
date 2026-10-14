import type { WorkerRpc } from "@/lib/messaging/worker";
import type { HookRequest } from "@/lib/whatsapp/payload";
import type { CodeSender } from "@/lib/whatsapp/provider";
import { hashNumber } from "./hash";
import { hookFailure, last4, type Outcome } from "./outcome";

export type SendCodeDeps = {
  sender: CodeSender;
  rpc: WorkerRpc;
  salt: string | null;
  /** Seals a code so it can wait in the database (reply-first). Throws when no sealing key is set. */
  seal: (plain: string, context: string) => string;
  log: (line: string) => void;
};

/** The same empty success the sign-in service gets for a code that was sent: a decline must look exactly like this. */
const NEUTRAL: Outcome = { status: 200, body: {} };
const COULD_NOT_SEND = "We couldn't send the WhatsApp message.";

type Gate = { decision: "allow"; attempt: number; mode: "normal" | "reply_first" } | { decision: "decline"; reason: string };

function readGate(data: unknown): Gate | null {
  if (!data || typeof data !== "object") return null;
  const g = data as Record<string, unknown>;
  if (g.decision === "decline") return { decision: "decline", reason: String(g.reason ?? "declined").slice(0, 40) };
  if (g.decision === "allow" && typeof g.attempt === "number") return { decision: "allow", attempt: g.attempt, mode: g.mode === "reply_first" ? "reply_first" : "normal" };
  return null;
}

/**
 * The "Send SMS" hook, after the signature has been checked. The sign-in service calls this only for a number that
 * is on an account, once the bot check has passed. In order:
 *
 *   1. Ask the database whether a code may go to this number right now (caps, kill switch, breaker, STOP list). If not,
 *      answer EXACTLY as for a sent code, so nothing the screen sees depends on whether a number has an account.
 *   2. Reply-first: seal the code and keep it until the person messages the number. Otherwise send it now.
 *   3. Tell the database what happened. That is how the breaker sees failures.
 *
 * The code and the full number are never written to a log.
 */
export async function runSendCode(hook: HookRequest, deps: SendCodeDeps): Promise<Outcome> {
  const numberHash = hashNumber(hook.to, deps.salt);
  if (!numberHash) return hookFailure(503, "WhatsApp sign-in is not set up.");
  const route = deps.sender.route ?? "official";

  const gateResult = await deps.rpc("worker_signin_gate", { p_number_hash: numberHash, p_flow: hook.flow, p_route: route });
  const gate = gateResult.error ? null : readGate(gateResult.data);
  if (!gate) {
    deps.log(`whatsapp code not sent: the limits could not be checked to ${last4(hook.to)}`);
    return hookFailure(503, COULD_NOT_SEND);
  }
  if (gate.decision === "decline") {
    deps.log(`whatsapp code held back (${gate.reason}) to ${last4(hook.to)}`);
    return NEUTRAL;
  }

  const record = async (outcome: "sent" | "failed" | "rejected", detail: string) => {
    const result = await deps.rpc("worker_signin_record", { p_attempt: gate.attempt, p_outcome: outcome, p_detail: detail });
    if (result.error) deps.log(`whatsapp code outcome not recorded (${result.error.code ?? "error"})`);
  };

  if (route === "linked" && gate.mode === "reply_first") {
    try {
      const sealed = deps.seal(hook.code, `signin:${gate.attempt}`);
      const held = await deps.rpc("worker_signin_hold", { p_attempt: gate.attempt, p_sealed: sealed });
      if (held.error || (held.data as { ok?: boolean } | null)?.ok !== true) throw new Error("not held");
    } catch {
      deps.log(`whatsapp code not held: could not keep it safe to ${last4(hook.to)}`);
      await record("failed", "not_held");
      return hookFailure(500, COULD_NOT_SEND);
    }
    return NEUTRAL;
  }

  const result = await deps.sender.send(hook.to, hook.code);
  if (!result.ok) {
    // Enough to find the cause in the logs, nothing that identifies the person or the code.
    deps.log(`whatsapp code not sent: ${result.reason}${result.detail ? ` (${result.detail})` : ""} to ${last4(hook.to)}`);
    await record(result.reason === "rejected" ? "rejected" : "failed", result.reason);
    return hookFailure(500, COULD_NOT_SEND);
  }
  await record("sent", "sent");
  return NEUTRAL;
}
