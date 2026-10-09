import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardReviewView } from "@/components/academy/CardReviewView";
import { REVIEW_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import type { AssistantSuggestion, CardReview } from "@/lib/academy/types";
import { isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review a Tribe Card" };

export default async function ReviewCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole(REVIEW_ROLES, `/review/cards/${id}`);
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_circle", { p_id: id });
  if (error || !data) notFound();
  const suggestions = await supabase.rpc("suggest_assistants", { p_circle: id });
  const card = data as CardReview;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link href="/review/cards" className="press -ml-1 w-fit rounded-lg px-1 py-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← All Tribe Cards
        </Link>
        <h1 className="t-title">{card.name ?? "Unnamed tribe"}</h1>
      </header>
      <CardReviewView card={card} suggestions={(suggestions.data as AssistantSuggestion[] | null) ?? []} canPair />
    </div>
  );
}
