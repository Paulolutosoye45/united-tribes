import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldProgress } from "@/components/brand/ShieldProgress";
import { Journey, type JourneyStep } from "@/components/home/Journey";
import { NameForm } from "@/components/home/NameForm";
import { SeasonCard } from "@/components/home/SeasonCard";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { ROLE_LABELS, canManageRoles } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";
import { loadMyAcademy } from "@/lib/academy/server";
import { loadMatches, readMatch } from "@/lib/matching/server";
import { loadTribeWeek, loadMyCareTasks, loadMyWeek } from "@/lib/rhythm/server";
import { nudgeLine, weekRange } from "@/lib/rhythm/wording";
import { loadMyTribe } from "@/lib/academy/server";
import { whenLine } from "@/lib/matching/wording";
import { nextAction, shieldFills as trainingFills } from "@/lib/academy/options";
import { STATUS_INFO } from "@/lib/leaders/options";
import { SECONDS_PER_STEP, isStepId, shieldFills, stepsLeft } from "@/lib/intake/steps";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Home" };

function greeting(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Lagos" }).format(now),
  );
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function HomePage() {
  const session = await requireSession("/home");
  // The platform owner has no member journey to follow: their home is the console.
  if (session.god === "open") redirect("/god");
  const supabase = await createClient();

  const [season, profile, draft, leaderApp, firstRead, rhythm] = await Promise.all([
    supabase
      .from("seasons")
      .select("name, starts_on, ends_on, weeks, status")
      .in("status", ["planning", "open", "running"])
      .order("starts_on", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("member_profiles").select("submitted_at").eq("person_id", session.person.id).maybeSingle(),
    supabase.from("intake_drafts").select("step").eq("person_id", session.person.id).maybeSingle(),
    supabase.from("leader_applications").select("status").eq("person_id", session.person.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    readMatch(supabase),
    loadMyWeek(supabase),
  ]);

  // The first time someone with a finished form lands here, run the match once so Home can say the tribes are ready.
  // After that Home only reads; the My tribe page refreshes it.
  const match =
    profile.data && firstRead && firstRead.profile && !firstRead.ran && !firstRead.placement
      ? await loadMatches(supabase)
      : firstRead;

  const inTraining = session.roles.includes("leader") || session.roles.includes("assistant_leader");
  const academy = inTraining ? await loadMyAcademy(supabase) : null;
  const training = academy ? nextAction(academy) : null;

  const inSeason = rhythm.placed && rhythm.state !== "before" ? rhythm : null;

  // Anyone who has been given a care task is told on Home, with the soonest deadline.
  const careTasks = session.roles.some((r) => ["coach", "assistant_leader", "leader", "care_lead", "pastor", "director"].includes(r))
    ? await loadMyCareTasks(supabase)
    : null;
  const careMine = careTasks?.mine ?? [];

  // A certified leader with a published tribe sees the tribe's week.
  const leaderCard = inTraining && academy?.state.certified ? await loadMyTribe(supabase) : null;
  const leaderWeek = leaderCard && leaderCard.status === "approved" ? await loadTribeWeek(supabase, leaderCard.id) : null;

  const name = session.person.preferredName ?? session.person.fullName?.split(" ")[0] ?? null;
  const extraRoles = session.roles.filter((r) => r !== "member");
  const finished = Boolean(profile.data);
  const placed = match?.placement ?? null;
  const shownCount = match?.tribes.length ?? 0;
  const draftStep = draft.data && isStepId(draft.data.step) ? draft.data.step : null;
  const minutesLeft = draftStep ? Math.max(1, Math.ceil(((stepsLeft(draftStep) + 1) * SECONDS_PER_STEP) / 60)) : 4;

  const journey: JourneyStep[] = [
    { title: "Sign in", detail: "Your account is ready.", state: "done" },
    {
      title: "Tell us about your season",
      detail: finished ? "Your answers are saved." : "About four minutes. Tap, type or speak.",
      state: finished ? "done" : "current",
    },
    {
      title: "Meet your three best-fit tribes",
      detail: "Each comes with its own compatibility score.",
      state: finished ? "current" : "later",
    },
    { title: "Join one and grow for twelve weeks", detail: "Weekly meetings, a shared goal, real friends.", state: "later" },
  ];
  if (inSeason) {
    journey[1].state = "done";
    journey[2] = { title: "Meet your three best-fit tribes", detail: "You chose yours.", state: "done" };
    journey[3] = {
      title: "Join one and grow for twelve weeks",
      detail: inSeason.state === "complete" ? "Your twelve weeks are done." : `Week ${inSeason.week} of ${inSeason.weeks}.`,
      state: inSeason.state === "complete" ? "done" : "current",
    };
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="stagger flex flex-col gap-3">
        <h1 className="t-title" style={{ ["--i" as string]: 0 }}>
          {name ? `${greeting()}, ${name}.` : `${greeting()}.`}
        </h1>
        {extraRoles.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Your roles" style={{ ["--i" as string]: 1 }}>
            {extraRoles.map((role) => (
              <li key={role}>
                <Badge tone="gold">{ROLE_LABELS[role]}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {name ? null : <NameForm />}

      {training && academy && !academy.state.certified ? (
        <section aria-label="Your next step" className="night rise-in rounded-[var(--radius-sheet)] p-6 sm:p-10">
          <div className="flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-[34rem] flex-col gap-4">
              <h2 className="t-title min-h-14 pr-14 sm:min-h-0 sm:pr-0">{training.title}</h2>
              <p className="t-body text-white/80">{training.body}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={training.href} className={buttonClasses({ className: "px-8" })}>
                  <span className="relative">{training.cta}</span>
                </Link>
                <span className="t-small text-white/70">Leader training</span>
              </div>
            </div>
            <div className="absolute right-5 top-5 origin-top-right scale-50 sm:static sm:shrink-0 sm:scale-100">
              <ShieldProgress fills={trainingFills(academy)} size={104} tone="light" label="Your training progress" />
            </div>
          </div>
        </section>
      ) : inSeason ? (
        <section aria-label="Your week" className="night rise-in rounded-[var(--radius-sheet)] p-6 sm:p-10">
          <div className="flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-[34rem] flex-col gap-4">
              <p className="t-small text-white/70">
                {inSeason.state === "running" ? `Week ${inSeason.week} of ${inSeason.weeks} · ${weekRange(addDays(inSeason.starts_on, ((inSeason.week ?? 1) - 1) * 7))}` : inSeason.tribe.name}
              </p>
              <h2 className="t-title min-h-14 pr-14 sm:min-h-0 sm:pr-0">
                {inSeason.state === "running" && inSeason.guide ? inSeason.guide.title : "Your season is complete."}
              </h2>
              <p className="t-body text-white/80">
                {inSeason.nudges.length > 0
                  ? nudgeLine(inSeason.nudges[0].kind, inSeason.nudges[0].week, inSeason.weeks).title
                  : inSeason.state === "running"
                    ? "Your step is chosen. Come back on Friday to check in."
                    : "Thank you for walking with your tribe."}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/tribe" className={buttonClasses({ className: "px-8" })}>
                  <span className="relative">{inSeason.state === "running" ? "Open this week" : "Open my tribe"}</span>
                </Link>
                {inSeason.nudges.length > 1 ? <span className="t-small text-white/70">{inSeason.nudges.length} things for you</span> : null}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section aria-label="Your next step" className="night rise-in rounded-[var(--radius-sheet)] p-6 sm:p-10">
          <div className="flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-[34rem] flex-col gap-4">
              <h2 className="t-title min-h-14 pr-14 sm:min-h-0 sm:pr-0">
                {placed
                  ? `You’re in ${placed.tribe.name}.`
                  : finished
                    ? shownCount > 0
                      ? "Your tribes are ready."
                      : "We’re finding your tribes."
                    : draftStep
                      ? "Pick up where you left off."
                      : "Find your tribe."}
              </h2>
              <p className="t-body text-white/80">
                {placed
                  ? `${whenLine(placed.tribe)}. ${placed.tribe.leader_first_name} will be in touch before your first meeting.`
                  : finished
                    ? shownCount > 0
                      ? `We found ${shownCount === 3 ? "three tribes" : shownCount === 1 ? "a tribe" : `${shownCount} tribes`} that fit you, each with its own score. Choose one to join.`
                      : "Your answers are saved. Tribes open as leaders finish their training, and you will see them here."
                    : draftStep
                      ? `About ${minutesLeft} ${minutesLeft === 1 ? "minute" : "minutes"} to go. Your answers so far are saved.`
                      : "Answer a few questions about your season and your goal. We’ll show you three tribes that fit, each with its own score."}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={finished ? "/tribe" : "/join"} className={buttonClasses({ className: "px-8" })}>
                  <span className="relative">{placed ? "Open my tribe" : finished ? (shownCount > 0 ? "See my tribes" : "See where it stands") : draftStep ? "Continue" : "Start"}</span>
                </Link>
                {!finished ? <span className="t-small text-white/70">About four minutes</span> : null}
              </div>
            </div>
            <div className="absolute right-5 top-5 origin-top-right scale-50 sm:static sm:shrink-0 sm:scale-100">
              <ShieldProgress
                fills={finished ? [1, 1, 1, 1] : draftStep ? shieldFills(draftStep) : [0, 0, 0, 0]}
                size={104}
                tone="light"
                label={finished ? "Your shield is complete" : "Your progress"}
                done={finished}
              />
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-start">
        <div className="flex flex-col gap-8">
          {season.data ? <SeasonCard season={season.data} /> : <p className="t-body text-soft">No season is scheduled yet.</p>}

          {training && academy && !academy.state.certified ? (
            <section aria-labelledby="own-heading" className="card flex flex-col gap-3 p-6">
              <h2 id="own-heading" className="t-heading">
                Your own season
              </h2>
              <p className="t-body text-soft">
                {finished ? "Your answers are saved." : "Tell us about your own season and goal too, so you are known to the programme as a member as well as a leader."}
              </p>
              <Link href="/join" className={buttonClasses({ variant: "solid", size: "md", className: "w-fit" })}>
                <span className="relative">{finished ? "View or change answers" : draftStep ? "Continue" : "Start"}</span>
              </Link>
            </section>
          ) : leaderWeek && leaderWeek.state !== "before" ? (
            <section aria-labelledby="lead-heading" className="card flex flex-col gap-3 p-6">
              <h2 id="lead-heading" className="t-heading">
                Your tribe this week
              </h2>
              <div>
                <p className="font-semibold">
                  {leaderWeek.tribe.name}, week {leaderWeek.week} of {leaderWeek.weeks}
                </p>
                <p className="t-body text-soft">
                  {leaderWeek.follow_ups.length > 0
                    ? `${leaderWeek.follow_ups.length === 1 ? "One person needs" : `${leaderWeek.follow_ups.length} people need`} a call. `
                    : ""}
                  {leaderWeek.report.status === "no_log"
                    ? "This week’s meeting has not been logged yet."
                    : leaderWeek.log
                      ? "This week’s log is saved."
                      : "Prepare this week’s meeting and log it afterwards."}
                  {leaderWeek.testimonies_waiting > 0 ? ` ${leaderWeek.testimonies_waiting} testimon${leaderWeek.testimonies_waiting === 1 ? "y is" : "ies are"} waiting for you.` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/lead/week" className={buttonClasses({ variant: "solid", size: "md", className: "w-fit" })}>
                  <span className="relative">Open this week</span>
                </Link>
                <Link href="/lead/progress" className={buttonClasses({ variant: "quiet", size: "md", className: "w-fit" })}>
                  <span className="relative">The season so far</span>
                </Link>
              </div>
            </section>
          ) : training ? (
            <section aria-labelledby="lead-heading" className="card flex flex-col gap-3 p-6">
              <h2 id="lead-heading" className="t-heading">
                Your training
              </h2>
              <div>
                <p className="font-semibold">{training.title}</p>
                <p className="t-body text-soft">{training.body}</p>
              </div>
              <Link href={training.href} className={buttonClasses({ variant: "solid", size: "md", className: "w-fit" })}>
                <span className="relative">{training.cta}</span>
              </Link>
            </section>
          ) : (
            <section aria-labelledby="lead-heading" className="card flex flex-col gap-3 p-6">
              <h2 id="lead-heading" className="t-heading">
                {leaderApp.data && leaderApp.data.status !== "ineligible" ? "Your leader application" : "Could you lead a tribe?"}
              </h2>
              <p className="t-body text-soft">
                {leaderApp.data && leaderApp.data.status !== "ineligible"
                  ? `${STATUS_INFO[leaderApp.data.status]?.label ?? "In progress"}. ${STATUS_INFO[leaderApp.data.status]?.line ?? ""}`
                  : "If you have lived through a Season Goal, you could walk with others through it. Applications take about fifteen minutes."}
              </p>
              <Link href="/lead" className={buttonClasses({ variant: "solid", size: "md", className: "w-fit" })}>
                <span className="relative">{leaderApp.data && leaderApp.data.status !== "ineligible" ? "See where it stands" : "Learn more"}</span>
              </Link>
            </section>
          )}

          {careMine.length > 0 ? (
            <section aria-labelledby="care-heading" className="card flex flex-col gap-3 p-6">
              <h2 id="care-heading" className="t-heading">
                Care tasks
              </h2>
              <p className="t-body text-soft">
                {careMine.length === 1 ? "One person is" : `${careMine.length} people are`} waiting on you.{" "}
                {careMine.some((t) => t.overdue) ? "At least one is late. " : ""}
                {dueSoonest(careMine)}
              </p>
              <Link href="/care" className={buttonClasses({ variant: "solid", size: "md", className: "w-fit" })}>
                <span className="relative">Open care tasks</span>
              </Link>
            </section>
          ) : null}

          {canManageRoles(session.roles) ? (
            <section aria-labelledby="run-heading" className="card flex flex-col gap-3 p-6">
              <h2 id="run-heading" className="t-heading">
                Run the programme
              </h2>
              <p className="t-body text-soft">
                Invite the pastors, coaches and leaders who will run United Tribes. They get their roles the first time they sign in.
              </p>
              <Link href="/admin" className={buttonClasses({ variant: "solid", size: "md", className: "w-fit" })}>
                <span className="relative">Open Admin</span>
              </Link>
            </section>
          ) : null}
        </div>

        <section aria-labelledby="journey-heading" className="flex flex-col gap-3">
          <h2 id="journey-heading" className="t-heading">
            Your journey
          </h2>
          <Journey steps={journey} />
        </section>
      </div>
    </div>
  );
}

function dueSoonest(tasks: { days_left: number }[]): string {
  const d = Math.min(...tasks.map((t) => t.days_left));
  return d < 0 ? "" : d === 0 ? "The soonest is due today." : d === 1 ? "The soonest is due tomorrow." : `The soonest is due in ${d} days.`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
