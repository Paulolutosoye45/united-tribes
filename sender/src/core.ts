import http from "node:http";
import { signHeaders, verify } from "./auth.js";
import { TransportError, type InboundMessage, type ReceiptEvent, type SenderState, type Transport } from "./transport.js";

export type ServiceOptions = {
  /** The secret shared with the website (LINKED_SENDER_SECRET there). */
  secret: string;
  /** The website's address, no trailing slash. */
  appUrl: string;
  transport: Transport;
  fetcher?: typeof fetch;
  now?: () => number;
  /** One line at a time. Never given a code, a message, or a full number. */
  log?: (line: string) => void;
  limits?: Partial<Limits>;
};

export type Limits = {
  /** Messages the number may send in a minute and in an hour, all kinds together */
  perMinute: number;
  perHour: number;
  /** Replies to one person in a minute: stops two machines talking to each other for ever */
  replyPerPersonPerMinute: number;
  /** A message older than this on arrival is history catching up after a reconnect, not someone asking now */
  maxInboundAgeMs: number;
};

const DEFAULT_LIMITS: Limits = { perMinute: 10, perHour: 60, replyPerPersonPerMinute: 3, maxInboundAgeMs: 2 * 60_000 };

export type Reply = { status: number; body: Record<string, unknown> };

const DIGITS = /^[1-9]\d{7,14}$/;
const last4 = (digits: string) => `***${digits.slice(-4)}`;

/**
 * What this number is allowed to say: one short message, no links. The website only ever asks for the sign-in code
 * message, so anything else is refused even when correctly signed. If the secret leaked, this keeps the number from
 * being used to send anything but a short plain message, and the sending limits keep it from being used for much.
 */
export function textProblem(text: unknown): string | null {
  if (typeof text !== "string" || text.trim() === "") return "empty";
  if (text.length > 200) return "too_long";
  if (/https?:|www\.|\w\.(com|net|org|ng|co|io|me|ly)\b/i.test(text)) return "link";
  return null;
}

/**
 * The sender service, apart from WhatsApp itself:
 *   POST /send    the website asks for one message to be sent (signed)
 *   GET  /health  how the number is: open, connecting, logged out, restricted (signed)
 * and, going the other way, passes on to the website what people send to the number and the delivery receipts, and
 * sends whatever short reply the website answers with.
 */
export class SenderService {
  private state: SenderState = "connecting";
  private readonly limits: Limits;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly sentAt: number[] = [];
  private readonly repliedAt = new Map<string, number[]>();
  private readonly seen = new Set<string>();
  private readonly startedAt: number;
  private server: http.Server | null = null;

  constructor(private readonly o: ServiceOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...o.limits };
    this.fetcher = o.fetcher ?? fetch;
    this.now = o.now ?? Date.now;
    this.log = o.log ?? (() => {});
    this.startedAt = this.now();
  }

  async start(port?: number): Promise<void> {
    await this.o.transport.start({
      onState: (state) => {
        if (state !== this.state) this.log(`state: ${this.state} -> ${state}`);
        this.state = state;
      },
      onMessage: (message) => void this.onMessage(message),
      onReceipt: (receipt) => void this.onReceipt(receipt),
    });
    if (port !== undefined) {
      this.server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= 4096) chunks.push(c);
        });
        req.on("end", async () => {
          const reply: Reply =
            size > 4096
              ? { status: 413, body: { ok: false, reason: "too_large" } }
              : await this.handle(req.method ?? "GET", (req.url ?? "/").split("?")[0], req.headers, Buffer.concat(chunks).toString("utf8"));
          res.writeHead(reply.status, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify(reply.body));
        });
      });
      await new Promise<void>((resolve) => this.server!.listen(port, resolve));
    }
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    await this.o.transport.stop();
  }

  get currentState(): SenderState {
    return this.state;
  }

  /** The request handler without the network, so tests can call it directly. */
  async handle(method: string, path: string, headers: Record<string, string | string[] | undefined>, body: string): Promise<Reply> {
    if (!verify(this.o.secret, headers, body, this.now())) return { status: 401, body: { ok: false, reason: "not_allowed" } };
    if (method === "GET" && path === "/health") return { status: 200, body: this.health() };
    if (method === "POST" && path === "/send") return this.send(body);
    return { status: 404, body: { ok: false, reason: "not_found" } };
  }

  health() {
    return {
      ok: this.state === "open",
      state: this.state,
      uptimeSeconds: Math.round((this.now() - this.startedAt) / 1000),
      sentLastHour: this.recent(60 * 60_000),
    };
  }

  private recent(windowMs: number): number {
    const from = this.now() - windowMs;
    while (this.sentAt.length > 0 && this.sentAt[0] <= this.now() - 60 * 60_000) this.sentAt.shift();
    return this.sentAt.filter((t) => t > from).length;
  }

  private async send(body: string): Promise<Reply> {
    let parsed: { to?: unknown; text?: unknown };
    try {
      parsed = JSON.parse(body);
    } catch {
      return { status: 400, body: { ok: false, reason: "unreadable" } };
    }
    const to = typeof parsed.to === "string" ? parsed.to : "";
    if (!DIGITS.test(to)) return { status: 400, body: { ok: false, reason: "bad_number" } };
    const problem = textProblem(parsed.text);
    if (problem) return { status: 422, body: { ok: false, reason: `bad_text_${problem}` } };
    const sent = await this.deliver(to, parsed.text as string);
    if (sent.ok) return { status: 200, body: { ok: true, id: sent.id } };
    const status = sent.reason === "not_on_whatsapp" ? 422 : sent.reason === "slow_down" ? 429 : 503;
    return { status, body: { ok: false, reason: sent.reason } };
  }

  /** Every message the number sends goes through here: the state check, the limits, and the one place a failure is turned into words. */
  private async deliver(to: string, text: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
    if (this.state !== "open") return { ok: false, reason: this.state === "connecting" ? "connecting" : this.state };
    if (this.recent(60_000) >= this.limits.perMinute || this.recent(60 * 60_000) >= this.limits.perHour) {
      this.log("send refused: over the number's own limit");
      return { ok: false, reason: "slow_down" };
    }
    try {
      const out = await this.o.transport.sendText(to, text);
      this.sentAt.push(this.now());
      return { ok: true, id: out.id };
    } catch (error) {
      const reason = error instanceof TransportError ? error.reason : "failed";
      if (reason === "restricted") this.state = "restricted";
      this.log(`send failed (${reason}) to ${last4(to)}`);
      return { ok: false, reason };
    }
  }

  private async callApp(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const body = JSON.stringify(payload);
    try {
      const response = await this.fetcher(`${this.o.appUrl}${path}`, {
        method: "POST",
        headers: signHeaders(this.o.secret, body, this.now()),
        body,
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) {
        this.log(`website said ${response.status} to ${path}`);
        return null;
      }
      return (await response.json()) as Record<string, unknown>;
    } catch {
      this.log(`website could not be reached for ${path}`);
      return null;
    }
  }

  /** Someone messaged the number. Pass it on; send back what the website says to say, if anything. */
  private async onMessage(message: InboundMessage): Promise<void> {
    if (this.seen.has(message.id)) return;
    this.remember(message.id);
    if (!DIGITS.test(message.from) || message.text.trim() === "") return;
    if (this.now() - message.at > this.limits.maxInboundAgeMs) return;

    const answer = await this.callApp("/api/auth/whatsapp-inbound", { from: message.from, text: message.text.slice(0, 500), id: message.id });
    const reply = answer?.reply;
    if (typeof reply !== "string" || textProblem(reply)) return;

    const times = (this.repliedAt.get(message.from) ?? []).filter((t) => t > this.now() - 60_000);
    if (times.length >= this.limits.replyPerPersonPerMinute) {
      this.log(`reply skipped: ${last4(message.from)} has had enough for a minute`);
      return;
    }
    this.repliedAt.set(message.from, [...times, this.now()]);
    const sent = await this.deliver(message.from, reply);
    if (!sent.ok) await this.callApp("/api/auth/whatsapp-receipt", { to: message.from, state: "failed" });
  }

  private async onReceipt(receipt: ReceiptEvent): Promise<void> {
    const key = `${receipt.id}:${receipt.state}`;
    if (this.seen.has(key)) return;
    this.remember(key);
    if (!DIGITS.test(receipt.to)) return;
    await this.callApp("/api/auth/whatsapp-receipt", { to: receipt.to, state: receipt.state, id: receipt.id });
  }

  private remember(key: string) {
    this.seen.add(key);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value as string);
  }
}
