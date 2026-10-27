import type { Metadata } from "next";
import { connection } from "next/server";
import { DetailsConsole } from "@/components/god/DetailsConsole";
import { isUuid } from "@/lib/leaders/errors";
import { loadFeatureBoard } from "@/lib/features/server";
import { loadDetailsChecks, loadDetailsStatus } from "@/lib/profile/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Details check" };

/**
 * Ask people to confirm the details the church holds about them. The console's layout already shows this to nobody but the unlocked owner,
 * and every function behind it checks again. The owner sees where each person stands, never what they answered.
 */
export default async function GodDetailsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await connection();
  const { run } = await searchParams;
  const supabase = await createClient();
  const [runs, board, selected] = await Promise.all([
    loadDetailsChecks(supabase),
    loadFeatureBoard(supabase),
    typeof run === "string" && isUuid(run) ? loadDetailsStatus(supabase, run) : Promise.resolve(null),
  ]);
  const row = board?.features.find((f) => f.key === "details_check") ?? null;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Details check</h1>
        <p className="t-body measure text-soft">
          Ask leaders to check a detail the church holds about them, such as the stage of life their Tribe Card is built for. Each person gets one short message and a private link that is only theirs. You see who has answered and who has not, never what they said. It starts Off: switch it on under Features first, or try it in Rehearsal.
        </p>
      </header>
      <DetailsConsole runs={runs} selected={selected} summary={row?.summary ?? "off"} available={row?.available ?? false} />
    </div>
  );
}
