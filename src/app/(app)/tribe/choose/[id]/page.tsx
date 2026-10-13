import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChooseForm } from "@/components/matching/ChooseForm";
import { requireSession } from "@/lib/auth/session";
import { isUuid } from "@/lib/leaders/errors";
import { readMatch } from "@/lib/matching/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Join a tribe" };

export default async function ChoosePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession(`/tribe/choose/${id}`);
  if (!isUuid(id)) redirect("/tribe");
  const supabase = await createClient();
  const match = await readMatch(supabase);
  if (!match || match.placement) redirect("/tribe");
  const shown = match.tribes.find((c) => c.tribe.id === id);
  if (!shown || !shown.tribe.open || shown.tribe.seats_left <= 0) redirect("/tribe");
  return <ChooseForm shown={shown} />;
}
