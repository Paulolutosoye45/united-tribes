"use client";

import { useState } from "react";
import { previewProposalAction, sendProposalAction } from "@/app/(app)/god/leader-desk/send-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { SEND_WORDS as S, previewLine, type Preview } from "@/lib/god/desk-send";

/**
 * "Email a proposed group": first shows the one open tribe the Desk would propose and why, then asks for a second tap. In Rehearsal the second tap only
 * writes it down. The database checks every rule again at the moment of sending.
 */
export function DeskPropose({ person }: { person: string }) {
  const d = useDo();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function look() {
    if (looking) return;
    setLooking(true);
    setLookError(null);
    setDone(null);
    try {
      const r = await previewProposalAction(person);
      if (r.ok) setPreview(r.preview);
      else setLookError(r.message);
    } catch {
      setLookError("We couldn’t look that up. Try again.");
    }
    setLooking(false);
  }

  if (done) return <p className="t-small text-soft" role="status">{done}</p>;

  if (preview && preview.ok) {
    const rehearsal = preview.mode === "rehearsal";
    return (
      <div className="flex flex-col gap-2" data-testid="desk-propose-preview">
        <p className="t-small">{previewLine(preview)}</p>
        <p className="t-small text-soft">{rehearsal ? S.propose.rehearsal : S.propose.on}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="solid"
            loading={d.busy === "send"}
            onClick={() =>
              void d.go("send", async () => {
                const r = await sendProposalAction(person, preview.tribeId);
                if (r.ok) setDone(r.sent ? S.propose.sent : S.propose.written);
                return r.ok ? { ok: true as const } : r;
              }, { after: () => setPreview(null) })
            }
          >
            {rehearsal ? S.propose.confirmRehearsal : S.propose.confirm}
          </Button>
          <Button type="button" size="sm" variant="quiet" onClick={() => setPreview(null)}>
            {S.propose.cancel}
          </Button>
        </div>
        <Notice error={d.error} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" size="sm" variant="quiet" loading={looking} onClick={() => void look()}>
        {looking ? S.propose.asking : S.propose.button}
      </Button>
      {preview && !preview.ok ? <p className="t-small text-soft" data-testid="desk-propose-no">{preview.text}</p> : null}
      <Notice error={lookError} />
    </div>
  );
}
