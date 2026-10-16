import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
  useMultiFileAuthState,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { TransportError, type Transport, type TransportHandlers } from "./transport.js";

type Options = {
  /** Where the login is kept. Keep this folder safe and backed up: losing it means linking the number again. */
  authDir: string;
  /** Called with the text of each QR code while linking a number for the first time. */
  onQr?: (qr: string) => void;
  log: (line: string) => void;
};

const statusCode = (error: unknown): number | undefined => (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;

/** The digits of a person's phone number from a WhatsApp address, or null when WhatsApp has hidden it behind a private identifier. */
export function digitsOf(jid: string | undefined | null): string | null {
  if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;
  const user = jidDecode(jid)?.user;
  return user && /^[1-9]\d{7,14}$/.test(user) ? user : null;
}

function phoneOf(key: WAMessageKey): string | null {
  return digitsOf(key.remoteJid) ?? digitsOf(key.remoteJidAlt);
}

function textOf(message: WAMessage): string {
  const m = message.message;
  return m?.conversation ?? m?.extendedTextMessage?.text ?? "";
}

/**
 * Puts the service on a real WhatsApp number through Baileys, an unofficial library that speaks the same protocol as
 * WhatsApp Web. It is not endorsed by WhatsApp and it can stop working, or get a number restricted, without notice.
 *
 * What it deliberately does NOT do: pretend to be a person (no fake "typing", no random pauses), send to anyone who
 * has not asked, send more than a short fixed message, or change identity. It reconnects by itself when the
 * connection drops, and stops and says so when WhatsApp logs it out or restricts it, because those need a human.
 */
export class BaileysTransport implements Transport {
  private sock: WASocket | null = null;
  private handlers!: TransportHandlers;
  private stopped = false;
  private attempt = 0;

  constructor(private readonly o: Options) {}

  async start(handlers: TransportHandlers): Promise<void> {
    this.handlers = handlers;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.sock?.end(undefined);
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.o.authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu("United Tribes"),
      logger: pino({ level: "silent" }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
    });
    this.sock = sock;
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      if (update.qr) this.o.onQr?.(update.qr);
      if (update.connection === "connecting") this.handlers.onState("connecting");
      if (update.connection === "open") {
        this.attempt = 0;
        this.handlers.onState("open");
      }
      // WhatsApp saying the number may not start conversations: stop, and let a person look.
      if (update.reachoutTimeLock?.isActive) this.handlers.onState("restricted");
      if (update.connection === "close") {
        const code = statusCode(update.lastDisconnect?.error);
        this.o.log(`connection closed (${code ?? "no code"})`);
        if (this.stopped) return;
        if (code === DisconnectReason.loggedOut || code === DisconnectReason.connectionReplaced) {
          this.handlers.onState("logged_out");
        } else if (code === DisconnectReason.forbidden) {
          this.handlers.onState("restricted");
        } else {
          this.handlers.onState("connecting");
          const wait = Math.min(60_000, 1000 * 2 ** Math.min(this.attempt++, 6));
          setTimeout(() => void this.connect().catch((e) => this.o.log(`reconnect failed: ${(e as Error).name}`)), wait);
        }
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      // "notify" is a message arriving now. Anything else is history being filled in.
      if (type !== "notify") return;
      for (const message of messages) {
        const key = message.key;
        if (key.fromMe || !key.id) continue;
        const jid = key.remoteJid ?? "";
        if (jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) continue;
        const from = phoneOf(key);
        if (!from) {
          this.o.log("message skipped: WhatsApp hid the sender's number behind a private identifier");
          continue;
        }
        const text = textOf(message).trim();
        if (!text) continue;
        this.handlers.onMessage({ id: key.id, from, text, at: Number(message.messageTimestamp ?? 0) * 1000 });
      }
    });

    sock.ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id) continue;
        const to = phoneOf(key);
        if (!to) continue;
        const status = update.status;
        // 0 error, 1 pending, 2 sent to WhatsApp, 3 delivered to the phone, 4 read, 5 played
        if (status === 0) this.handlers.onReceipt({ id: key.id, to, state: "failed" });
        else if (status === 3) this.handlers.onReceipt({ id: key.id, to, state: "delivered" });
        else if (status === 4 || status === 5) this.handlers.onReceipt({ id: key.id, to, state: "read" });
      }
    });
  }

  async sendText(to: string, text: string): Promise<{ id: string }> {
    const sock = this.sock;
    if (!sock) throw new TransportError("disconnected");
    try {
      const found = (await sock.onWhatsApp(`${to}@s.whatsapp.net`))?.[0];
      if (!found?.exists) throw new TransportError("not_on_whatsapp");
      const sent = await sock.sendMessage(found.jid, { text });
      if (!sent?.key.id) throw new TransportError("failed");
      return { id: sent.key.id };
    } catch (error) {
      if (error instanceof TransportError) throw error;
      const code = statusCode(error);
      if (code === DisconnectReason.forbidden) throw new TransportError("restricted");
      if (code === DisconnectReason.connectionClosed || code === DisconnectReason.connectionLost) throw new TransportError("disconnected");
      throw new TransportError("failed");
    }
  }
}
