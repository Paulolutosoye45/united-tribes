import type { CodeSender, SendResult } from "./provider";

type Options = {
  phoneNumberId: string;
  token: string;
  template: string;
  language: string;
  graphVersion: string;
  fetcher?: typeof fetch;
  /** How long to wait for Meta before giving up, in milliseconds. */
  timeoutMs?: number;
};

/**
 * Sends the code with an approved "authentication" message template through
 * the WhatsApp Business Cloud API. Meta's rules for these templates: the
 * wording is fixed by Meta, the code is passed as a parameter, and the
 * "copy code" button needs the same code again.
 */
export class MetaCloudSender implements CodeSender {
  readonly name = "meta";
  readonly route = "official" as const;
  constructor(private readonly o: Options) {}

  /** The request body, exposed so tests can check it without a network. */
  payload(to: string, code: string) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: this.o.template,
        language: { code: this.o.language },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ],
      },
    };
  }

  async send(to: string, code: string): Promise<SendResult> {
    const doFetch = this.o.fetcher ?? fetch;
    const url = `https://graph.facebook.com/${this.o.graphVersion}/${this.o.phoneNumberId}/messages`;
    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.o.token}`, "content-type": "application/json" },
        body: JSON.stringify(this.payload(to, code)),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 4000),
      });
      if (response.ok) return { ok: true };
      // Meta explains the failure in its body. Keep only its numeric code, never the text of the request.
      let detail: string | undefined;
      try {
        const body = (await response.json()) as { error?: { code?: number; error_subcode?: number } };
        if (body.error?.code !== undefined) detail = `meta ${body.error.code}${body.error.error_subcode ? `/${body.error.error_subcode}` : ""}`;
      } catch {
        // No readable body.
      }
      return { ok: false, reason: "rejected", detail: detail ?? `http ${response.status}` };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  }
}
