"use client";

import { useState } from "react";
import { seatLineAction } from "@/app/(app)/lead/tribe/seat-line-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { BOARD_WORDS } from "@/lib/placement/answers";

const W = BOARD_WORDS.seatLine;

/**
 * The leader's one line for new members: one plain sentence that appears as "from you" in the church's emails to members placed in this tribe who have not
 * answered yet. It is read by people who have not met the leader, so no links, no phone numbers and no symbols; the database checks it again.
 */
export function SeatLineCard({ tribeId, line, canEdit }: { tribeId: string; line: string | null; canEdit: boolean }) {
  const d = useDo();
  const [value, setValue] = useState(line ?? "");
  const changed = value.trim() !== (line ?? "");
  return (
    <section aria-labelledby="seat-line-h" className="card flex flex-col gap-3 p-5" data-testid="seat-line">
      <div className="flex flex-col gap-1">
        <h2 id="seat-line-h" className="t-heading">{W.title}</h2>
        <p className="t-small max-w-[64ch] text-soft">{W.help}</p>
      </div>
      {canEdit ? (
        <>
          <label htmlFor="seat-line-input" className="sr-only">{W.title}</label>
          <textarea
            id="seat-line-input"
            value={value}
            maxLength={200}
            rows={2}
            placeholder={W.placeholder}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-4 py-3 text-base text-ink hover:border-soft focus:border-ink focus:outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <Button size="md" loading={d.busy === "save"} disabled={!changed} onClick={() => void d.go("save", () => seatLineAction(tribeId, value), { saved: value.trim() ? W.saved : W.cleared })}>
              {W.save}
            </Button>
            <span className="t-small text-soft tabular-nums">{value.length} / 200</span>
          </div>
          <Notice error={d.error} saved={d.saved} />
        </>
      ) : (
        <p className="t-body">{line ?? "No line has been written yet."}</p>
      )}
    </section>
  );
}
