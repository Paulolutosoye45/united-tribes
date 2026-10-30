"use client";

import { useState } from "react";
import { pauseWhatsappAction, resumeWhatsappAction, saveGuardSettingsAction } from "@/app/(app)/admin/messages/actions";
import { Button } from "@/components/ui/Button";
import { whenText } from "@/lib/signin/admin";
import { LOG_WORDS, guardAdvice, guardHeadline, type GuardView } from "@/lib/whatsapp/guard";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

const TONE = { good: "bg-success/15 text-success", warn: "bg-flame/15 text-flame-deep", quiet: "bg-surface-strong text-ink" } as const;

/** The WhatsApp safety net for the whole church: whether messages are going, the stop button, and what to do when Meta refuses. Shown only when the net is Rehearsal or On. */
export function WhatsAppGuardCard({ guard }: { guard: GuardView }) {
  const d = useDo();
  const head = guardHeadline(guard);
  const advice = guardAdvice(guard);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [count, setCount] = useState(String(guard.settings.tripCount));
  const [minutes, setMinutes] = useState(String(guard.settings.tripMinutes));
  const [hours, setHours] = useState(String(guard.settings.unconfirmedHours));
  const [asking, setAsking] = useState<"pause" | "resume" | "settings" | null>(null);

  const field = "h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none";
  const done = () => setAsking(null);

  return (
    <section aria-labelledby="wa-guard-heading" className="card flex flex-col gap-5 p-5 sm:p-6" data-testid="wa-guard">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="wa-guard-heading" className="t-heading">
            WhatsApp messages
          </h2>
          <p className="t-small max-w-[60ch] text-soft">{head.line}</p>
        </div>
        <span data-testid="wa-guard-now" className={`rounded-full px-4 py-1.5 font-semibold ${TONE[head.tone]}`}>
          {head.word}
        </span>
      </div>

      {guard.paused ? (
        <div className="flex flex-col gap-1 rounded-[var(--radius-control)] bg-flame/10 px-4 py-4" data-testid="wa-guard-paused">
          <p className="font-semibold">
            {guard.auto ? "It paused itself" : "Paused"}
            {guard.pausedAt ? ` on ${whenText(guard.pausedAt)}` : ""}
            {!guard.auto && guard.pausedBy ? ` by ${guard.pausedBy}` : ""}
          </p>
          {guard.reason ? <p className="t-small">{guard.reason}</p> : null}
          <p className="t-small text-soft">It will not start again by itself. When you have looked into it, restart it here.</p>
        </div>
      ) : null}

      {guard.state === "rehearsal" && guard.wouldPauseAt ? (
        <p role="note" className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="wa-guard-would">
          In Rehearsal it would have paused on {whenText(guard.wouldPauseAt)}. Nothing was held back.
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="t-small text-soft">Account refusals counted now</dt>
          <dd className="text-xl font-semibold" data-testid="wa-guard-faults">
            {guard.faultsNow} of {guard.settings.tripCount}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="t-small text-soft">Sent, no receipt after {guard.settings.unconfirmedHours} hours</dt>
          <dd className="text-xl font-semibold" data-testid="wa-guard-unconfirmed">
            {guard.unconfirmed.count}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="t-small text-soft">Oldest still waiting</dt>
          <dd className="text-xl font-semibold">{guard.unconfirmed.oldest ? whenText(guard.unconfirmed.oldest) : "None"}</dd>
        </div>
      </dl>

      {advice ? (
        <div className="flex flex-col gap-1 border-t border-line pt-4" data-testid="wa-guard-advice">
          <p className="font-semibold">Most common refusal in the last day: Meta {advice.code}</p>
          <p className="t-small">{advice.cause}</p>
          <p className="t-small text-soft">{advice.fix}</p>
        </div>
      ) : null}

      {guard.canChange && guard.state !== "off" ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          {asking === "pause" ? (
            <div className="pop-in flex flex-col gap-3">
              <label htmlFor="wa-pause-reason" className="t-small font-medium">
                Why are you pausing WhatsApp? (at least 8 characters; it goes in the log)
              </label>
              <input id="wa-pause-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={field} />
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="solid"
                  size="md"
                  loading={d.busy === "pause"}
                  disabled={reason.trim().length < 8}
                  onClick={() => void d.go("pause", () => pauseWhatsappAction(reason.trim()), { saved: "WhatsApp is paused. Messages go to email or text instead.", after: () => { done(); setReason(""); } })}
                >
                  Pause WhatsApp messages
                </Button>
                <Button variant="ghost" size="md" onClick={done}>
                  Not now
                </Button>
              </div>
            </div>
          ) : asking === "resume" ? (
            <div className="pop-in flex flex-col gap-3">
              <label htmlFor="wa-resume-note" className="t-small font-medium">
                A note for the log (optional): what you found
              </label>
              <input id="wa-resume-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className={field} />
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="solid"
                  size="md"
                  loading={d.busy === "resume"}
                  onClick={() => void d.go("resume", () => resumeWhatsappAction(note.trim()), { saved: "WhatsApp restarted. It will pause again if Meta keeps refusing.", after: () => { done(); setNote(""); } })}
                >
                  Restart WhatsApp messages
                </Button>
                <Button variant="ghost" size="md" onClick={done}>
                  Not yet
                </Button>
              </div>
            </div>
          ) : guard.paused ? (
            <div>
              <Button size="md" onClick={() => setAsking("resume")}>
                I have looked into it: restart
              </Button>
            </div>
          ) : guard.state === "on" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="t-small max-w-[52ch] text-soft">Stops every WhatsApp message at once. Each goes to the person’s next channel instead; nothing is lost. For sign-in codes only, use Sending and email.</p>
              <Button variant="quiet" size="md" onClick={() => setAsking("pause")}>
                Pause all WhatsApp messages
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {guard.canSettings ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          {asking === "settings" ? (
            <form
              className="pop-in flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void d.go("settings", () => saveGuardSettingsAction(Number(count), Number(minutes), Number(hours)), { saved: "Saved.", after: done });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
                  Pause after this many refusals (2–50)
                  <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} className={field} />
                </label>
                <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
                  within this many minutes (5–240)
                  <input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} className={field} />
                </label>
                <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
                  Count as unconfirmed after hours (2–168)
                  <input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} className={field} />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" variant="solid" size="md" loading={d.busy === "settings"}>
                  Save
                </Button>
                <Button type="button" variant="ghost" size="md" onClick={done}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button variant="ghost" size="md" onClick={() => setAsking("settings")}>
                Change when it pauses by itself
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <Notice error={d.error} saved={d.saved} />

      {guard.log.length > 0 ? (
        <details className="border-t border-line pt-4">
          <summary className="t-small cursor-pointer font-medium">What happened lately</summary>
          <ul className="t-small mt-3 flex flex-col gap-2" data-testid="wa-guard-log">
            {guard.log.map((l, i) => (
              <li key={`${l.at}-${i}`}>
                <span className="text-soft">{whenText(l.at)}</span> · {LOG_WORDS[l.kind] ?? l.kind}
                {l.by ? ` (${l.by})` : ""}
                {l.reason ? `: ${l.reason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
