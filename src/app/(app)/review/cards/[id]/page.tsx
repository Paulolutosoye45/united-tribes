import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardReviewView } from "@/components/academy/CardReviewView";
import { StageBanner } from "@/components/profile/StageBanner";
import { REVIEW_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import type { AssistantSuggestion, CardReview } from "@/lib/academy/types";
import { isUuid } from "@/lib/leaders/errors";
import { loadStageStatus } from "@/lib/profile/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review a Tribe Card" };

export default async function ReviewCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole(REVIEW_ROLES, `/review/cards/${id}`);
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_tribe", { p_id: id });
  if (error || !data) notFound();
  const [suggestions, appointment, choice] = await Promise.all([
    supabase.rpc("suggest_assistants", { p_tribe: id }),
    supabase.rpc("tribe_appointment_note", { p_tribe: id }),
    supabase.rpc("tribe_goal_choice_note", { p_tribe: id }),
  ]);
  const card = data as CardReview;
  // Null unless the Details check is open for this leader, so with it Off the page is as it was.
  const stage = await loadStageStatus(supabase, id);
  // A leader the owner appointed has no application behind the card. The office is told that, and never by whom.
  const note = appointment.error ? null : (appointment.data as { text?: unknown } | null);
  const appointedNote = note && typeof note.text === "string" && note.text.length <= 200 ? note.text : null;
  // When the leader chose a goal other than the one the church started them on. Never a name, and never the owner.
  const picked = choice.error ? null : (choice.data as { text?: unknown } | null);
  const choiceNote = picked && typeof picked.text === "string" && picked.text.length <= 200 ? picked.text : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link href="/review/cards" className="press -ml-1 inline-flex min-h-10 w-fit items-center rounded-lg px-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← All Tribe Cards
        </Link>
        <h1 className="t-title">{card.name ?? "Unnamed tribe"}</h1>
      </header>
      {appointedNote ? (
        <p role="note" className="t-body rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="appointed-note">
          {appointedNote}
        </p>
      ) : null}
      {choiceNote ? (
        <p role="note" className="t-body rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="goal-choice-note">
          {choiceNote}
        </p>
      ) : null}
      {stage ? <StageBanner status={stage} /> : null}
      <CardReviewView card={card} suggestions={(suggestions.data as AssistantSuggestion[] | null) ?? []} canPair />
    </div>
  );
}
