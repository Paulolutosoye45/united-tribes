import type { Metadata } from "next";
import Link from "next/link";
import { MatchList } from "@/components/matching/MatchList";
import { PlacedBanner } from "@/components/matching/PlacedBanner";
import { groupNote } from "@/lib/placement/placed";
import { PlacementView } from "@/components/matching/PlacementView";
import { SwapCard } from "@/components/growth/SwapCard";
import { TeenWaiting } from "@/components/guardian/TeenWaiting";
import { LeadingStrip } from "@/components/leaders/LeadingTribe";
import { WeekView } from "@/components/rhythm/WeekView";
import { buttonClasses } from "@/components/ui/Button";
import { requireSession } from "@/lib/auth/session";
import { loadMyGuardian, loadMySwap } from "@/lib/growth/server";
import { loadMyLeading } from "@/lib/leaders/server";
import { loadMatches } from "@/lib/matching/server";
import { loadMyPlacement } from "@/lib/placement/server";
import { loadMyProgress, loadWordDays } from "@/lib/dashboard/server";
import { loadMyWeek, loadWeekLayer } from "@/lib/rhythm/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My tribe" };

type SearchParams = Promise<{ joined?: string; week?: string }>;

export default async function TribePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession("/tribe");
  const { joined, week } = await searchParams;
  const supabase = await createClient();

  // Once the season has begun, a member's tribe page is their week.
  const view = week && /^\d{1,2}$/.test(week) ? Number(week) : null;
  const [rhythm, progress] = await Promise.all([loadMyWeek(supabase, view), loadMyProgress(supabase)]);
  if (rhythm.placed && rhythm.state !== "before") {
    const [layer, words, swap] = await Promise.all([
      loadWeekLayer(supabase, rhythm.tribe.id, rhythm.viewing ?? rhythm.week),
      loadWordDays(supabase),
      loadMySwap(supabase),
    ]);
    // An offer waiting for an answer goes first: the week is a long page and it must not be missed
    const offer = swap.in_tribe && swap.request?.status === "offered";
    const card = swap.in_tribe ? <SwapCard swap={swap} /> : null;
    return (
      <div className="flex flex-col gap-10">
        {offer ? card : null}
        <WeekView week={rhythm} progress={progress} layer={layer} words={words} />
        {offer ? null : card}
      </div>
    );
  }

  // A young person sees tribes only after a parent or guardian has said yes and the Care Team has spoken to them.
  const guardian = await loadMyGuardian(supabase);
  if (guardian.needed && guardian.state !== "ready" && !rhythm.placed) {
    return <TeenWaiting guardian={guardian} name={session.person.preferredName ?? session.person.fullName} />;
  }

  // A leader who leads a tribe sees it first: this tab is where members find theirs, and a leader's people are not here. Nothing for anyone else.
  const isLeader = session.roles.includes("leader") || session.roles.includes("assistant_leader");
  const leading = isLeader ? await loadMyLeading(supabase) : null;
  const strip = leading ? <LeadingStrip leading={leading} /> : null;

  const match = await loadMatches(supabase);

  if (match?.placement) {
    // A member the church placed is asked, above their tribe, to say yes or to keep their details private
    const placedByChurch = await loadMyPlacement(supabase);
    return (
      <div className="flex flex-col gap-8">
        {strip}
        {placedByChurch?.active ? <PlacedBanner state={placedByChurch} /> : null}
        <PlacementView placement={match.placement} justJoined={joined === "1"} groupNote={groupNote(placedByChurch)} />
      </div>
    );
  }

  if (!match?.profile) {
    return (
      <div className="flex flex-col gap-8">
        {strip}
        <header className="flex flex-col gap-3">
          <h1 className="t-title">Find your tribe</h1>
          <p className="t-body measure text-soft">Tell us about your season and your goal first. It takes about four minutes, and then we show you three tribes that fit, each with its own score.</p>
        </header>
        <div>
          <Link href="/join" className={buttonClasses({ className: "px-8" })}>
            <span className="relative">Start</span>
          </Link>
        </div>
      </div>
    );
  }

  return strip ? (
    <div className="flex flex-col gap-8">
      {strip}
      <MatchList match={match} />
    </div>
  ) : (
    <MatchList match={match} />
  );
}
