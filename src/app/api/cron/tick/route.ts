import { providerFromEnv } from "@/lib/ai/suggest";
import { bearerMatches } from "@/lib/messaging/auth";
import { dailyJobFaults, runDispatch } from "@/lib/messaging/dispatch";
import { providersFromEnv } from "@/lib/messaging/providers";
import { siteUrl, workerRpc, workerToken } from "@/lib/messaging/worker";
import { whatsappSignInEnabled } from "@/lib/env";
import { runLeaderJobs } from "@/lib/leaders/quality/jobs";
import { runSigninTick } from "@/lib/signin/tick";
import { asker, gateFetch, senderForMode } from "@/lib/whatsapp/mode";
import { senderFromEnv } from "@/lib/whatsapp/provider";
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
    // Automatic placement and assistant recommendations come first, so what they queue goes out in this same beat. With the
    // placement switch Off the database does nothing at all. A fault here is listed but never stops the messages below.
    const early: string[] = [];
    let placement: { ran: boolean } = { ran: false };
    try {
      const placed = await rpc("worker_placement_tick");
      if (placed.error) early.push(`placement: ${placed.error.message}`);
      else placement = { ran: true };
      const assistants = await rpc("worker_assistant_tick");
      if (assistants.error) early.push(`assistants: ${assistants.error.message}`);
    } catch {
      early.push("placement: could not run this time");
    }
    // The Details check: reminders and the call to a coach come first so they go out in this same beat, and links and codes that have done
    // their work are forgotten. With the function Off (or the Master pause on) the database does nothing at all. A fault is listed only: it
    // never changes the answer, so it is kept apart from the faults above that do.
    const detailsFaults: string[] = [];
    try {
      const details = await rpc("worker_details_tick");
      if (details.error) detailsFaults.push(`details check: ${details.error.message}`);
    } catch {
      detailsFaults.push("details check: could not run this time");
    }
    // The leaders whose Tribe Card is still open: on the chosen days (Thursday, Friday and Saturday to begin with) the database queues one kind email to
    // each, so it goes out in this same beat. Off it does nothing at all; in Rehearsal it only writes down who it would have written to. A fault here is
    // listed but never stops anything.
    const cardFaults: string[] = [];
    let leaderCards: { mode: string; queued: number; wouldSend: number } = { mode: "off", queued: 0, wouldSend: 0 };
    try {
      const ran = await rpc("worker_leader_card_reminders");
      if (ran.error) cardFaults.push(`leader card reminders: ${ran.error.message}`);
      else if (ran.data && typeof ran.data === "object") {
        const d = ran.data as { mode?: string; queued?: number; would_send?: number };
        leaderCards = { mode: d.mode ?? "off", queued: d.queued ?? 0, wouldSend: d.would_send ?? 0 };
      }
    } catch {
      cardFaults.push("leader card reminders: could not run this time");
    }
    // The contact series (seats and contacts): people with a gap are put in, every running series takes one step, and what is due is queued so it goes out
    // in this same beat. With the switch Off (or the Master pause on) the database does nothing at all. A fault here is listed but never stops the messages.
    const reachFaults: string[] = [];
    let reachSeries: { ran: boolean } = { ran: false };
    try {
      const ran = await rpc("worker_reach_tick");
      if (ran.error) reachFaults.push(`contact series: ${ran.error.message}`);
      else if (ran.data && typeof ran.data === "object") reachSeries = { ran: (ran.data as { ran?: boolean }).ran === true };
    } catch {
      reachFaults.push("contact series: could not run this time");
    }
    // The Leader Desk's emails to members (Phase 2a): a proposal or interest check with no answer in time runs out, and links that have done their work are
    // forgotten. With the function Off nothing is waiting, so this changes nothing. A fault here is listed but never stops the messages.
    const deskFaults: string[] = [];
    try {
      const ran = await rpc("worker_desk_tick");
      if (ran.error) deskFaults.push(`leader desk: ${ran.error.message}`);
    } catch {
      deskFaults.push("leader desk: could not run this time");
    }
    // The placed answer sequence (Package 6b) and the seat window (Package 6): each seat the church placed is looked at once, and what is due is queued so it goes
    // out in this same beat. Each has its own switch and does nothing while Off or while the Master pause is on. The seat window beats here too, which is what the
    // switch's "the heartbeat is late" check reads. A fault in either is listed but never stops the messages.
    const seatFaults: string[] = [];
    let seatWindow: { ran: boolean } = { ran: false };
    try {
      const seq = await rpc("worker_placed_seq_tick");
      if (seq.error) seatFaults.push(`answer sequence: ${seq.error.message}`);
    } catch {
      seatFaults.push("answer sequence: could not run this time");
    }
    try {
      const ran = await rpc("worker_seat_window_tick");
      if (ran.error) seatFaults.push(`seat window: ${ran.error.message}`);
      else if (ran.data && typeof ran.data === "object") seatWindow = { ran: (ran.data as { ran?: boolean }).ran === true };
    } catch {
      seatFaults.push("seat window: could not run this time");
    }
    const summary = await runDispatch({
      rpc,
      providers: providersFromEnv(),
      ai,
      site: siteUrl(process.env, request),
      budgetMs: 40_000,
    });
    // 502 means the database could not be reached for the messages; a fault in the summaries below is listed
    // in "problems" but never turns a working tick into a failed one.
    summary.problems.push(...early);
    const status = summary.problems.length > 0 && summary.sent === 0 && summary.claimed === 0 ? 502 : 200;
    summary.problems.push(...detailsFaults, ...cardFaults, ...reachFaults, ...deskFaults, ...seatFaults);
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
    // The owner's activity summaries: the last few days are counted again, and detail past the retention is cleared. A
    // fault here is listed but never changes the answer, and nothing the owner sees depends on this finishing in time.
    let activity: { refreshed: boolean } = { refreshed: false };
    try {
      const done = await rpc("worker_activity_refresh");
      if (done.error) summary.problems.push(`activity summaries: ${done.error.message}`);
      else activity = { refreshed: true };
    } catch {
      summary.problems.push("activity summaries: could not refresh this time");
    }
    // The team's notices: what has been waiting too long, what is due tomorrow, and the daily and weekly summaries. The
    // database decides who is told, and when (it holds back at night); with every group switched off it does nothing.
    // A fault here is listed but never stops the messages above.
    let notices: { swept: boolean } = { swept: false };
    try {
      const swept = await rpc("worker_notice_sweep");
      if (swept.error) summary.problems.push(`notices: ${swept.error.message}`);
      else notices = { swept: true };
    } catch {
      summary.problems.push("notices: could not run this time");
    }
    // Exports and Reports: the export log and its switch log are kept for two years, and ended standing links go a month after they end.
    // Once a day. It has its own door, and a fault is listed but never stops anything above.
    let exportsSwept = false;
    try {
      const swept = await rpc("worker_export_sweep");
      if (swept.error) summary.problems.push(`exports: ${swept.error.message}`);
      else exportsSwept = true;
    } catch {
      summary.problems.push("exports: could not run this time");
    }
    // WhatsApp sign-in: how the sending number is, and the housekeeping behind the limits and the breaker.
    let signin: { status: string | null; signal: string | null } | null = null;
    if (whatsappSignInEnabled()) {
      const ask = asker(rpc);
      const ticked = await runSigninTick({ rpc, sender: await senderForMode(senderFromEnv(process.env, gateFetch(fetch, ask)), ask) });
      summary.problems.push(...ticked.problems);
      signin = { status: ticked.status, signal: ticked.signal };
    }
    // A daily job that failed (the numbers, the clean-up) is listed too, so a monitor on this endpoint hears of it.
    summary.problems.push(...dailyJobFaults(summary.calendar));
    return Response.json({ ...summary, summaries: reports.written, leaderChecks, activity, notices, exportsSwept, signin, placement, leaderCards, reachSeries, seatWindow }, { status, headers: NO_STORE });
  } catch (error) {
    console.error("cron tick failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "tick failed" }, { status: 500, headers: NO_STORE });
  }
}

export const GET = handle;
export const POST = handle;
