import type { WorkerRpc } from "@/lib/messaging/worker";
import type { CodeSender } from "@/lib/whatsapp/provider";

export type SigninTickResult = { problems: string[]; status: string | null; signal: string | null };

/**
 * The sign-in part of the heartbeat: ask the ordinary-number sender how it is (logged out or restricted pauses
 * WhatsApp at once), then let the database tidy up (collect nothing-came-of-it requests, forget old ones, check the
 * breaker). A fault here is reported and never stops the heartbeat's other work.
 */
export async function runSigninTick(deps: { rpc: WorkerRpc; sender: CodeSender | null }): Promise<SigninTickResult> {
  const problems: string[] = [];
  let signal: string | null = null;
  if (deps.sender?.health) {
    try {
      signal = await deps.sender.health();
      const reported = await deps.rpc("worker_signin_sender_signal", { p_signal: signal });
      if (reported.error) problems.push("sign-in: could not record the sender's state");
    } catch {
      problems.push("sign-in: could not ask the sender how it is");
    }
  }
  let status: string | null = null;
  try {
    const result = await deps.rpc("worker_signin_tick");
    if (result.error) problems.push("sign-in: housekeeping could not run");
    else status = String((result.data as { status?: unknown } | null)?.status ?? "") || null;
  } catch {
    problems.push("sign-in: housekeeping could not run");
  }
  return { problems, status, signal };
}
