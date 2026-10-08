import type { Metadata } from "next";
import Link from "next/link";
import { CircleBuilder } from "@/components/academy/CircleBuilder";
import { CirclePreview } from "@/components/academy/CirclePreview";
import { StartCard } from "@/components/academy/StartCard";
import { valuesFromCard } from "@/lib/academy/card";
import { loadMyCircle } from "@/lib/academy/server";
import { CircleOnboarding } from "@/components/matching/CircleOnboarding";
import { loadRoster } from "@/lib/matching/server";
import { firstName } from "@/lib/academy/card";
import { requireRole } from "@/lib/auth/session";
import { loadLeaderCatalogue, loadMyApplication } from "@/lib/leaders/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Circle Card" };

export default async function CirclePage() {
  const session = await requireRole(["leader", "assistant_leader"], "/lead/circle");
  const supabase = await createClient();
  const isLeader = session.roles.includes("leader");
  const [card, catalogue, mine] = await Promise.all([
    loadMyCircle(supabase),
    loadLeaderCatalogue(supabase),
    isLeader ? loadMyApplication(supabase, session.person.id) : Promise.resolve(null),
  ]);

  const back = (
    <Link href="/lead/academy" className="press -ml-1 w-fit rounded-lg px-1 py-1 text-[0.95rem] font-medium text-soft hover:text-ink">
      ← Training
    </Link>
  );

  if (!card) {
    return (
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          {back}
          <h1 className="t-title">{isLeader ? "Your Circle Card" : "Your circle"}</h1>
        </header>
        {isLeader ? (
          <StartCard />
        ) : (
          <section className="card flex flex-col gap-3 p-6">
            <h2 className="t-heading">Your pairing comes after your training</h2>
            <p className="t-body measure text-soft">
              The pastorate pairs each assistant leader with a circle whose leader leads in a different way from you, so the two of you balance each other. You will see your circle here once that is done.
            </p>
          </section>
        )}
      </div>
    );
  }

  const story = mine?.application?.answers.calling.goalStory ?? null;
  const roster = card.status === "approved" ? await loadRoster(supabase, card.id) : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        {back}
        <h1 className="t-title">{card.role === "leader" ? "Your Circle Card" : `${card.leader.name}’s circle`}</h1>
        <p className="t-body measure text-soft">
          {card.role === "leader"
            ? "This is the page members choose your circle from. Each member sees it with their own Degree of Compatibility. Your work saves as you type."
            : "You are the assistant leader for this circle. You can read the card here; the leader writes it."}
        </p>
      </header>
      {roster ? <CircleOnboarding roster={roster} leaderFirstName={firstName(card.leader.name)} /> : null}
      {card.role === "leader" ? (
        <CircleBuilder card={card} catalogue={catalogue} applicationStory={story} />
      ) : (
        <div className="max-w-xl">
          <CirclePreview
            values={valuesFromCard(card)}
            tribe={card.tribe?.name ?? null}
            track={card.track?.name ?? null}
            goal={card.goal?.title ?? null}
            leader={card.leader.name}
          />
        </div>
      )}
    </div>
  );
}
