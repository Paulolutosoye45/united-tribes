import type { Metadata } from "next";
import { connection } from "next/server";
import { FeaturesBoard } from "@/components/god/FeaturesBoard";
import { PlacedAnswersSettingsCard } from "@/components/god/PlacedAnswersSettingsCard";
import { PlacedNudgeSettingsCard } from "@/components/god/PlacedNudgeSettingsCard";
import { ReachSettingsCard } from "@/components/god/ReachSettingsCard";
import { loadFeatureBoard, loadFeatureLog, loadReachSettings } from "@/lib/features/server";
import { loadAnswersSettings } from "@/lib/placement/answers-server";
import { loadPlacedNudgeSettings } from "@/lib/placement/nudge-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Features" };

/**
 * The switchboard for Profiles and the Weekly Rhythm. Every switch of these functions is here and nowhere else. The console's layout
 * already shows this to nobody but the unlocked owner, and every function behind it checks again.
 */
export default async function GodFeaturesPage() {
  await connection();
  const supabase = await createClient();
  const [board, log, reach, nudge, answers] = await Promise.all([loadFeatureBoard(supabase), loadFeatureLog(supabase, 60), loadReachSettings(supabase), loadPlacedNudgeSettings(supabase), loadAnswersSettings(supabase)]);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Features</h1>
        <p className="t-body measure text-soft">
          The new functions of Profiles and the Weekly Rhythm, one switch each. Every one starts Off, and only you can move it. A switch can be set for the whole church, or for one centre, community, tribe or person, and the narrowest rule wins.
        </p>
      </header>
      {board ? (
        <>
          <FeaturesBoard board={board} log={log} />
          {reach ? <ReachSettingsCard settings={reach} /> : null}
          {nudge ? <PlacedNudgeSettingsCard settings={nudge} /> : null}
          {answers ? <PlacedAnswersSettingsCard settings={answers} /> : null}
        </>
      ) : (
        <p className="card t-body p-5 text-soft">The Features switchboard is not available right now. Reload the page, or unlock the console again. If the database has not had the Stage 1 file applied yet, every new function is simply Off.</p>
      )}
    </div>
  );
}
