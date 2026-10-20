import type { Metadata } from "next";
import Link from "next/link";
import { TribeBuilder } from "@/components/academy/TribeBuilder";
import { TribePreview } from "@/components/academy/TribePreview";
import { MeetingLink } from "@/components/academy/MeetingLink";
import { StartCard } from "@/components/academy/StartCard";
import { valuesFromCard } from "@/lib/academy/card";
import { loadAcademyModes, loadMyTribe } from "@/lib/academy/server";
import { trainingShown } from "@/lib/academy/modes";
import { NextSeasonTribes } from "@/components/leaders/NextSeasonTribes";
import { TribeOnboarding } from "@/components/matching/TribeOnboarding";
import { loadRoster } from "@/lib/matching/server";
import { firstName } from "@/lib/academy/card";
import { requireRole } from "@/lib/auth/session";
import { parseReadyMade } from "@/lib/cards/templates";
import { parseFitMine } from "@/lib/leaders/fit";
import { loadLeaderCatalogue, loadMyApplication } from "@/lib/leaders/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tribe Card" };

export default async function TribePage() {
  const session = await requireRole(["leader", "assistant_leader"], "/lead/tribe");
  const supabase = await createClient();
  const isLeader = session.roles.includes("leader");
  const [card, catalogue, mine, modes, fitMine] = await Promise.all([
    loadMyTribe(supabase),
    loadLeaderCatalogue(supabase, { includeRetired: true }),
    isLeader ? loadMyApplication(supabase, session.person.id) : Promise.resolve(null),
    loadAcademyModes(supabase),
    // Tribes this leader could lead next season. Only extra: if it cannot be read, or Tribe fit is off, nothing is shown.
    supabase.rpc("leader_fit_mine"),
  ]);
  const next = fitMine.error ? null : parseFitMine(fitMine.data);
  const training = trainingShown(modes);

  const back = (
    <Link href={training ? "/lead/academy" : "/lead"} className="press -ml-1 inline-flex min-h-10 w-fit items-center rounded-lg px-1 text-[0.95rem] font-medium text-soft hover:text-ink">
      {training ? "← Training" : "← Lead a tribe"}
    </Link>
  );

  if (!card) {
    return (
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          {back}
          <h1 className="t-title">{isLeader ? "Your Tribe Card" : "Your tribe"}</h1>
        </header>
        {isLeader ? (
          <StartCard moduleNeeded={modes.academy === "required"} />
        ) : (
          <section className="card flex flex-col gap-3 p-6">
            <h2 className="t-heading">{training ? "Your pairing comes after your training" : "Your pairing comes after you are approved"}</h2>
            <p className="t-body measure text-soft">
              The pastorate pairs each assistant leader with a tribe whose leader leads in a different way from you, so the two of you balance each other. You will see your tribe here once that is done.
            </p>
          </section>
        )}
        {next ? <NextSeasonTribes mine={next} /> : null}
      </div>
    );
  }

  const story = mine?.application?.answers.calling.goalStory ?? null;
  const roster = card.status === "approved" ? await loadRoster(supabase, card.id) : null;
  // The signed-off ready-made card for this goal, if there is one. Only extra: if it cannot be read, the builder is as it was.
  const ready = card.role === "leader" && card.editable ? await supabase.rpc("card_template_for_tribe", { p_tribe: card.id }) : null;
  const readyMade = ready && !ready.error ? parseReadyMade(ready.data) : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        {back}
        <h1 className="t-title">{card.role === "leader" ? "Your Tribe Card" : `${card.leader.name}’s tribe`}</h1>
        <p className="t-body measure text-soft">
          {card.role === "leader"
            ? "This is the page members choose your tribe from. Each member sees it with their own Degree of Compatibility. Your work saves as you type."
            : "You are the assistant leader for this tribe. You can read the card here; the leader writes it."}
        </p>
      </header>
      {card.status === "approved" ? (
        <MeetingLink tribeId={card.id} link={card.meeting_link ?? null} placeNote={card.place_note} online={card.mode !== "in_person"} />
      ) : null}
      {roster ? <TribeOnboarding roster={roster} leaderFirstName={firstName(card.leader.name)} /> : null}
      {card.role === "leader" ? (
        <TribeBuilder card={card} catalogue={catalogue} applicationStory={story} readyMade={readyMade} />
      ) : (
        <div className="max-w-xl">
          <TribePreview
            values={valuesFromCard(card)}
            community={card.community?.name ?? null}
            track={card.track?.name ?? null}
            goal={card.goal?.title ?? null}
            leader={card.leader.name}
          />
        </div>
      )}
      {next ? <NextSeasonTribes mine={next} /> : null}
    </div>
  );
}
