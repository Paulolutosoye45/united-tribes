import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { RunBoard } from "@/components/god/RunBoard";
import { isUuid } from "@/lib/leaders/errors";
import { loadRunView } from "@/lib/placement/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "A placement run" };

export default async function GodPlacementRunPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const view = await loadRunView(supabase, id);
  if (!view) notFound();
  return <RunBoard key={`${view.run.id}-${view.run.status}-${view.run.phase}`} view={view} />;
}
