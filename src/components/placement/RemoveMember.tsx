"use client";

import Link from "next/link";
import { useState } from "react";
import { putBackAction, removeFromTribeAction } from "@/app/(app)/admin/tribes/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { formatLagosDay } from "@/lib/dates";
import type { RemovedLately, TribeMember } from "@/lib/placement/types";

type Doing = ReturnType<typeof useDo>;

const firstOf = (name: string) => name.trim().split(/\s+/)[0] || "them";

/**
 * The confirmation for taking one member out of a tribe: what will happen, a reason only the office reads, and the button.
 * The page that holds it owns `d`, so the answer stays on screen after the member's row has gone.
 */
function RemoveForm({ tribe, person, d, onClose }: { tribe: { id: string; name: string }; person: { id: string; name: string }; d: Doing; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const typed = reason.trim().length;
  const ready = typed >= 10 && typed <= 300;
  const first = firstOf(person.name);
  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised p-4" data-testid={`remove-panel-${person.id}`}>
      <p className="t-body font-semibold">
        Take {person.name} out of {tribe.name}?
      </p>
      <ul className="t-small flex list-disc flex-col gap-1 pl-5 text-soft">
        <li>{first} goes back to the pile of people waiting to be placed. You can place them in another tribe at once.</li>
        <li>Automatic placement leaves them alone for 3 days, so they can look at other tribes themselves first.</li>
        <li>{first} is told kindly by email, with other tribes to look at. The tribe’s leader is told too, by first name only.</li>
        <li>{tribe.name} is not offered to them again unless you put them back, which you can do for 14 days.</li>
      </ul>
      <Textarea
        label="Why? Only the church’s office reads this"
        hint="10 to 300 characters. Not shown to the member or the leader, and cleared after 12 months."
        value={reason}
        maxLength={300}
        rows={3}
        onChange={(e) => setReason(e.target.value)}
        data-testid="remove-reason"
      />
      <div className="flex flex-wrap gap-3">
        <Button
          size="md"
          variant="solid"
          disabled={!ready}
          loading={d.busy === `remove:${person.id}`}
          onClick={() =>
            void d.go(`remove:${person.id}`, () => removeFromTribeAction({ tribe: tribe.id, person: person.id, reason }), {
              saved: `${person.name} is out of ${tribe.name} and back in the pile waiting to be placed.`,
              after: onClose,
            })
          }
          data-testid="remove-confirm"
        >
          Remove {first} from this tribe
        </Button>
        <Button size="md" variant="quiet" onClick={onClose} data-testid="remove-cancel">
          Keep them
        </Button>
      </div>
    </div>
  );
}

/** The tribe's page: its members, each with Remove. */
export function TribeMembers({ tribe, members, empty }: { tribe: { id: string; name: string }; members: TribeMember[]; empty: string }) {
  const d = useDo();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {members.length === 0 ? (
        <p className="t-body text-soft" data-testid="tribe-members-none">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="tribe-members">
          {members.map((m) => (
            <li key={m.person} className="flex flex-col gap-3" data-testid={`member-${m.person}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="t-body">
                  <Link href={`/admin/people/${m.person}`} className="font-semibold underline underline-offset-4">
                    {m.name}
                  </Link>
                  <span className="text-soft"> · {m.saidYes ? "said yes" : "waiting to say yes"}{m.since ? `, in since ${formatLagosDay(m.since)}` : ""}</span>
                </p>
                {m.self ? (
                  <span className="t-small text-soft">This is you</span>
                ) : m.careOnly ? (
                  <span className="t-small text-soft" data-testid={`member-care-${m.person}`}>Only the Care Lead can change this place</span>
                ) : open === m.person ? null : (
                  <Button size="md" variant="quiet" onClick={() => { d.clear(); setOpen(m.person); }} data-testid={`remove-open-${m.person}`}>
                    Remove
                  </Button>
                )}
              </div>
              {open === m.person ? <RemoveForm tribe={tribe} person={{ id: m.person, name: m.name }} d={d} onClose={() => setOpen(null)} /> : null}
            </li>
          ))}
        </ul>
      )}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

/** The person's page: Remove from the tribe they sit in. Stays on the page after they are out, so the answer is still there to read. */
export function PersonRemove({ person, seat }: { person: { id: string; name: string }; seat: { tribe: string; name: string; self: boolean; careOnly: boolean } | null }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {seat ? (
        seat.self ? (
          <p className="t-body text-soft">This is your own page, so you cannot take yourself out of a tribe here.</p>
        ) : seat.careOnly ? (
          <p className="t-body text-soft" data-testid="person-remove-care">
            {person.name} is in {seat.name}. Only the Care Lead can change this place.
          </p>
        ) : open ? (
          <RemoveForm tribe={{ id: seat.tribe, name: seat.name }} person={person} d={d} onClose={() => setOpen(false)} />
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="t-body">
              {person.name} is in <span className="font-semibold">{seat.name}</span>.
            </p>
            <Button size="md" variant="quiet" onClick={() => { d.clear(); setOpen(true); }} data-testid="person-remove-open">
              Remove from this tribe
            </Button>
          </div>
        )
      ) : (
        <p className="t-body text-soft" data-testid="person-remove-none">
          {person.name} is not in a tribe, so there is nothing to remove.
        </p>
      )}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

/** What the office took out of a tribe in the last 30 days, with the reason it wrote and Put back for 14 days. */
export function RemovedLately({ items, empty, showName = true }: { items: RemovedLately[]; empty: string; showName?: boolean }) {
  const d = useDo();
  if (items.length === 0) return <p className="t-body text-soft" data-testid="removed-lately-none">{empty}</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-4" data-testid="removed-lately">
        {items.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between" data-testid={`removed-${r.id}`}>
            <div className="flex flex-col gap-1">
              <p className="t-body">
                {showName ? (
                  <Link href={`/admin/people/${r.person}`} className="font-semibold underline underline-offset-4">
                    {r.name}
                  </Link>
                ) : null}
                {showName ? " taken" : "Taken"} out of <Link href={`/admin/tribes/${r.tribe}`} className="underline underline-offset-4">{r.tribeName}</Link>
                {r.by ? ` by ${r.by}` : ""}
                {r.at ? <span className="text-soft"> · {formatLagosDay(r.at)}</span> : null}
              </p>
              {r.reason ? <p className="t-small text-soft">Reason: {r.reason}</p> : null}
            </div>
            {r.putBackAt ? (
              <span className="t-small text-soft">Put back on {formatLagosDay(r.putBackAt)}</span>
            ) : r.canPutBack ? (
              <Button
                size="md"
                variant="quiet"
                loading={d.busy === r.id}
                onClick={() => void d.go(r.id, () => putBackAction(r.id, r.person, r.tribe), { saved: `${r.name} is back in ${r.tribeName}.` })}
                data-testid={`put-back-${r.id}`}
              >
                Put back
              </Button>
            ) : (
              <span className="t-small text-soft">Over 14 days ago, so this can no longer be put back here. Place them again instead.</span>
            )}
          </li>
        ))}
      </ul>
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
