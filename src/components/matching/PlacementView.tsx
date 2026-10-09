"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { releaseSeatAction } from "@/app/(app)/circle/actions";
import { ShieldBurst } from "@/components/flow/Celebration";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { clockLabel } from "@/lib/academy/options";
import { cn } from "@/lib/cn";
import { daysUntil, formatDate } from "@/lib/dates";
import type { Placement } from "@/lib/matching/types";
import { CIRCLE_TYPE_LINE, COVENANT_PROMISES, LABELS, whenLine, whereLine } from "@/lib/matching/wording";
import { SuccessPicture } from "./SuccessPicture";

/** Where a member lands after choosing: the circle, what happens next, and a way to change their mind before the season. */
export function PlacementView({ placement, justJoined }: { placement: Placement; justJoined: boolean }) {
  const router = useRouter();
  const p = placement;
  const c = p.circle;
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = daysUntil(p.season_starts_on);

  const steps = [
    {
      title: "Your leader welcomes you",
      done: p.called,
      note: p.called ? `${c.leader_first_name} has been in touch.` : `${c.leader_first_name} will message or call you before the first meeting.`,
    },
    {
      title: "Join the WhatsApp group",
      done: false,
      note: p.group_url ? "Tap the button to join. Everyone in your Tribe is there." : `${c.leader_first_name} will put the invite link here soon.`,
      action: p.group_url ? (
        <a href={p.group_url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "solid", size: "md", className: "w-fit" })}>
          <span className="relative">Join the group</span>
        </a>
      ) : null,
    },
    {
      title: "Your first meeting",
      done: false,
      note: p.first_meeting_on
        ? `${formatDate(p.first_meeting_on)}, ${clockLabel(c.meeting_time)}.`
        : `The date is coming from ${c.leader_first_name}. It should be within two weeks of the season starting, by ${formatDate(p.first_meeting_by)}.`,
    },
  ];

  async function release() {
    setBusy(true);
    setError(null);
    const result = await releaseSeatAction(reason);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.replace("/circle");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="night rise-in flex flex-col gap-5 rounded-[var(--radius-sheet)] p-6 sm:p-10" aria-labelledby="in-heading">
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:gap-8 sm:text-left">
          {justJoined ? (
            <ShieldBurst label="You have joined your Tribe" />
          ) : (
            <span aria-hidden="true" className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-white/10 text-3xl font-bold">
              {c.leader_first_name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="flex flex-col gap-2.5">
            <p className="t-small text-white/70">{justJoined ? "Your seat is confirmed" : "Your Tribe"}</p>
            <h1 id="in-heading" className="t-title">
              {justJoined ? `You’re in, ${c.name}.` : c.name}
            </h1>
            <p className="t-body text-white/80">
              {whenLine(c)}. {whereLine(c)}.
            </p>
            {days > 0 ? (
              <p className="t-small text-white/70">
                {p.season_name} starts on {formatDate(p.season_starts_on)}, in {days} {days === 1 ? "day" : "days"}.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="next-heading" className="flex flex-col gap-3">
        <h2 id="next-heading" className="t-heading">
          What happens next
        </h2>
        <ol className="stagger card flex flex-col p-5 sm:p-7">
          {steps.map((s, i) => (
            <li key={s.title} style={{ ["--i" as string]: i }} className="relative flex gap-4 pb-6 last:pb-0">
              {i < steps.length - 1 ? <span aria-hidden="true" className="absolute left-[13px] top-8 h-[calc(100%-2rem)] w-0.5 bg-line" /> : null}
              <span
                aria-hidden="true"
                className={cn("relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.8rem] font-bold", s.done ? "bg-gold text-on-flame" : "bg-surface-strong text-ink")}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-2">
                <p className="font-semibold leading-tight">{s.title}</p>
                <p className="t-small text-soft">{s.note}</p>
                {s.action}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="Tribe-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="Tribe-heading" className="t-heading">
              Your Tribe
            </h2>
            {p.degree !== null && p.label ? <Badge tone="gold">{p.degree}% · {LABELS[p.label].text}</Badge> : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.95rem]">
            <dt className="text-soft">Leader</dt>
            <dd className="font-medium">{c.leader_first_name}</dd>
            {p.assistant_first_name ? (
              <>
                <dt className="text-soft">Assistant</dt>
                <dd className="font-medium">{p.assistant_first_name}</dd>
              </>
            ) : null}
            <dt className="text-soft">Meets</dt>
            <dd className="font-medium">{whenLine(c)}</dd>
            <dt className="text-soft">Where</dt>
            <dd className="font-medium">{whereLine(c)}</dd>
            <dt className="text-soft">Who</dt>
            <dd className="font-medium">{CIRCLE_TYPE_LINE[c.circle_type]}</dd>
            <dt className="text-soft">Goal</dt>
            <dd className="font-medium">{c.goal}</dd>
          </dl>
        </section>

        <section aria-labelledby="covenant-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 id="covenant-heading" className="t-heading">
              What you agreed to
            </h2>
            <p className="t-small text-soft">On {formatDate(p.agreed_at.slice(0, 10))}. You will refine this with your Tribe in week 1.</p>
          </div>
          <SuccessPicture god={p.covenant.god} others={p.covenant.others} life={p.covenant.life} />
          <details className="group border-t border-line pt-2">
            <summary className="t-small flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold">
              <span>The Tribe Covenant</span>
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 transition-transform duration-300 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 8l5 5 5-5" />
              </svg>
            </summary>
            <ol className="flex flex-col gap-2 pt-1">
              {COVENANT_PROMISES.map((x, i) => (
                <li key={x} className="t-small flex gap-2.5">
                  <span aria-hidden="true" className="font-bold">
                    {i + 1}.
                  </span>
                  <span>{x}</span>
                </li>
              ))}
            </ol>
          </details>
        </section>
      </div>

      <section aria-labelledby="change-heading" className="flex flex-col gap-3">
        <h2 id="change-heading" className="t-heading">
          Need a different Tribe?
        </h2>
        {p.can_release ? (
          asking ? (
            <form
              noValidate
              className="card step-forward flex flex-col gap-4 p-5 sm:p-6"
              onSubmit={(e) => {
                e.preventDefault();
                void release();
              }}
            >
              <p className="t-body">You can give up your seat until the season starts. Your seat goes back to the Tribe and you will see your Tribes again.</p>
              <Textarea label="Why? This helps us find better Tribes." name="reason" optional rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              {error ? (
                <p role="alert" className="t-small text-danger">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button type="submit" variant="solid" size="md" loading={busy}>
                  Give up my seat
                </Button>
                <Button type="button" variant="quiet" size="md" onClick={() => setAsking(false)}>
                  Keep my seat
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="t-body measure text-soft">You can change your mind until {formatDate(p.season_starts_on)}, when the season starts.</p>
              <div>
                <Button variant="quiet" size="md" onClick={() => setAsking(true)}>
                  Choose a different Tribe
                </Button>
              </div>
            </div>
          )
        ) : (
          <p className="t-body measure text-soft">The season has started. If this Tribe is not working for you, tell {c.leader_first_name} or ask your coach to help you move.</p>
        )}
      </section>
    </div>
  );
}
