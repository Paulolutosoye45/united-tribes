"use client";

import { cancelProposalAction } from "@/app/(app)/god/leader-desk/send-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { SEND_WORDS as S } from "@/lib/god/desk-send";

/** Withdraws an email nobody has answered: its private page then says the proposal was withdrawn, and a queued email that has not gone is not sent. */
export function DeskWithdraw({ id }: { id: string }) {
  const d = useDo();
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" size="sm" variant="quiet" loading={d.busy === "cancel"} onClick={() => void d.go("cancel", () => cancelProposalAction(id))}>
        {S.withdraw}
      </Button>
      <Notice error={d.error} />
    </div>
  );
}
