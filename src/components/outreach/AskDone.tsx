"use client";

import { closeAskAction } from "@/app/(app)/care/asks/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";

export function AskDone({ id }: { id: string }) {
  const d = useDo();
  return (
    <span className="flex flex-col gap-1">
      <Button variant="quiet" size="md" loading={d.busy === "close"} onClick={() => void d.go("close", () => closeAskAction(id))}>
        I have reached them
      </Button>
      <Notice error={d.error} />
    </span>
  );
}
