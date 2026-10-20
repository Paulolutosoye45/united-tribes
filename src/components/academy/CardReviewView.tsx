"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { assignCoachAction, decideCardAction, pairAssistantAction } from "@/app/(app)/review/cards/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Input";
import { valuesFromCard } from "@/lib/academy/card";
import { needsOf } from "@/lib/academy/modes";
import { CARD_STATUS } from "@/lib/academy/options";
import type { AssistantSuggestion, CardReview } from "@/lib/academy/types";
import { TribePreview } from "./TribePreview";

export function CardReviewView({ card, suggestions, canPair }: { card: CardReview; suggestions: AssistantSuggestion[]; canPair: boolean }) {
  const router = useRouter();
  const status = CARD_STATUS[card.status];
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setBusy(key);
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) return setError(result.message);
    setNote("");
    router.refresh();
  }

  const s = card.leader_state;
  // Only what certification asks for is listed as a condition. A part that is optional or off is marked, so the reviewer is never left
  // wondering why a leader is certified with the training undone.
  const need = needsOf(s);
  const conditions = [
    { ok: s.modules_done, label: need.modules ? `Modules ${s.modules_passed} of ${s.modules_total}` : `Modules ${s.modules_passed} of ${s.modules_total} (not needed)` },
    ...(need.declaration ? [{ ok: s.declaration, label: "Declaration signed" }] : [{ ok: s.declaration, label: s.declaration ? "Declaration signed (not needed)" : "Declaration not asked for" }]),
    { ok: s.practice, label: need.practice ? "Practice session ready" : "Practice session (not needed)" },
    { ok: s.card, label: "Card approved" },
  ];

  const canDecide = card.can_decide && (card.status === "submitted" || card.status === "approved");

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="t-heading">The card</h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <TribePreview values={valuesFromCard(card)} community={card.community?.name ?? null} track={card.track?.name ?? null} goal={card.goal?.title ?? null} leader={card.leader.name} />
        <p className="t-small text-soft">
          {card.season.name}. {card.tribe_type === "mixed" ? "Mixed tribe" : card.tribe_type === "women" ? "Women only" : "Men only"}.
          {card.place_note ? ` Area: ${card.place_note}.` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <section aria-labelledby="leader-heading" className="card flex flex-col gap-3 p-5 sm:p-6">
          <h2 id="leader-heading" className="t-heading">
            {card.leader.name}
          </h2>
          <ul className="flex flex-wrap gap-2" aria-label="Training">
            {conditions.map((c) => (
              <li key={c.label} className={`t-small inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${c.ok ? "bg-gold/30 text-ink" : "bg-surface text-soft"}`}>
                <span aria-hidden="true">{c.ok ? "✓" : "·"}</span>
                {c.label}
              </li>
            ))}
          </ul>
          {s.certified ? <p className="t-small text-soft">Certified.</p> : null}
        </section>

        {card.review_note ? (
          <section className="card flex flex-col gap-1 p-5">
            <h2 className="font-semibold">{card.status === "changes_requested" ? "Changes asked for" : "Note on this card"}</h2>
            <p className="t-body whitespace-pre-line text-soft">{card.review_note}</p>
          </section>
        ) : null}

        {canDecide ? (
          <section aria-labelledby="decide-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
            <h2 id="decide-heading" className="t-heading">
              {card.status === "approved" ? "Take it off the shelf" : "Your decision"}
            </h2>
            <Textarea
              label={card.status === "approved" ? "What needs to change" : "Note to the leader"}
              name="note"
              rows={3}
              value={note}
              maxLength={600}
              optional={card.status === "submitted"}
              hint={card.status === "submitted" ? "Required if you ask for changes. Optional if you approve." : "The leader sees this note and can edit the card again."}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-3">
              {card.status === "submitted" ? (
                <Button loading={busy === "approve"} onClick={() => void run("approve", () => decideCardAction(card.id, "approve", note))}>
                  Approve and publish
                </Button>
              ) : null}
              <Button variant="quiet" loading={busy === "changes"} disabled={note.trim().length < 3} onClick={() => void run("changes", () => decideCardAction(card.id, "changes", note))}>
                Ask for changes
              </Button>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="assistant-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 id="assistant-heading" className="t-heading">
              Assistant leader
            </h2>
            <p className="t-small text-soft">
              {card.assistant ? `Paired with ${card.assistant.name}.` : "Not paired yet."} Suggestions favour a different way of leading from the leader’s, so the two balance each other.
            </p>
          </div>
          {suggestions.length === 0 ? (
            <p className="t-body text-soft">No assistant leaders are free this season.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {suggestions.slice(0, 6).map((a) => (
                <li key={a.person_id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {a.name} <span className="t-small font-normal text-soft">· {a.fit}% fit{a.certified ? " · certified" : ""}</span>
                    </p>
                    <p className="t-small text-soft">{a.reason}</p>
                  </div>
                  {canPair ? (
                    a.paired_here ? (
                      <Button variant="quiet" size="sm" loading={busy === `un-${a.person_id}`} onClick={() => void run(`un-${a.person_id}`, () => pairAssistantAction(card.id, null))}>
                        Unpair
                      </Button>
                    ) : (
                      <Button size="sm" loading={busy === a.person_id} onClick={() => void run(a.person_id, () => pairAssistantAction(card.id, a.person_id))}>
                        Pair
                      </Button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {card.can_decide ? (
          <section aria-labelledby="coach-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
            <h2 id="coach-heading" className="t-heading">
              Coach
            </h2>
            <Select
              label="Who looks after this tribe"
              name="coach"
              value={card.coach?.id ?? ""}
              disabled={busy === "coach"}
              onChange={(e) => void run("coach", () => assignCoachAction(card.id, e.target.value || null))}
            >
              <option value="">No coach yet</option>
              {card.coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.tribes} {c.tribes === 1 ? "tribe" : "tribes"})
                </option>
              ))}
            </Select>
            <p className="t-small -mt-2 text-soft">A coach looks after about five tribes. They see this card and their tribes’ health once the season starts.</p>
          </section>
        ) : card.coach ? (
          <p className="t-small text-soft">Coach: {card.coach.name}</p>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
            {error}
          </p>
        ) : null}

        <Link href="/review/cards" className="t-small w-fit font-semibold underline underline-offset-4">
          All Tribe Cards
        </Link>
      </div>
    </div>
  );
}
