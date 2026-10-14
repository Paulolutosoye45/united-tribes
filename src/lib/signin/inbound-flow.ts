import type { WorkerRpc } from "@/lib/messaging/worker";
import { hashNumber } from "./hash";
import { classifyInbound } from "./inbound";
import { last4, type Outcome } from "./outcome";
import { STOP_REPLY, codeMessage } from "./wording";

export type InboundDeps = {
  rpc: WorkerRpc;
  salt: string | null;
  /** Opens a sealed code. Null when it does not open. */
  open: (token: string, context: string) => string | null;
  log: (line: string) => void;
};

const DIGITS = /^[1-9]\d{7,14}$/;

/**
 * Someone messaged the sign-in number. The sender service passes it here and sends back whatever `reply` says (or
 * nothing). Two things matter:
 *   STOP / "not me"   no more codes to that number for 30 days; the data lead is told; one polite line back.
 *   anything else     if that number asked for a code on the website in the last few minutes (reply-first), this is
 *                     how they collect it. Otherwise: silence. The number never answers strangers.
 */
export async function runInbound(input: { from: string; text: string }, deps: InboundDeps): Promise<Outcome> {
  const none: Outcome = { status: 200, body: { reply: null } };
  const digits = input.from.replace(/\D/g, "");
  const numberHash = DIGITS.test(digits) ? hashNumber(digits, deps.salt) : null;
  if (!numberHash) return none;

  const kind = classifyInbound(input.text);
  if (kind === "stop" || kind === "not_me") {
    const stopped = await deps.rpc("worker_signin_stop", { p_number_hash: numberHash, p_kind: kind });
    if (stopped.error) {
      deps.log(`whatsapp stop not recorded (${stopped.error.code ?? "error"}) for ${last4(digits)}`);
      return { status: 503, body: { reply: null } };
    }
    return { status: 200, body: { reply: STOP_REPLY } };
  }

  const released = await deps.rpc("worker_signin_release", { p_number_hash: numberHash });
  if (released.error) {
    deps.log(`whatsapp code not released (${released.error.code ?? "error"}) to ${last4(digits)}`);
    return { status: 503, body: { reply: null } };
  }
  const data = released.data as { attempt?: unknown; sealed?: unknown } | null;
  if (!data || typeof data.attempt !== "number" || typeof data.sealed !== "string") return none;

  const code = deps.open(data.sealed, `signin:${data.attempt}`);
  if (!code || !/^\d{4,8}$/.test(code)) {
    deps.log(`whatsapp code could not be opened for ${last4(digits)}`);
    await deps.rpc("worker_signin_record", { p_attempt: data.attempt, p_outcome: "failed", p_detail: "unseal" });
    return none;
  }
  return { status: 200, body: { reply: codeMessage(code) } };
}

export type ReceiptDeps = { rpc: WorkerRpc; salt: string | null; log: (line: string) => void };

/** A delivery receipt from the sender service: the code reached the phone, or it did not. */
export async function runReceipt(input: { to: string; state: "delivered" | "read" | "failed" }, deps: ReceiptDeps): Promise<Outcome> {
  const digits = input.to.replace(/\D/g, "");
  const numberHash = DIGITS.test(digits) ? hashNumber(digits, deps.salt) : null;
  if (!numberHash) return { status: 200, body: { ok: false } };
  const result = await deps.rpc("worker_signin_receipt", { p_number_hash: numberHash, p_state: input.state });
  if (result.error) {
    deps.log(`whatsapp receipt not recorded (${result.error.code ?? "error"}) for ${last4(digits)}`);
    return { status: 503, body: { ok: false } };
  }
  return { status: 200, body: { ok: true } };
}
