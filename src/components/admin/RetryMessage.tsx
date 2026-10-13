"use client";

import { retryMessageAction } from "@/app/(app)/admin/messages/actions";
import { Button } from "@/components/ui/Button";
import { useDo } from "./useDo";

/** A failed message, put back in the queue to be sent again on the next heartbeat. */
export function RetryMessage({ id, to }: { id: string; to: string }) {
  const { busy, error, go } = useDo();
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="quiet"
        loading={busy !== null}
        aria-label={`Try again: message to ${to}`}
        onClick={() => void go("retry", () => retryMessageAction(id))}
      >
        Try again
      </Button>
      {error ? (
        <p role="alert" className="t-small max-w-[14rem] text-soft">
          {error}
        </p>
      ) : null}
    </div>
  );
}
