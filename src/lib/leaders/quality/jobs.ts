import type { AiProvider } from "@/lib/ai/types";
import type { WorkerRpc } from "@/lib/messaging/worker";
import { readApplication, readJob, type PendingJob } from "./scorer";

export type LeaderJobSummary = {
  /** Applications read and saved this time. */
  read: number;
  /** Attempts that failed and will be tried again later (or handed to a person after ten). */
  failed: number;
  /** Things worth a look. Never contains an applicant's words. */
  problems: string[];
};

type Options = {
  rpc: WorkerRpc;
  provider: AiProvider | null;
  /** Stop starting new applications after this many milliseconds, so a serverless function ends in time. */
  budgetMs?: number;
  /** One reading takes up to this long; a new one is only started if there is time left for it. */
  perJobMs?: number;
  now?: () => number;
};

/**
 * The first reading, as part of the heartbeat. The database hands over the applications waiting (none while the
 * switch is off), each is read, and the result goes back. A failure never stops the rest and never passes an
 * application: the database tries again later, and after ten failures a person decides.
 */
export async function runLeaderJobs(o: Options): Promise<LeaderJobSummary> {
  const now = o.now ?? Date.now;
  const started = now();
  const summary: LeaderJobSummary = { read: 0, failed: 0, problems: [] };
  const perJob = o.perJobMs ?? 22_000;
  const budget = o.budgetMs ?? 25_000;

  const claim = await o.rpc("worker_pending_leader_jobs", { p_limit: 3 });
  if (claim.error) {
    summary.problems.push(`leader check: ${claim.error.message}`);
    return summary;
  }
  const jobs = (Array.isArray(claim.data) ? claim.data : []).map(readJob).filter((j): j is PendingJob => j !== null);

  for (const job of jobs) {
    // Not enough time to finish another one: release it and let the next heartbeat pick it up.
    if (now() - started + perJob > budget && summary.read + summary.failed > 0) {
      await o.rpc("worker_fail_leader_job", { p_job: job.job, p_error: "out of time in this run" });
      continue;
    }
    try {
      const result = await readApplication(job, { rpc: o.rpc, provider: o.provider, timeoutMs: perJob - 2_000 });
      const saved = await o.rpc("worker_save_leader_ai_score", { p_job: job.job, p_result: result });
      if (saved.error) throw new Error(`save: ${saved.error.message}`);
      summary.read += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : "unknown";
      // The text of an error from the AI or the database is logged by name only, never an applicant's words.
      summary.problems.push(`leader check failed (attempt ${job.attempts}): ${message.slice(0, 120)}`);
      await o.rpc("worker_fail_leader_job", { p_job: job.job, p_error: message.slice(0, 190) });
    }
  }

  const alerts = await o.rpc("worker_leader_ai_alerts");
  if (!alerts.error && alerts.data && typeof alerts.data === "object") {
    const a = alerts.data as { stuck?: number; failed_24h?: number };
    if ((a.stuck ?? 0) > 0) summary.problems.push(`leader check: ${a.stuck} application(s) have waited over an hour for their first reading`);
    if ((a.failed_24h ?? 0) > 0) summary.problems.push(`leader check: ${a.failed_24h} application(s) were handed to a person after repeated failures`);
  }
  return summary;
}
