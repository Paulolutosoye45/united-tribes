/**
 * The only thing the service needs from WhatsApp, as a small interface. The real one is baileys.ts; the tests use a
 * fake. Keeping it this narrow is what lets everything that matters (the signature checks, the sending limits, what
 * may be sent, what is never logged) be tested without a phone.
 */
export type SenderState = "connecting" | "open" | "logged_out" | "restricted";

/** `from` and `to` are always digits only, with the country code, such as 2348031234567. */
export type InboundMessage = { id: string; from: string; text: string; at: number };
export type ReceiptEvent = { id: string; to: string; state: "delivered" | "read" | "failed" };

export type TransportHandlers = {
  onState(state: SenderState): void;
  onMessage(message: InboundMessage): void;
  onReceipt(receipt: ReceiptEvent): void;
};

export class TransportError extends Error {
  constructor(public readonly reason: "not_on_whatsapp" | "disconnected" | "restricted" | "failed") {
    super(reason);
    this.name = "TransportError";
  }
}

export interface Transport {
  start(handlers: TransportHandlers): Promise<void>;
  /** Sends one text. Throws TransportError. Returns the message's id, so a receipt can be matched to it. */
  sendText(to: string, text: string): Promise<{ id: string }>;
  stop(): Promise<void>;
}
