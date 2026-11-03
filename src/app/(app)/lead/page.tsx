import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { ShieldProgress } from "@/components/brand/ShieldProgress";
import { FirstCheckPanel } from "@/components/leaders/FirstCheckPanel";
import { InterviewPicker, type InterviewOptions } from "@/components/leaders/InterviewPicker";
import { LeaderOffer } from "@/components/leaders/LeaderOffer";
import { LeadingPeople, LeadingStrip } from "@/components/leaders/LeadingTribe";
import { RefereeLinks } from "@/components/leaders/RefereeLinks";
import { StageList } from "@/components/leaders/StageList";
import { DetailsStrip } from "@/components/profile/DetailsStrip";
import { WithdrawApplication } from "@/components/leaders/WithdrawApplication";
import { buttonClasses } from "@/components/ui/Button";
import { trainingAsk, trainingButton } from "@/lib/academy/wording";
import { loadAcademyModes, loadMyAcademy } from "@/lib/academy/server";
import { requireSession } from "@/lib/auth/session";
import { appointedLine, appointedSteps, appointedTitle, parseMyAppointment, trainingFinished } from "@/lib/leaders/appointed";
import { ELIGIBILITY, ELIGIBILITY_ADVICE, OTHER_WAYS_TO_SERVE, STATUS_INFO, type EligibilityId } from "@/lib/leaders/options";
import type { StageModes } from "@/lib/leaders/modes";
import { WIRED, type EligibilityKey } from "@/lib/leaders/pipeline";
import type { StageState } from "@/lib/leaders/status";
import { parseMyOffer } from "@/lib/leaders/board";
import { leadingFills, leadingLine, leadingTitle } from "@/lib/leaders/leading";
import { LEADER_CONSENT_AI } from "@/lib/leaders/consent";
import { readFirstCheckStatus } from "@/lib/leaders/quality/status";
import { BROWSER_COOKIE, traceOf } from "@/lib/leaders/referee/trace";
import { loadApplyModes, loadLeadingPeople, loadMyApplication, loadMyLeading, loadPipeline } from "@/lib/leaders/server";
import { isDecided, isInReview, stageStates } from "@/lib/leaders/status";
import { isStepId, minutesLeft, resolveStep, shieldFills } from "@/lib/leaders/steps";
import { outlineDetails, stageDetails, statusLine } from "@/lib/leaders/wording";
import { loadReachGaps } from "@/lib/contact-gaps/server";
import { loadNumberGaps } from "@/lib/messaging/number-rule-server";
import { loadMyPage } from "@/lib/profile/server";
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

  // Which steps apply to this application, worked out by the database. Without one, the positions now.
  const modes = await loadApplyModes(supabase, application?.id ?? null);
  // Whether the Academy and the declaration are asked for: what the approval line and the training button say
  const training = await loadAcademyModes(supabase);
  const trainingTo = trainingButton(training);
  const status = application?.status ?? "none";
  const interviewing = ["interview_invited", "interview_booked", "interviewed"].includes(status);
  const options = interviewing ? ((await supabase.rpc("my_interview_options")).data as InterviewOptions | null) : null;
  const isLeader = session.roles.includes("leader") || session.roles.includes("assistant_leader");
  // Details waiting for a leader's own confirmation (My page). Zero unless the function is open for them, so with it Off the page is as it was.
  const toCheck = isLeader ? await loadMyPage(supabase).then((p) => (p.enabled ? p.facts.filter((f) => f.state === "unconfirmed").length : 0)) : 0;
  // The tribe a leader leads, and the people who have joined it, however they came to lead (an application, an appointment, or the role given
  // directly). Null for anyone who leads nothing, and when the database cannot say: the page is then as it was.
  const leading = isLeader ? await loadMyLeading(supabase) : null;
  const people = leading && leading.tribeStatus === "approved" ? await loadLeadingPeople(supabase, leading.tribeId) : null;
  // Who in the tribe has not added a phone number yet (so the leader can ask in person). Nobody, while the rule is Off.
  const gaps = leading && people ? await loadNumberGaps(supabase, leading.tribeId) : null;
  // Who the leader cannot reach on WhatsApp, with a button to ask them (Contact gaps). Nobody, while that is Off.
  const reach = leading && people ? await loadReachGaps(supabase, leading.tribeId) : null;

  // ------------------------------------------------------------------ appointed
  // A leader the church appointed has no application to show, so the page would call them someone who has never applied. The database
  // says whether they are appointed and where their Tribe Card stands, never by whom. Someone approved through the application keeps
  // the page below, and if the lookup is unavailable the page is as it was.
  const appointment =
    isLeader && status !== "approved_leader" && status !== "approved_assistant" ? parseMyAppointment((await supabase.rpc("my_appointment")).data) : null;
  if (appointment) {
    const mine = await loadMyAcademy(supabase);
    const trainingDone = mine ? trainingFinished(mine.state, training) : false;
    const trained = appointment.certified || trainingDone;
    const steps = appointedSteps(appointment, training, trainingDone);
    const links = [
      ...(trainingTo && !trained ? [trainingTo] : []),
      ...(session.roles.includes("leader") ? [{ label: "My Tribe Card", href: "/lead/tribe" }] : []),
      { label: "This week", href: "/lead/week" },
    ];
    const complete = appointment.tribeStatus === "approved" && appointment.certified;
    // An application they began before they were appointed is not needed now. They can delete it, and until they do the panel may still ask about it.
    const leftover = application && ["draft", "submitted", "interview_invited", "interview_booked", "interviewed"].includes(application.status) ? application : null;
    return (
      <div className="flex flex-col gap-8">
        <section aria-labelledby="status-heading" data-testid="appointed" className="night rise-in rounded-[var(--radius-sheet)] p-6 sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-[34rem] flex-col gap-3">
              <p className="t-small text-white/70">Your leader role</p>
              <h1 id="status-heading" className="t-title pr-14 sm:pr-0">
                {appointedTitle(appointment)}
              </h1>
              <p className="t-body text-white/80">{appointedLine(appointment, training, trainingDone)}</p>
              <div className="mt-1 flex flex-wrap gap-3">
                {links.map((l, i) => (
                  <Link key={l.href} href={l.href} className={buttonClasses(i === 0 ? { className: "px-8" } : { variant: "night", className: "px-6" })}>
                    <span className="relative">{l.label}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="absolute right-5 top-5 origin-top-right scale-50 sm:static sm:shrink-0 sm:scale-100">
              <ShieldProgress fills={approvedFills(steps)} size={104} tone="light" label="Your progress" done={complete} />
            </div>
          </div>
        </section>

        <DetailsStrip count={toCheck} />

        {leading && people ? <LeadingPeople leading={leading} people={people} gaps={gaps} reach={reach} /> : null}

        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <StageList stages={steps} states={steps} />
          {leftover ? (
            <section aria-labelledby="open-app-heading" className="card flex flex-col gap-3 p-6">
              <h2 id="open-app-heading" className="t-heading">
                An application you started
              </h2>
              <p className="t-body text-soft">
                You do not need it, because you have already been appointed.
                {leftover.status !== "draft" ? " Until you delete it, the review panel may still contact you about it." : ""}
              </p>
              <div>
                <WithdrawApplication appId={leftover.id} sent={leftover.status !== "draft"} />
              </div>
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ leads a tribe, no application and no appointment
  // A leader whose role was given directly has neither, so the page would call them someone who has never applied and offer them an
  // application. They lead a tribe: say so, and show what is true for them.
  if (!application && leading) {
    const mine = await loadMyAcademy(supabase);
    const trainingDone = mine ? trainingFinished(mine.state, training) : false;
    const trained = leading.certified || trainingDone;
    const links = [
      ...(trainingTo && !trained ? [trainingTo] : []),
      { label: leading.role === "leader" ? "My Tribe Card" : "Read the Tribe Card", href: "/lead/tribe" },
      { label: "This week", href: "/lead/week" },
    ];
    const fills = leadingFills(leading);
    return (
      <div className="flex flex-col gap-8">
        <section aria-labelledby="status-heading" data-testid="leading" className="night rise-in rounded-[var(--radius-sheet)] p-6 sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-[34rem] flex-col gap-3">
              <p className="t-small text-white/70">Your tribe</p>
              <h1 id="status-heading" className="t-title pr-14 sm:pr-0">
                {leadingTitle(leading)}
              </h1>
              <p className="t-body text-white/80">{leadingLine(leading)}</p>
              <div className="mt-1 flex flex-wrap gap-3">
                {links.map((l, i) => (
                  <Link key={l.href} href={l.href} className={buttonClasses(i === 0 ? { className: "px-8" } : { variant: "night", className: "px-6" })}>
                    <span className="relative">{l.label}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="absolute right-5 top-5 origin-top-right scale-50 sm:static sm:shrink-0 sm:scale-100">
              <ShieldProgress fills={fills} size={104} tone="light" label="Your tribe" done={fills.every((f) => f === 1)} />
            </div>
          </div>
        </section>

        <DetailsStrip count={toCheck} />

        {people ? <LeadingPeople leading={leading} people={people} gaps={gaps} reach={reach} /> : null}
      </div>
    );
  }

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
          <StageList heading="How it works" states={outline(modes)} details={outlineDetails(modes)} />
          <section className="card flex flex-col gap-3 p-6" aria-labelledby="asks-heading">
            <h2 id="asks-heading" className="t-heading">
              What it asks of you
            </h2>
            <ul className="t-body flex flex-col gap-2 text-soft">
              <li>75 minutes a week, for 12 weeks.</li>
              {trainingAsk(training) ? <li>{trainingAsk(training)}</li> : null}
              <li>Keeping what members share private, unless someone is at risk.</li>
              {asksAnyOf(modes, ["member6", "foundation", "serving"]) ? <li>{membershipLine(modes)}</li> : null}
            </ul>
          </section>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ in progress
  if (application.status === "draft") {
    const step = resolveStep(isStepId(application.step) ? application.step : "eligibility", modes);
    // Find your tribe adds about a minute to a form that has not reached it yet
    const fit = WIRED.tribeFit && (await loadPipeline(supabase)).tribeFit;
    const left = minutesLeft(step, modes, fit);
    return (
      <div className="flex flex-col gap-8">
        <Hero
          title="Pick up where you left off."
          body={`About ${left} ${left === 1 ? "minute" : "minutes"} to go. Your answers so far are saved.`}
          cta="Continue my application"
          note="Only the review panel will see it."
          fills={shieldFills(step, modes)}
        />
        {leading ? <LeadingStrip leading={leading} /> : null}
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
        {leading ? <LeadingStrip leading={leading} /> : null}
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
  const states = stageStates(application.status, answered, modes, references.length);
  const decided = isDecided(application.status);
  const approved = application.status === "approved_leader" || application.status === "approved_assistant";

  // The first check on written answers, while the application is in review. Switched off, this is simply null.
  const firstCheck = isInReview(application.status) ? readFirstCheckStatus((await supabase.rpc("leader_ai_status", { p_app: application.id })).data) : null;
  const checkOn = firstCheck?.mode === "on";
  const refereesOpen = !checkOn || firstCheck?.refereesOpen !== false;
  // An open offer to lead a tribe where members are waiting. The database returns one only to a leader, and only while it is open.
  const offer = approved ? parseMyOffer((await supabase.rpc("my_leader_offers")).data) : null;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="status-heading" className="night rise-in rounded-[var(--radius-sheet)] p-6 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex max-w-[34rem] flex-col gap-3">
            <p className="t-small text-white/70">Your leader application</p>
            <h1 id="status-heading" className="t-title pr-14 sm:pr-0">
              {info.label}
            </h1>
            <p className="t-body text-white/80">{statusLine(application.status, modes, training)}</p>
            {approved ? (
              <div className="mt-1 flex flex-wrap gap-3">
                {trainingTo ? (
                  <Link href={trainingTo.href} className={buttonClasses({ className: "px-8" })}>
                    <span className="relative">{trainingTo.label}</span>
                  </Link>
                ) : null}
                {application.status === "approved_leader" ? (
                  <Link href="/lead/tribe" className={buttonClasses(trainingTo ? { variant: "night", className: "px-6" } : { className: "px-8" })}>
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

      {approved ? <DetailsStrip count={toCheck} /> : null}

      {approved && leading && people ? <LeadingPeople leading={leading} people={people} gaps={gaps} reach={reach} /> : null}

      {!approved && leading ? <LeadingStrip leading={leading} /> : null}

      {offer ? <LeaderOffer offer={offer} /> : null}

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
        <StageList states={states} details={stageDetails(modes, answered, references.length)} />
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

function approvedFills(all: { id: string; state: string }[]): [number, number, number, number] {
  // Stages that are not part of this process do not count towards the shield
  const states = all.filter((s) => s.state !== "off");
  const done = states.filter((s) => s.state === "done").length;
  const current = states.some((s) => s.state === "current") ? 0.5 : 0;
  const total = Math.min(4, ((done + current) / states.length) * 4);
  return [Math.min(1, total), Math.min(1, Math.max(0, total - 1)), Math.min(1, Math.max(0, total - 2)), Math.min(1, Math.max(0, total - 3))];
}

/** The tracker before anyone has started: every stage ahead, except the ones that are not part of the process. */
function outline(modes: StageModes) {
  return stageStates("draft", 0, modes).map((s) => ({ id: s.id, state: (s.state === "off" ? "off" : "later") as StageState }));
}

/** Whether any of these questions is put to the applicant. */
const asksAnyOf = (modes: StageModes, keys: EligibilityKey[]) => keys.some((k) => modes.eligibility[k] !== "off");

/** The line about the church, shortened to what is asked. With all three asked, it is the line it has always been. */
function membershipLine(modes: StageModes) {
  const parts = [
    modes.eligibility.member6 !== "off" ? "six months in the church" : null,
    modes.eligibility.foundation !== "off" ? "Foundation of Faith done" : null,
    modes.eligibility.serving !== "off" ? "serving somewhere now" : null,
  ].filter(Boolean) as string[];
  if (parts.length === 3) return "Six months in the church, Foundation of Faith done, and serving somewhere now.";
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
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
