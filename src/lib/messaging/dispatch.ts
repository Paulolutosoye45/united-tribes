import type { ClaimedMessage, Channel, Recipient } from "./types";
import type { ChannelProvider, SendResult } from "./providers/types";
import type { WorkerRpc } from "./worker";
import type { AiProvider } from "@/lib/ai/types";
import { enrichMessage } from "./summary";

/**
 * The daily jobs inside the heartbeat (reporting numbers, clearing out old personal data) report their own faults in
 * the tick's answer. A fault never stops a message going out, but whoever watches the heartbeat should hear of it.
 * Names the job only; the database's own wording stays in its logs.
 */
export function dailyJobFaults(calendar: unknown): string[] {
  if (!calendar || typeof calendar !== "object") return [];
  const answer = calendar as Record<string, unknown>;
  const faults: string[] = [];
  if (typeof answer.insight_error === "string") faults.push("insight: the daily reporting job failed; see the database logs");
  if (typeof answer.retention_error === "string") faults.push("retention: the daily clean-up of old personal data failed; see the database logs");
  return faults;
}

export type DispatchSummary = {
  /** What the calendar did this time (how many messages it queued), or why it could not run. */
  calendar: unknown;
  /** What the reminder journeys and announcements did this time. */
  reminders?: unknown;
  /** What the referee check's housekeeping did this time (old hashes and codes forgotten). */
  referees?: unknown;
  claimed: number;
  sent: number;
  retried: number;
  rejected: number;
  /** Things worth a look. Never contains a message body or a full address. */
  problems: string[];
};

type Options = {
  rpc: WorkerRpc;
  providers: Record<Channel, ChannelProvider | null>;
  site: string;
  /** Used only to word the coach's Monday summary. Without one, the plain summary is used. */
  ai?: AiProvider | null;
  /** Run the calendar first. On by default; the cron calls it every few minutes. */
  tick?: boolean;
  batchSize?: number;
  maxBatches?: number;
  /** Sent at the same time within a batch. */
  concurrency?: number;
  /** Stop starting new batches after this many milliseconds, so a serverless function ends in time. */
  budgetMs?: number;
  now?: () => number;
};

const CHANNELS: readonly string[] = ["whatsapp", "email", "sms"];

function readRecipient(value: unknown): Recipient {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  return { email: s(v.email), phone: s(v.phone), name: s(v.name), first_name: s(v.first_name) };
}

/** Reads the database's answer defensively: a malformed row is skipped, never allowed to stop the rest. */
export function readClaimed(data: unknown): ClaimedMessage[] {
  if (!Array.isArray(data)) return [];
  const out: ClaimedMessage[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.template !== "string" || typeof r.channel !== "string" || !CHANNELS.includes(r.channel)) continue;
    out.push({
      id: r.id,
      template: r.template,
      channel: r.channel as Channel,
      params: r.params && typeof r.params === "object" && !Array.isArray(r.params) ? (r.params as Record<string, unknown>) : {},
      urgency: r.urgency === "urgent" ? "urgent" : "normal",
      attempts: typeof r.attempts === "number" ? r.attempts : 1,
      reply_token: typeof r.reply_token === "string" ? r.reply_token : null,
      to: readRecipient(r.to),
    });
  }
  return out;
}

/**
 * One pass of the sending service: run the calendar, then hand out queued messages
 * and send each on the channel the database chose. Every message is reported back
 * as sent, retry or rejected, and the database decides what comes next (another
 * attempt, the next channel, or giving up). Safe to run often and safe to run twice
 * at once: the database hands each message to one caller only.
 */
export async function runDispatch(o: Options): Promise<DispatchSummary> {
  const now = o.now ?? Date.now;
  const started = now();
  const summary: DispatchSummary = { calendar: null, claimed: 0, sent: 0, retried: 0, rejected: 0, problems: [] };
  const batchSize = o.batchSize ?? 25;
  const concurrency = Math.max(1, o.concurrency ?? 5);

  if (o.tick !== false) {
    const tick = await o.rpc("worker_tick");
    if (tick.error) summary.problems.push(`calendar: ${tick.error.message}`);
    else summary.calendar = tick.data;
  }

  // Reminders and announcements: the journeys are advanced and due announcements are released into the outbox here,
  // so the claim below can write and send them. A fault never stops the rest of the messages.
  if (o.tick !== false) {
    const reminders = await o.rpc("worker_reminders_tick");
    if (reminders.error) summary.problems.push(`reminders: ${reminders.error.message}`);
    else summary.reminders = reminders.data;
  }

  // The referee check's housekeeping: old browser and network codes are forgotten, expired codes cleared, and a request that never
  // found a way out stops saying "sending". Like the others, a fault is reported and never stops a message.
  if (o.tick !== false) {
    const referees = await o.rpc("worker_referee_tick");
    if (referees.error) summary.problems.push(`referees: ${referees.error.message}`);
    else summary.referees = referees.data;
  }

  for (let batch = 0; batch < (o.maxBatches ?? 8); batch++) {
    if (o.budgetMs !== undefined && now() - started > o.budgetMs) break;
    const claim = await o.rpc("worker_claim", { p_limit: batchSize });
    if (claim.error) {
      summary.problems.push(`claim: ${claim.error.message}`);
      break;
    }
    const messages = readClaimed(claim.data);
    if (messages.length === 0) break;
    summary.claimed += messages.length;

    for (let i = 0; i < messages.length; i += concurrency) {
      await Promise.all(
        messages.slice(i, i + concurrency).map(async (msg) => {
          const result = await sendOne(await enrichMessage(msg, o.ai ?? null), o.providers[msg.channel], o.site);
          const reported = await report(o.rpc, msg, result);
          if (!reported) summary.problems.push(`report failed for ${msg.template}`);
          if (result.ok) summary.sent++;
          else if (result.kind === "retry") summary.retried++;
          else summary.rejected++;
        }),
      );
    }
    if (messages.length < batchSize) break;
  }
  return summary;
}

async function sendOne(msg: ClaimedMessage, provider: ChannelProvider | null, site: string): Promise<SendResult> {
  if (!provider) return { ok: false, kind: "rejected", error: `${msg.channel} is not set up` };
  try {
    return await provider.send(msg, site);
  } catch (error) {
    // A wording bug or a provider library failure: do not keep retrying the same thing on this channel.
    const reason = error instanceof Error ? error.message : "unknown";
    return { ok: false, kind: "rejected", error: `could not prepare: ${reason}`.slice(0, 200) };
  }
}

async function report(rpc: WorkerRpc, msg: ClaimedMessage, result: SendResult): Promise<boolean> {
  const args = result.ok
    ? { p_id: msg.id, p_outcome: "sent", p_provider_id: result.providerId }
    : { p_id: msg.id, p_outcome: result.kind, p_error: result.error, p_retry_minutes: result.kind === "retry" ? (result.retryMinutes ?? 10) : undefined };
  // Reporting matters more than anything else here: a message that went out but is not marked sent would go out again.
  for (let attempt = 0; attempt < 2; attempt++) {
    const done = await rpc("worker_report", args);
    if (!done.error) return true;
  }
  return false;
}
