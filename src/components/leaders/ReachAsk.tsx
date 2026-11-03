"use client";

import { askToAddNumberAction } from "@/app/(app)/lead/reach-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { REACH_WORDS, type ReachPerson } from "@/lib/contact-gaps/gaps";

/**
 * The people in a leader's tribe whose number the leader cannot see, each with the one thing the leader can do: ask them by email, see that
 * they were asked, or (when there is no way to email them) ask in person. Names only. The number is never on this screen.
 */
export function ReachAsk({ people }: { people: ReachPerson[] }) {
  const d = useDo();
  if (people.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/20 px-4 py-4" data-testid="reach-gaps">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">{REACH_WORDS.leaderTitle}</h3>
        <p className="t-small text-soft">{REACH_WORDS.leaderLine}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line/60">
        {people.map((p) => (
          <li key={p.personId} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="reach-person" data-state={p.state}>
            <span className="font-medium">{p.firstName}</span>
            {p.state === "ask" ? (
              <Button
                variant="quiet"
                size="sm"
                loading={d.busy === p.personId}
                onClick={() => void d.go(p.personId, () => askToAddNumberAction(p.personId), { saved: REACH_WORDS.leaderDone(p.firstName) })}
              >
                {REACH_WORDS.leaderAsk(p.firstName)}
              </Button>
            ) : p.state === "asked" ? (
              <span className="t-small text-soft">{REACH_WORDS.leaderAsked(p.firstName)}</span>
            ) : (
              <span className="t-small text-soft">{REACH_WORDS.leaderInPerson}</span>
            )}
          </li>
        ))}
      </ul>
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
