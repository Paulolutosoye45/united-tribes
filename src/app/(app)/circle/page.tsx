import type { Metadata } from "next";
import Link from "next/link";
import { MatchList } from "@/components/matching/MatchList";
import { PlacementView } from "@/components/matching/PlacementView";
import { WeekView } from "@/components/rhythm/WeekView";
import { buttonClasses } from "@/components/ui/Button";
import { requireSession } from "@/lib/auth/session";
import { loadMatches } from "@/lib/matching/server";
import { loadMyProgress } from "@/lib/dashboard/server";
import { loadMyWeek } from "@/lib/rhythm/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My circle" };

type SearchParams = Promise<{ joined?: string; week?: string }>;

export default async function CirclePage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession("/circle");
  const { joined, week } = await searchParams;
  const supabase = await createClient();

  // Once the season has begun, a member's circle page is their week.
  const view = week && /^\d{1,2}$/.test(week) ? Number(week) : null;
  const [rhythm, progress] = await Promise.all([loadMyWeek(supabase, view), loadMyProgress(supabase)]);
  if (rhythm.placed && rhythm.state !== "before") {
    return <WeekView week={rhythm} progress={progress} />;
  }

  const match = await loadMatches(supabase);

  if (match?.placement) {
    return <PlacementView placement={match.placement} justJoined={joined === "1"} />;
  }

  if (!match?.profile) {
    return (
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="t-title">Find your circle</h1>
          <p className="t-body measure text-soft">Tell us about your season and your goal first. It takes about four minutes, and then we show you three circles that fit, each with its own score.</p>
        </header>
        <div>
          <Link href="/join" className={buttonClasses({ className: "px-8" })}>
            <span className="relative">Start</span>
          </Link>
        </div>
      </div>
    );
  }

  return <MatchList match={match} />;
}
