import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChooseForm } from "@/components/matching/ChooseForm";
import { requireSession } from "@/lib/auth/session";
import { isUuid } from "@/lib/leaders/errors";
import { readMatch } from "@/lib/matching/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Join a circle" };

export default async function ChoosePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession(`/circle/choose/${id}`);
  if (!isUuid(id)) redirect("/circle");
  const supabase = await createClient();
  const match = await readMatch(supabase);
  if (!match || match.placement) redirect("/circle");
  const shown = match.circles.find((c) => c.circle.id === id);
  if (!shown || !shown.circle.open || shown.circle.seats_left <= 0) redirect("/circle");
  return <ChooseForm shown={shown} />;
}
