"use client";

import { useState } from "react";
import { leadOptionsAction, sendOfferAction } from "@/app/(app)/god/leader-desk/offer-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { OWNER_OFFER_WORDS as O, type LeadOption } from "@/lib/god/desk-offers";

/**
 * "Recommend as leader", on a waiting member's row. It lists the draft groups this member could be offered to lead right now, by the same rules as the button on a
 * group's card. Choosing one asks for a second tap; the offer then goes through the one function the card uses (daily limit, Rehearsal and all). The member is the
 * only one asked: backups are chosen on the group's own card.
 */
export function DeskRecommend({ person, rehearsal }: { person: string; rehearsal: boolean }) {
  const d = useDo();
  const [looking, setLooking] = useState(false);
  const [rows, setRows] = useState<LeadOption[] | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [chosen, setChosen] = useState<LeadOption | null>(null);
  const [lookError, setLookError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function look() {
    if (looking) return;
    setLooking(true);
    setLookError(null);
    setDone(null);
    try {
      const r = await leadOptionsAction(person);
      if (r.ok) {
        setRows(r.options.rows);
        setWhy(r.options.why);
        setChosen(null);
      } else setLookError(r.message);
    } catch {
      setLookError("We couldn’t look that up. Try again.");
    }
    setLooking(false);
  }

  if (done) {
    return (
      <p className="t-small text-soft" role="status" data-testid="desk-recommend-done">
        {done}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="desk-recommend">
      <Button type="button" size="sm" variant="quiet" loading={looking} onClick={() => void look()}>
        {looking ? O.row.looking : O.row.button}
      </Button>
      {rows && rows.length === 0 ? (
        <p className="t-small text-soft" data-testid="desk-recommend-none">
          {why ?? O.row.none}
        </p>
      ) : null}
      {rows && rows.length > 0 && !chosen ? (
        <div className="flex flex-col gap-2">
          <p className="t-small text-soft">{O.row.pick}</p>
          <ul className="flex flex-col gap-2" aria-label="Draft groups they could be asked to lead">
            {rows.map((g) => (
              <li key={g.groupId} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2" data-testid="desk-recommend-option">
                <p className="t-small">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-soft">{[g.community, g.goal].filter(Boolean).length > 0 ? ` · ${[g.community, g.goal].filter(Boolean).join(": ")}` : ""}</span>
                </p>
                <Button type="button" size="sm" variant="quiet" onClick={() => setChosen(g)}>
                  Choose
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {chosen ? (
        <div className="flex flex-col gap-2" data-testid="desk-recommend-confirm">
          <p className="t-small">{O.row.ask(chosen.name)}</p>
          <p className="t-small text-soft">{rehearsal ? O.rehearsal : O.on}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="solid"
              loading={d.busy === "send"}
              onClick={() =>
                void d.go(
                  "send",
                  async () => {
                    const r = await sendOfferAction(chosen.groupId, [person]);
                    if (r.ok) setDone(r.sent ? O.sent : O.written);
                    return r;
                  },
                  { after: () => { setRows(null); setChosen(null); } },
                )
              }
            >
              {rehearsal ? O.confirmRehearsal : O.confirm}
            </Button>
            <Button type="button" size="sm" variant="quiet" onClick={() => setChosen(null)}>
              {O.cancel}
            </Button>
          </div>
        </div>
      ) : null}
      <Notice error={d.error ?? lookError} />
    </div>
  );
}
