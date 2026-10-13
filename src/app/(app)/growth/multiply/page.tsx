import type { Metadata } from "next";
import { MultiplyBoard } from "@/components/growth/MultiplyBoard";
import { MULTIPLY_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadMultiplicationBoard } from "@/lib/growth/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Multiply" };

export default async function MultiplyPage() {
  await requireRole(MULTIPLY_ROLES, "/growth/multiply");
  const supabase = await createClient();
  const board = await loadMultiplicationBoard(supabase);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Multiply</h1>
        <p className="t-body measure text-soft">
          Healthy tribes grow more tribes. For each tribe, record what happens next season. A certified assistant can lead a new tribe; nothing is sent and no
          one&rsquo;s role changes here. A person invites them to apply.
        </p>
      </header>
      {!board ? (
        <p className="t-body text-soft">We couldn&rsquo;t load the tribes just now. Try again in a moment.</p>
      ) : board.state === "none" ? (
        <p className="t-body text-soft">There is no season to plan for yet.</p>
      ) : (
        <MultiplyBoard board={board} />
      )}
    </div>
  );
}
