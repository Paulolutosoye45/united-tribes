import { providerFromEnv } from "@/lib/ai/suggest";
import { bearerMatches } from "@/lib/messaging/auth";
import { dailyJobFaults, runDispatch } from "@/lib/messaging/dispatch";
import { providersFromEnv } from "@/lib/messaging/providers";
import { siteUrl, workerRpc, workerToken } from "@/lib/messaging/worker";
import { runLeaderJobs } from "@/lib/leaders/quality/jobs";
import { writePendingSummaries } from "@/lib/reports/summary";

export const dynamic = "force-dynamic";
// Room to send a batch; the loop also stops itself well before this.
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * The heartbeat. A scheduler calls this every few minutes (vercel.json, a GitHub
 * Action, or any cron). It runs the season calendar, then sends whatever is due.
 *
 * After the messages go out it writes the opening paragraph of any new report.
 *
 * It proves who is calling with a bearer secret: CRON_SECRET (Vercel sends this
 * on its own), or the worker token itself.
 */
async function handle(request: Request) {
  const token = workerToken();
  if (!token) return Response.json({ error: "WORKER_TOKEN is not set" }, { status: 503, headers: NO_STORE });
  if (!bearerMatches(request, [process.env.CRON_SECRET, token])) {
    return Response.json({ error: "not allowed" }, { status: 401, headers: NO_STORE });
  }

  const startedAt = Date.now();
  try {
    const rpc = workerRpc(token);
    const ai = providerFromEnv();
    const summary = await runDispatch({
      rpc,
      providers: providersFromEnv(),
      ai,
      site: siteUrl(process.env, request),
      budgetMs: 40_000,
    });
    // 502 means the database could not be reached for the messages; a fault in the summaries below is listed
    // in "problems" but never turns a working tick into a failed one.
    const status = summary.problems.length > 0 && summary.sent === 0 && summary.claimed === 0 ? 502 : 200;
    // Reports the database has just made get their opening paragraph. A fault here never stops the messages.
    const reports = await writePendingSummaries(rpc, ai, { budgetMs: 12_000 });
    summary.problems.push(...reports.problems);
    // Applications waiting for their first reading (the leader application's quality check). It takes what is left
    // of the minute and never holds up the messages above; with the switch off the database hands over nothing.
    const left = 52_000 - (Date.now() - startedAt);
    let leaderChecks = 0;
    if (left > 10_000) {
      try {
        const leaders = await runLeaderJobs({ rpc, provider: ai, budgetMs: left });
        summary.problems.push(...leaders.problems);
        leaderChecks = leaders.read;
      } catch {
        summary.problems.push("leader check: could not run this time");
      }
    }
    // A daily job that failed (the numbers, the clean-up) is listed too, so a monitor on this endpoint hears of it.
    summary.problems.push(...dailyJobFaults(summary.calendar));
    return Response.json({ ...summary, summaries: reports.written, leaderChecks }, { status, headers: NO_STORE });
  } catch (error) {
    console.error("cron tick failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "tick failed" }, { status: 500, headers: NO_STORE });
  }
}

export const GET = handle;
export const POST = handle;
