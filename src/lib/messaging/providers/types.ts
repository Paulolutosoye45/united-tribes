import type { Channel, ClaimedMessage } from "../types";

/** How one attempt to send went. `retry` is a hiccup worth trying again; `rejected` means this channel will not work for this person. */
export type SendResult =
  | { ok: true; providerId: string | null }
  | { ok: false; kind: "retry" | "rejected"; error: string; retryMinutes?: number };

export interface ChannelProvider {
  readonly channel: Channel;
  readonly name: string;
  send(msg: ClaimedMessage, site: string): Promise<SendResult>;
}

export type Fetcher = typeof fetch;

/** An HTTP status that means "try again later" rather than "this will never work". */
export function isTransient(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** How long to wait before the next attempt: what the provider asks for, else a growing pause. */
export function retryDelay(response: Response | null, attempts: number): number {
  const asked = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(asked) && asked > 0) return Math.min(Math.ceil(asked / 60), 120);
  return Math.min(5 * 2 ** Math.max(attempts - 1, 0), 60);
}

/** Keeps a provider's error text short and free of anything that looks like a secret or a full number. */
export function brief(text: string): string {
  return text
    .replace(/\+?\d{9,}/g, (digits) => `***${digits.slice(-3)}`)
    .replace(/(bearer|key|token|secret|password|auth\w*)[=:\s]+[A-Za-z0-9._~+/-]{8,}/gi, "$1 ***")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

export async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
