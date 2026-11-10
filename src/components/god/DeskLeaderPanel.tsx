"use client";

import { useState } from "react";
import { candidatesAction, cancelOfferAction, pauseBackupsAction, reviewOfferAction, sendOfferAction } from "@/app/(app)/god/leader-desk/offer-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { DeskReveal } from "@/components/god/DeskReveal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { OWNER_OFFER_WORDS as O, canWithdrawOffer, latestRound, leaderStage, offerLine, type Candidate, type GroupLeader } from "@/lib/god/desk-offers";

/**
 * Where one draft stands on its leader. With a leader: who, and where the tribe card and the Academy are. Without one: the offers so far (the first asked and the
 * backups waiting), what you can do about each, and "Recommend a leader", which lists the members who pass every rule and lets you choose one to ask now and up to
 * two backups. Nothing is sent without a second tap, and in Rehearsal nothing is sent at all.
 */
export function DeskLeaderPanel({ group, state, rehearsal }: { group: string; state: GroupLeader; rehearsal: boolean }) {
  const d = useDo();
  const [listing, setListing] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const round = latestRound(state.offers);
  const live = round.filter(canWithdrawOffer);

  async function look() {
    if (listing) return;
    setListing(true);
    setAskError(null);
    setNote(null);
    try {
      const r = await candidatesAction(group);
      if (r.ok) {
        setCandidates(r.candidates.rows);
        setProblem(r.candidates.problem);
        setChosen([]);
        setSure(false);
      } else setAskError(r.message);
    } catch {
      setAskError("We couldn’t look that up. Try again.");
    }
    setListing(false);
  }

  const toggle = (person: string) => setChosen((cur) => (cur.includes(person) ? cur.filter((p) => p !== person) : cur.length >= 3 ? cur : [...cur, person]));

  if (state.leader) {
    return (
      <div className="flex flex-col gap-1 border-t border-line pt-3" data-testid="desk-leader-found">
        <p className="font-medium">
          Leader: {state.leader.name} <Badge tone="flame">Said yes</Badge>
        </p>
        <p className="t-small text-soft">{leaderStage(state.leader)}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3" data-testid="desk-leader-panel">
      <p className="t-small font-medium">{O.title}</p>
      {state.needsDecision ? (
        <p className="t-small rounded-[var(--radius-control)] border border-gold px-3 py-2" role="status" data-testid="desk-needs-decision">
          {O.needsDecision}
        </p>
      ) : null}
      {state.paused ? (
        <p className="t-small text-soft" data-testid="desk-backups-paused">
          {O.paused}
        </p>
      ) : null}

      {round.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Offers for this group" data-testid="desk-offers">
          {round.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2" data-testid="desk-offer">
              <div className="flex flex-col gap-0.5">
                <p className="font-medium">
                  {o.name} <span className="t-small text-soft">{O.order(o.seq)}</span>
                </p>
                <p className="t-small text-soft">
                  {offerLine(o)}
                  {o.fit !== null && o.status === "review" ? ` (fit ${o.fit})` : ""}
                </p>
                {o.status === "open" && o.windowEndsAt ? <p className="t-small text-soft">Closes {new Date(o.windowEndsAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {o.callMe && o.status === "open" ? <DeskReveal person={o.personId} masked={o.phone} hasNumber={o.hasNumber} /> : null}
                {o.status === "review" ? (
                  <>
                    <Button type="button" size="sm" variant="solid" loading={d.busy === `ok-${o.id}`} onClick={() => void d.go(`ok-${o.id}`, () => reviewOfferAction(o.id, true))}>
                      {O.appoint}
                    </Button>
                    <Button type="button" size="sm" variant="quiet" loading={d.busy === `no-${o.id}`} onClick={() => void d.go(`no-${o.id}`, () => reviewOfferAction(o.id, false))}>
                      {O.decline}
                    </Button>
                  </>
                ) : null}
                {canWithdrawOffer(o) ? (
                  <Button type="button" size="sm" variant="quiet" loading={d.busy === `w-${o.id}`} onClick={() => void d.go(`w-${o.id}`, () => cancelOfferAction(o.id, false))}>
                    {O.withdraw}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-small text-soft">{O.noLeader}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {live.length > 1 ? (
          <Button type="button" size="sm" variant="quiet" loading={d.busy === "all"} onClick={() => void d.go("all", () => cancelOfferAction(live[0].id, true))}>
            {O.withdrawAll}
          </Button>
        ) : null}
        {round.some((o) => o.status === "queued") || state.paused ? (
          <Button type="button" size="sm" variant="quiet" loading={d.busy === "pause"} onClick={() => void d.go("pause", () => pauseBackupsAction(group, !state.paused))}>
            {state.paused ? O.resume : O.pause}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="solid" loading={listing} onClick={() => void look()}>
          {O.button}
        </Button>
      </div>
      {listing ? <p className="t-small text-soft">{O.looking}</p> : null}

      {candidates ? (
        problem ? (
          <p className="t-small text-soft" data-testid="desk-offer-problem">
            {problem}
          </p>
        ) : candidates.length === 0 ? (
          <p className="t-small text-soft">{O.none}</p>
        ) : (
          <div className="flex flex-col gap-3" data-testid="desk-candidates">
            <p className="t-small text-soft">{O.pick}</p>
            <ul className="flex flex-col gap-2" aria-label="Members who could lead this group">
              {candidates.map((c) => {
                const place = chosen.indexOf(c.personId);
                return (
                  <li key={c.personId} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2" data-testid="desk-candidate">
                    <div className="flex flex-col gap-0.5">
                      <p className="font-medium">
                        {c.name} <span className="t-small text-soft">signal {c.score}{c.inGroup ? ", in this draft" : ""}</span>
                      </p>
                      {c.notes.map((n) => (
                        <p key={n} className="t-small text-soft">
                          {n}
                        </p>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <DeskReveal person={c.personId} masked={c.phone} hasNumber={c.hasNumber} />
                      <Button type="button" size="sm" variant={place >= 0 ? "solid" : "quiet"} aria-pressed={place >= 0} onClick={() => toggle(c.personId)}>
                        {place >= 0 ? O.order(place + 1) : "Choose"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="t-small text-soft">{O.limit(2)}</p>
            {chosen.length > 0 ? (
              sure ? (
                <div className="flex flex-col gap-2">
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
                            const r = await sendOfferAction(group, chosen);
                            if (r.ok) setNote(r.sent ? O.sent : O.written);
                            return r;
                          },
                          { after: () => { setSure(false); setCandidates(null); setChosen([]); } },
                        )
                      }
                    >
                      {rehearsal ? O.confirmRehearsal : O.confirm}
                    </Button>
                    <Button type="button" size="sm" variant="quiet" onClick={() => setSure(false)}>
                      {O.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button type="button" size="sm" variant="solid" onClick={() => setSure(true)}>
                    {chosen.length === 1 ? "Ask this person" : `Ask ${chosen.length} people, in this order`}
                  </Button>
                </div>
              )
            ) : null}
          </div>
        )
      ) : null}
      {note ? (
        <p className="t-small" role="status" data-testid="desk-offer-note">
          {note}
        </p>
      ) : null}
      <Notice error={d.error ?? askError} saved={d.saved} />
    </div>
  );
}
