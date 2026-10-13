import "server-only";
import { after } from "next/server";
import { providerFromEnv } from "@/lib/ai/suggest";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { runLeaderJobs } from "./jobs";

/**
 * Starts reading what was just sent without waiting for the five-minute heartbeat, so an applicant who presses Send
 * sees the answer within a minute or so rather than in five. It runs after the response has gone, so the applicant
 * never waits for it, and it fails silently: the heartbeat picks up anything it misses.
 */
export function kickLeaderReading(): void {
  const token = workerToken();
  if (!token) return;
  after(async () => {
    try {
      await runLeaderJobs({ rpc: workerRpc(token), provider: providerFromEnv(), budgetMs: 45_000 });
    } catch {
      // The heartbeat will do it.
    }
  });
}
