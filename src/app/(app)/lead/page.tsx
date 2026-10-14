import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { ShieldProgress } from "@/components/brand/ShieldProgress";
import { FirstCheckPanel } from "@/components/leaders/FirstCheckPanel";
import { InterviewPicker, type InterviewOptions } from "@/components/leaders/InterviewPicker";
import { RefereeLinks } from "@/components/leaders/RefereeLinks";
import { StageList } from "@/components/leaders/StageList";
import { WithdrawApplication } from "@/components/leaders/WithdrawApplication";
import { buttonClasses } from "@/components/ui/Button";
import { requireSession } from "@/lib/auth/session";
import { ELIGIBILITY, ELIGIBILITY_ADVICE, OTHER_WAYS_TO_SERVE, STATUS_INFO, type EligibilityId } from "@/lib/leaders/options";
import { LEADER_CONSENT_AI } from "@/lib/leaders/consent";
import { readFirstCheckStatus } from "@/lib/leaders/quality/status";
import { BROWSER_COOKIE, traceOf } from "@/lib/leaders/referee/trace";
import { loadMyApplication } from "@/lib/leaders/server";
import { isDecided, isInReview, stageStates } from "@/lib/leaders/status";
import { isStepId, minutesLeft, shieldFills } from "@/lib/leaders/steps";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lead a tribe" };

export default async function LeadPage() {
  const session = await requireSession("/lead");
  const supabase = await createClient();
  const { application, references } = await loadMyApplication(supabase, session.person.id);

  // Where the applicant is signed in from, as two scrambled codes, so a referee answering from the same phone can be noticed
  if (application && references.length > 0) {
    const trace = traceOf(await headers(), (await cookies()).get(BROWSER_COOKIE)?.value);
    if (trace.net && trace.bid) await supabase.rpc("referee_note_applicant", { p_net: trace.net, p_bid: trace.bid });
  }

  const status = application?.status ?? "none";
  const interviewing = ["interview_invited", "interview_booked", "interviewed"].includes(status);
  const options = interviewing ? ((await supabase.rpc("my_interview_options")).data as InterviewOptions | null) : null;
  const isLeader = session.roles.includes("leader") || session.roles.includes("assistant_leader");

  // ------------------------------------------------------------------ not started
  if (!application) {
    return (
      <div className="flex flex-col gap-8">
        <Hero
          title={isLeader ? "Lead another tribe." : "Lead a tribe."}
          body="Leaders are chosen for character and reliability, not for title or talent. If you have lived through a Season Goal, you could walk with others through it."
          cta="Start my application"
          note="About fifteen minutes. Save and come back."
          fills={[0, 0, 0, 0]}
        />
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-start">
          <StageList heading="How it works" />
          <section className="card flex flex-col gap-3 p-6" aria-labelledby="asks-heading">
            <h2 id="asks-heading" className="t-heading">
              What it asks of you
            </h2>
            <ul className="t-body flex flex-col gap-2 text-soft">
              <li>75 minutes a week, for 12 weeks.</li>
              <li>About 10 hours of training before your tribe begins, with a safeguarding course.</li>
              <li>Keeping what members share private, unless someone is at risk.</li>
              <li>Six months in the church, Foundation of Faith done, and serving somewhere now.</li>
            </ul>
          </section>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ in progress
  if (application.status === "draft") {
    const step = isStepId(application.step) ? application.step : "eligibility";
    const left = minutesLeft(step);
    return (
      <div className="flex flex-col gap-8">
        <Hero
          title="Pick up where you left off."
          body={`About ${left} ${left === 1 ? "minute" : "minutes"} to go. Your answers so far are saved.`}
          cta="Continue my application"
          note="Only the review panel will see it."
          fills={shieldFills(step)}
        />
        <div>
          <WithdrawApplication appId={application.id} sent={false} />
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ not this time
  if (application.status === "ineligible") {
    const failed = ELIGIBILITY.filter((e) => application.failedChecks.includes(e.id));
    return (
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="t-title">Not yet, and that is okay.</h1>
          <p className="t-body measure text-soft">Leading asks a lot, so we open it when each of these is in place. Here is what to do for the ones that are not yet.</p>
        </header>
        <ul className="stagger flex flex-col gap-3">
          {failed.map((item, i) => (
            <li key={item.id} style={{ ["--i" as string]: i }} className="card p-5">
              <p className="font-semibold leading-snug">{item.label}</p>
              <p className="t-small mt-1.5 text-soft">{ELIGIBILITY_ADVICE[item.id as EligibilityId]}</p>
            </li>
          ))}
        </ul>
        <section className="card flex flex-col gap-3 p-6">
          <h2 className="t-heading">Other ways to serve now</h2>
          <ul className="t-body flex flex-col gap-1 text-soft">
            {OTHER_WAYS_TO_SERVE.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
        <div className="flex flex-wrap gap-3">
          <Link href="/join" className={buttonClasses({ size: "md" })}>
            <span className="relative">Find my tribe as a member</span>
          </Link>
          <Link href="/lead/apply" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">I answered by mistake. Start again</span>
          </Link>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ sent, in review or decided
  const info = STATUS_INFO[application.status];
  const answered = references.filter((r) => r.answered).length;
  const states = stageStates(application.status, answered);
  const decided = isDecided(application.status);
  const approved = application.status === "approved_leader" || application.status === "approved_assistant";

  // The first check on written answers, while the application is in review. Switched off, this is simply null.
  const firstCheck = isInReview(application.status) ? readFirstCheckStatus((await supabase.rpc("leader_ai_status", { p_app: application.id })).data) : null;
  const checkOn = firstCheck?.mode === "on";
  const refereesOpen = !checkOn || firstCheck?.refereesOpen !== false;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="status-heading" className="night rise-in rounded-[var(--radius-sheet)] p-6 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex max-w-[34rem] flex-col gap-3">
            <p className="t-small text-white/70">Your leader application</p>
            <h1 id="status-heading" className="t-title pr-14 sm:pr-0">
              {info.label}
            </h1>
            <p className="t-body text-white/80">{info.line}</p>
            {approved ? (
              <div className="mt-1 flex flex-wrap gap-3">
                <Link href="/lead/academy" className={buttonClasses({ className: "px-8" })}>
                  <span className="relative">Open my training</span>
                </Link>
                {application.status === "approved_leader" ? (
                  <Link href="/lead/tribe" className={buttonClasses({ variant: "night", className: "px-6" })}>
                    <span className="relative">My Tribe Card</span>
                  </Link>
                ) : null}
                <Link href="/lead/week" className={buttonClasses({ variant: "night", className: "px-6" })}>
                  <span className="relative">This week</span>
                </Link>
              </div>
            ) : null}
          </div>
          <div className="absolute right-5 top-5 origin-top-right scale-50 sm:static sm:shrink-0 sm:scale-100">
            <ShieldProgress
              fills={decided ? [1, 1, 1, 1] : approvedFills(states)}
              size={104}
              tone="light"
              label={decided ? "Decision made" : "Application progress"}
              done={approved}
            />
          </div>
        </div>
      </section>

      {application.decisionNote && decided ? (
        <section aria-labelledby="note-heading" className="card flex flex-col gap-2 p-6">
          <h2 id="note-heading" className="t-heading">
            A note from the pastor
          </h2>
          <p className="t-body whitespace-pre-line text-soft">{application.decisionNote}</p>
        </section>
      ) : null}

      {application.status === "not_approved" ? (
        <section className="card flex flex-col gap-3 p-6">
          <h2 className="t-heading">Ways to serve now</h2>
          <ul className="t-body flex flex-col gap-1 text-soft">
            {OTHER_WAYS_TO_SERVE.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {firstCheck && checkOn ? <FirstCheckPanel appId={application.id} status={firstCheck} consentText={LEADER_CONSENT_AI} /> : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <StageList states={states} details={{ references: `${answered} of 2 answered` }} />
        <div className="flex flex-col gap-8">
          {isInReview(application.status) && refereesOpen && references.length > 0 ? (
            <RefereeLinks appId={application.id} applicant={session.person.preferredName ?? session.person.fullName ?? ""} references={references} />
          ) : null}
          {options ? <InterviewPicker options={options} /> : null}
        </div>
      </div>

      {!approved ? (
        <div>
          <WithdrawApplication appId={application.id} sent />
        </div>
      ) : null}
    </div>
  );
}

function approvedFills(states: { id: string; state: string }[]): [number, number, number, number] {
  const done = states.filter((s) => s.state === "done").length;
  const current = states.some((s) => s.state === "current") ? 0.5 : 0;
  const total = Math.min(4, ((done + current) / states.length) * 4);
  return [Math.min(1, total), Math.min(1, Math.max(0, total - 1)), Math.min(1, Math.max(0, total - 2)), Math.min(1, Math.max(0, total - 3))];
}

function Hero({ title, body, cta, note, fills }: { title: string; body: string; cta: string; note: string; fills: [number, number, number, number] }) {
  return (
    <section aria-label="Lead a tribe" className="night rise-in rounded-[var(--radius-sheet)] p-6 sm:p-10">
      <div className="flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-[34rem] flex-col gap-4">
          <h1 className="t-title min-h-14 pr-14 sm:min-h-0 sm:pr-0">{title}</h1>
          <p className="t-body text-white/80">{body}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/lead/apply" className={buttonClasses({ className: "px-8" })}>
              <span className="relative">{cta}</span>
            </Link>
            <span className="t-small text-white/70">{note}</span>
          </div>
        </div>
        <div className="absolute right-5 top-5 origin-top-right scale-50 sm:static sm:shrink-0 sm:scale-100">
          <ShieldProgress fills={fills} size={104} tone="light" label="Application progress" />
        </div>
      </div>
    </section>
  );
}
