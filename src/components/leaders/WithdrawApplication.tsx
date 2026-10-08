"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withdrawApplicationAction } from "@/app/(app)/lead/actions";
import { Button } from "@/components/ui/Button";

export function WithdrawApplication({ appId, sent }: { appId: string; sent: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    const result = await withdrawApplicationAction(appId);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="md" onClick={() => setConfirming(true)}>
        {sent ? "Withdraw my application" : "Delete this application"}
      </Button>
    );
  }
  return (
    <div className="pop-in card flex flex-col gap-4 border-danger/40 p-5">
      <p className="font-semibold">{sent ? "Withdraw and delete your application?" : "Delete this application?"}</p>
      <p className="t-small text-soft">
        {sent
          ? "This removes your answers, your referees’ answers and your interview booking. You can apply again later."
          : "This removes your answers so far. You can start again whenever you like."}
      </p>
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button variant="solid" size="md" loading={busy} onClick={() => void withdraw()}>
          Yes, delete it
        </Button>
        <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
