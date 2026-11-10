"use client";

import { useState } from "react";
import { interestCheckAction } from "@/app/(app)/god/leader-desk/send-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { SEND_WORDS as S } from "@/lib/god/desk-send";

/**
 * "Check interest": asks each member of a draft whether the group would suit them. A second tap confirms, and in Rehearsal it only writes down who would be asked.
 * The answer is a sentence: how many were asked and who was left out, and why.
 */
export function DeskCheckInterest({ group, rehearsal, members }: { group: string; rehearsal: boolean; members: number }) {
  const d = useDo();
  const [sure, setSure] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  if (members === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="desk-check-interest">
      {sure ? (
        <div className="flex flex-col gap-2">
          <p className="t-small text-soft">{rehearsal ? S.interest.rehearsal : S.interest.on}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="solid"
              loading={d.busy === "ask"}
              onClick={() =>
                void d.go("ask", async () => {
                  const r = await interestCheckAction(group);
                  if (r.ok) setSummary(r.summary);
                  return r.ok ? { ok: true as const } : r;
                }, { after: () => setSure(false) })
              }
            >
              {rehearsal ? S.interest.confirmRehearsal : S.interest.confirm}
            </Button>
            <Button type="button" size="sm" variant="quiet" onClick={() => setSure(false)}>
              {S.interest.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" size="sm" variant="quiet" onClick={() => { setSummary(null); setSure(true); }}>
            {S.interest.button}
          </Button>
        </div>
      )}
      {summary ? <p className="t-small" role="status" data-testid="desk-check-summary">{summary}</p> : null}
      <Notice error={d.error} />
    </div>
  );
}
