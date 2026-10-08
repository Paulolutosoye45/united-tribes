import type { Metadata } from "next";
import { CardQueue } from "@/components/academy/CardQueue";
import { PanelTabs } from "@/components/leaders/PanelTabs";
import { REVIEW_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import type { CardQueueItem } from "@/lib/academy/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review: Circle Cards" };

export default async function ReviewCardsPage() {
  await requireRole(REVIEW_ROLES, "/review/cards");
  const supabase = await createClient();
  const { data } = await supabase.rpc("circle_queue");
  const items = (data as CardQueueItem[] | null) ?? [];
  const waiting = items.filter((c) => c.status === "submitted").length;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="t-title">Review leaders</h1>
          <p className="t-body measure text-soft">
            A Circle Card is what members choose from. A pastor or director approves each one, pairs the leader with an assistant, and assigns a coach.
            {waiting > 0 ? ` ${waiting} ${waiting === 1 ? "card is" : "cards are"} waiting.` : ""}
          </p>
        </div>
        <PanelTabs />
      </header>
      <CardQueue items={items} />
    </div>
  );
}
