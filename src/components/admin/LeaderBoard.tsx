"use client";

import Link from "next/link";
import { useState } from "react";
import { sendOfferAction, suggestLeadersAction, withdrawOfferAction } from "@/app/(app)/admin/leader-supply/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  CHOICE_WORDS,
  OFFER_STATUS_WORDS,
  dayOf,
  gapSentence,
  goalsInNeed,
  interestSentence,
  noSuggestionsLine,
  otherGoals,
  people,
  type Board,
  type BoardGoal,
  type Offer,
  type Suggestions,
} from "@/lib/leaders/board";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

/**
 * Leader supply and demand: where members are waiting for a tribe that has no leader, who could lead it, and the offers made.
 * The counts are the ones the compatibility test reads. A suggestion is scored fresh each time, never filed. An offer says how many
 * are waiting and nothing about who they are, and a pastor still approves the card a leader starts from it.
 */
export function LeaderBoard({ board, offers, canOffer }: { board: Board | null; offers: Offer[]; canOffer: boolean }) {
  const d = useDo();
  const [said, setSaid] = useState<string | null>(null);
  const [found, setFound] = useState<Record<string, Suggestions>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!board) {
    return (
      <section aria-labelledby="supply-heading" className="card flex flex-col gap-2 p-5" data-testid="leader-board">
        <h2 id="supply-heading" className="t-heading">
          Where members are waiting
        </h2>
        <p className="t-body text-soft">We could not read the board. Try the page again in a moment.</p>
      </section>
    );
  }

  const need = goalsInNeed(board);
  const rest = otherGoals(board);
  const open = offers.filter((o) => o.status === "offered");
  const past = offers.filter((o) => o.status !== "offered");

  async function suggest(goal: BoardGoal) {
    setSaid(null);
    await d.go(`suggest-${goal.goalId}`, async () => {
      const result = await suggestLeadersAction(goal.goalId);
      if (result.ok) setFound((f) => ({ ...f, [goal.goalId]: result.suggestions }));
      return result.ok ? { ok: true as const } : result;
    });
  }

  async function offer(goal: BoardGoal, personId: string, name: string) {
    setConfirming(null);
    await d.go(`offer-${personId}`, async () => {
      const result = await sendOfferAction(goal.goalId, personId);
      if (result.ok) {
        setSaid(`Offer sent to ${name}. They are told how many are waiting, and nothing else about the members.`);
        setFound((f) => {
          const next = { ...f };
          delete next[goal.goalId];
          return next;
        });
      }
      return result.ok ? { ok: true as const } : result;
    });
  }

  async function withdraw(o: Offer) {
    await d.go(`withdraw-${o.id}`, async () => {
      const result = await withdrawOfferAction(o.id);
      if (result.ok) setSaid(`The offer to ${o.name} was withdrawn.`);
      return result.ok ? { ok: true as const } : result;
    });
  }

  return (
    <section aria-labelledby="supply-heading" className="flex flex-col gap-6" data-testid="leader-board">
      <div className="flex flex-col gap-1">
        <h2 id="supply-heading" className="t-heading">
          Where members are waiting
        </h2>
        <p className="t-small measure text-soft">
          Members who chose a goal and have no seat in a tribe for it, less the seats already open. Where that is above zero, a leader is needed. Suggestions are worked out now from each leader’s saved answers. A pastor still approves every Tribe Card.
        </p>
      </div>

      <Notice error={d.error} saved={said} />

      <div className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={board.season ? "gold" : "flame"}>{board.season ? board.season.name : "No season open"}</Badge>
          <Badge tone={board.model ? "gold" : "flame"}>{board.model ? `Fit model ${board.model}` : "No fit model approved"}</Badge>
          <span className="t-small text-soft" data-testid="board-cards">
            {board.cardsSigned} {board.cardsSigned === 1 ? "tribe card is" : "tribe cards are"} signed off.
          </span>
        </div>
        {board.missing ? (
          <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid="board-missing">
            {board.missing}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="t-heading">Needing a leader</h3>
        {need.length === 0 ? (
          <p className="t-body text-soft" data-testid="board-none">
            Every member who is waiting has a seat open, or nobody is waiting. Nothing needs a new leader right now.
          </p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {need.map((g) => {
            const s = found[g.goalId];
            return (
              <li key={g.goalId} className="card flex flex-col gap-3 p-5" data-testid={`goal-${g.goalId}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{g.title}</span>
                  {g.community ? <Badge tone="outline">{g.community}</Badge> : null}
                  <Badge tone="flame">{g.gap === 1 ? "1 seat needed" : `${g.gap} seats needed`}</Badge>
                  {g.openOffers > 0 ? <Badge tone="gold">{g.openOffers === 1 ? "1 offer open" : `${g.openOffers} offers open`}</Badge> : null}
                </div>
                <p className="t-small">{gapSentence(g)}</p>
                <p className="t-small text-soft">{interestSentence(g)}</p>
                {!g.ready ? (
                  <p className="t-small text-soft" data-testid={`notready-${g.goalId}`}>
                    This goal’s ready-made card is not signed off, so it cannot be offered yet.{" "}
                    <Link href="/review/cards" className="underline">
                      Open the cards
                    </Link>
                  </p>
                ) : null}
                <div>
                  <Button variant="quiet" size="sm" loading={d.busy === `suggest-${g.goalId}`} disabled={!g.ready} onClick={() => void suggest(g)} data-testid={`suggest-${g.goalId}`}>
                    {s ? "Look again" : "Who could lead this?"}
                  </Button>
                </div>
                {s ? (
                  <div className="flex flex-col gap-3 border-t border-line pt-3" data-testid={`suggestions-${g.goalId}`}>
                    {s.suggestions.length === 0 ? <p className="t-small text-soft">{noSuggestionsLine(s)}</p> : null}
                    <ul className="flex flex-col gap-3">
                      {s.suggestions.map((x) => (
                        <li key={x.personId} className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid={`suggestion-${x.personId}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{x.name}</span>
                            <Badge tone="gold">
                              {x.label} · {x.degree}
                            </Badge>
                            {x.choice ? <Badge tone="outline">{CHOICE_WORDS[x.choice]}</Badge> : null}
                            {x.nextToTheirStage ? <Badge tone="outline">Next to their stage of life</Badge> : null}
                          </div>
                          <p className="t-small text-soft">{x.reason}</p>
                          {canOffer ? (
                            confirming === x.personId ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="t-small">Send the offer to {x.name}?</span>
                                <Button size="sm" loading={d.busy === `offer-${x.personId}`} onClick={() => void offer(g, x.personId, x.name)} data-testid={`confirm-offer-${x.personId}`}>
                                  Send it
                                </Button>
                                <Button variant="quiet" size="sm" onClick={() => setConfirming(null)}>
                                  Not now
                                </Button>
                              </div>
                            ) : (
                              <div>
                                <Button variant="quiet" size="sm" onClick={() => setConfirming(x.personId)} data-testid={`offer-${x.personId}`}>
                                  Offer this tribe
                                </Button>
                              </div>
                            )
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {!canOffer && s.suggestions.length > 0 ? <p className="t-small text-soft">Only the pastor, directors and the admin can make an offer.</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {rest.length > 0 ? (
        <details className="card p-5" data-testid="board-rest">
          <summary className="t-heading cursor-pointer">Other goals with members or leaders interested ({rest.length})</summary>
          <ul className="mt-3 flex flex-col gap-3">
            {rest.map((g) => (
              <li key={g.goalId} className="flex flex-col gap-1 border-b border-line pb-3 last:border-b-0 last:pb-0">
                <span className="font-semibold">
                  {g.title} {g.community ? <span className="t-small font-normal text-soft">· {g.community}</span> : null}
                </span>
                <span className="t-small">{gapSentence(g)}</span>
                <span className="t-small text-soft">{interestSentence(g)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="card flex flex-col gap-3 p-5" data-testid="offers">
        <h3 className="t-heading">Offers</h3>
        {offers.length === 0 ? <p className="t-body text-soft">No offer has been made.</p> : null}
        {open.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {open.map((o) => (
              <li key={o.id} className="flex flex-col gap-1 border-b border-line pb-3 last:border-b-0 last:pb-0" data-testid={`offer-row-${o.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.name}</span>
                  <span className="t-small text-soft">was offered {o.goal}</span>
                  <Badge tone="flame">{OFFER_STATUS_WORDS[o.status]}</Badge>
                  {canOffer ? (
                    <Button variant="quiet" size="sm" loading={d.busy === `withdraw-${o.id}`} onClick={() => void withdraw(o)} data-testid={`withdraw-${o.id}`}>
                      Withdraw
                    </Button>
                  ) : null}
                </div>
                <p className="t-small text-soft">
                  {people(o.waitingAtOffer)} waiting when it was sent{o.expiresAt ? `. Open until ${dayOf(o.expiresAt)}` : ""}.
                  {o.offeredBy ? ` Offered by ${o.offeredBy}.` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {past.length > 0 ? (
          <details>
            <summary className="t-small cursor-pointer text-soft">Answered, withdrawn or expired in the last 90 days ({past.length})</summary>
            <ul className="mt-3 flex flex-col gap-2">
              {past.map((o) => (
                <li key={o.id} className="t-small flex flex-wrap items-center gap-2" data-testid={`offer-row-${o.id}`}>
                  <span className="font-semibold">{o.name}</span>
                  <span className="text-soft">{o.goal}</span>
                  <Badge tone={o.status === "accepted" ? "gold" : "outline"}>{OFFER_STATUS_WORDS[o.status]}</Badge>
                  {o.answeredAt ? <span className="text-soft">{dayOf(o.answeredAt)}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {board.fewOptions.length > 0 ? (
        <div className="card flex flex-col gap-3 p-5" data-testid="few-options">
          <h3 className="t-heading">Leaders with few good options</h3>
          <p className="t-small text-soft">
            Their last look found fewer than three tribes that suit them. Few good options usually means the cards or the goals in their community are thin, not that the leader is. A pastor may want to add a card.
          </p>
          <ul className="flex flex-col gap-1">
            {board.fewOptions.map((f) => (
              <li key={f.personId} className="t-small">
                <span className="font-semibold">{f.name}</span> <span className="text-soft">· {["no good options", "one good option", "two good options"][Math.min(2, f.shown)]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
