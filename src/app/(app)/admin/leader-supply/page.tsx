import type { Metadata } from "next";
import { LeaderBoard } from "@/components/admin/LeaderBoard";
import { PageHead } from "@/components/admin/PageHead";
import { BOARD_OFFER_ROLES, BOARD_VIEW_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { parseBoard, parseOffers } from "@/lib/leaders/board";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leader supply" };

export default async function LeaderSupplyPage() {
  const session = await requireRole(BOARD_VIEW_ROLES, "/admin/leader-supply");
  const supabase = await createClient();
  const [board, offers] = await Promise.all([supabase.rpc("leader_board"), supabase.rpc("leader_offers_list")]);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Leader supply">
        Where members are waiting for a tribe and no leader is ready. Ask for suggestions, then offer the tribe to a leader. The leader is told how many are waiting, never who, and a pastor still approves the card they start.
      </PageHead>
      <LeaderBoard
        board={board.error ? null : parseBoard(board.data)}
        offers={offers.error ? [] : parseOffers(offers.data)}
        canOffer={hasAnyRole(session.roles, BOARD_OFFER_ROLES)}
      />
    </div>
  );
}
