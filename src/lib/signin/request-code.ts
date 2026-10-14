import { isUnknownAccount, normalisePhone, phoneDigits, whatsappErrorMessage } from "@/lib/auth/phone";
import type { WorkerRpc } from "@/lib/messaging/worker";
import { hashNetwork, hashNumber, networkKey } from "./hash";
import type { Outcome } from "./outcome";
import { BAD_NUMBER_LINE, NETWORK_LINE, OFF_LINE, PAUSED_LINE, UNAVAILABLE_LINE } from "./wording";

export type OtpResult = { error: { code?: string; message?: string; status?: number } | null };

export type RequestDeps = {
  /** The website is set up for WhatsApp codes at all */
  available: boolean;
  rpc: WorkerRpc | null;
  salt: string | null;
  /** Asks the sign-in service for a code, with the bot-check token. The service does the bot check. */
  otp: (phone: string, captchaToken: string | undefined) => Promise<OtpResult>;
};

const fail = (status: number, error: string, message: string): Outcome => ({ status, body: { error, message } });

/**
 * The sign-in screen asks OUR server for a WhatsApp code, and our server asks the sign-in service. That gives us one
 * place to count how often a network asks, before anything is sent anywhere.
 *
 * What it says does not depend on whether the number has an account:
 *  - paused / off / too many from this network: the same answer for every number.
 *  - otherwise "ok", whether or not a code will really come. A number with no account is told ok, like any other.
 */
export async function runRequestCode(input: { phone: string; captchaToken?: string; headers: Headers }, deps: RequestDeps): Promise<Outcome> {
  if (!deps.available || !deps.rpc) return fail(503, "off", OFF_LINE);
  const phone = normalisePhone(input.phone);
  if (!phone) return fail(400, "bad_number", BAD_NUMBER_LINE);
  const numberHash = hashNumber(phoneDigits(phone), deps.salt);
  const networkHash = hashNetwork(networkKey(input.headers), deps.salt);
  if (!numberHash || !networkHash) return fail(503, "unavailable", UNAVAILABLE_LINE);

  const gate = await deps.rpc("worker_signin_network_gate", { p_network_hash: networkHash, p_number_hash: numberHash });
  const verdict = gate.error ? null : (gate.data as { decision?: string; reason?: string } | null);
  if (!verdict) return fail(503, "unavailable", UNAVAILABLE_LINE);
  if (verdict.decision === "decline") {
    return verdict.reason === "network" ? fail(429, "network", NETWORK_LINE) : fail(503, "paused", PAUSED_LINE);
  }

  let result: OtpResult;
  try {
    result = await deps.otp(phone, input.captchaToken);
  } catch {
    return fail(502, "unavailable", UNAVAILABLE_LINE);
  }
  if (result.error && !isUnknownAccount(result.error)) {
    const limited = result.error.code === "over_sms_send_rate_limit" || result.error.code === "over_request_rate_limit" || result.error.status === 429;
    return fail(limited ? 429 : 400, result.error.code ?? "error", whatsappErrorMessage(result.error));
  }
  return { status: 200, body: { ok: true } };
}
