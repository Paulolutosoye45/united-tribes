import { linkedHeaders } from "@/lib/signin/signing";
import { codeMessage } from "@/lib/signin/wording";
import type { CodeSender, SendResult, SenderHealth } from "./provider";

type Options = {
  /** Where the sender service listens, such as https://sender.example.org (no trailing slash) */
  url: string;
  secret: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Sends the code through the optional sender service in /sender: an ordinary WhatsApp number on a small
 * always-on server. This website never talks to WhatsApp itself on this route; it hands the service one short fixed
 * message and the service puts it on the number.
 *
 * What it sends is `codeMessage`: who it is from, the code, and "Ignore this if you did not ask. Reply STOP to stop
 * these." No link. Every request is signed with a secret only the two of them hold.
 */
export class LinkedSender implements CodeSender {
  readonly name = "linked";
  readonly route = "linked" as const;
  constructor(private readonly o: Options) {}

  private async call(path: string, method: "GET" | "POST", body: string): Promise<Response> {
    const doFetch = this.o.fetcher ?? fetch;
    return doFetch(`${this.o.url}${path}`, {
      method,
      headers: linkedHeaders(this.o.secret, body),
      body: method === "POST" ? body : undefined,
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 5000),
      cache: "no-store",
    });
  }

  async send(to: string, code: string): Promise<SendResult> {
    try {
      const response = await this.call("/send", "POST", JSON.stringify({ to, text: codeMessage(code) }));
      if (response.ok) return { ok: true };
      let reason = "";
      try {
        reason = String(((await response.json()) as { reason?: unknown }).reason ?? "");
      } catch {
        // No readable body.
      }
      if (response.status === 422 || reason === "not_on_whatsapp") return { ok: false, reason: "rejected", detail: reason || "not on whatsapp" };
      return { ok: false, reason: "unreachable", detail: reason || `sender ${response.status}` };
    } catch (error) {
      return { ok: false, reason: "unreachable", detail: error instanceof Error ? error.name : "failed" };
    }
  }

  /** What the sender says about itself: connected, logged out, restricted, or not answering. */
  async health(): Promise<SenderHealth> {
    try {
      const response = await this.call("/health", "GET", "");
      if (!response.ok) return "unreachable";
      const body = (await response.json()) as { state?: unknown };
      return body.state === "open" ? "ok" : body.state === "logged_out" ? "logged_out" : body.state === "restricted" ? "restricted" : "unreachable";
    } catch {
      return "unreachable";
    }
  }
}
