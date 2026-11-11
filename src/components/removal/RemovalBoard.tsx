"use client";

import { useState } from "react";
import { decideRemovalAction, recommendRemovalAction, reinstateRemovalAction, upholdRemovalAction } from "@/app/(app)/growth/removals/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { formatShortDate, plural } from "@/lib/dates";
import { DECISION_NOTE_MAX, DECISION_NOTE_MIN, REMOVAL_WORDS, needsAction, noteProblem, reasonLabel, type Board, type BoardRequest } from "@/lib/removal/removal";

/**
 * The page for the people who decide: a coach (their own tribes' ordinary requests), the Care Lead, directors and admins, and pastors, who read all of
 * them. What a person may do with each request is decided by the database and drawn from its answer; this page never works it out for itself.
 */
export function RemovalBoard({ board }: { board: Board }) {
  if (board.state === "off") {
    return (
      <p className="t-body measure text-soft" data-testid="removal-off">
        {REMOVAL_WORDS.boardOff}
      </p>
    );
  }
  const now = board.requests.filter(needsAction);
  const rest = board.requests.filter((r) => !needsAction(r));
  return (
    <div className="flex flex-col gap-8" data-testid="removal-board">
      {board.state === "rehearsal" ? (
        <p className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="removal-practice">
          {REMOVAL_WORDS.practiceBanner}
        </p>
      ) : null}
      {board.requests.length === 0 ? <p className="t-body text-soft">{REMOVAL_WORDS.boardEmpty}</p> : null}
      {now.length > 0 ? (
        <section aria-labelledby="removal-now" className="flex flex-col gap-3">
          <h2 id="removal-now" className="t-heading">
            Waiting for you ({now.length})
          </h2>
          <ul className="flex flex-col gap-4">
            {now.map((r) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        </section>
      ) : null}
      {rest.length > 0 ? (
        <section aria-labelledby="removal-rest" className="flex flex-col gap-3">
          <h2 id="removal-rest" className="t-heading">
            {now.length > 0 ? "Everything else" : "Requests"}
          </h2>
          <ul className="flex flex-col gap-4">
            {rest.map((r) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function statusBadge(r: BoardRequest) {
  if (r.status === "open") return <Badge tone="gold">{r.waiting_on === "leader" ? "Waiting for the leader" : "Waiting for a decision"}</Badge>;
  if (r.status === "approved") return <Badge tone={r.reinstated_at ? "neutral" : "charcoal"}>{r.reinstated_at ? "Place put back" : "Approved"}</Badge>;
  if (r.status === "declined") return <Badge tone="neutral">Declined</Badge>;
  return <Badge tone="outline">Withdrawn</Badge>;
}

function RequestCard({ r }: { r: BoardRequest }) {
  return (
    <li className="card flex flex-col gap-4 p-4 sm:p-5" data-testid="removal-card" data-status={r.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug">
            {r.member} <span className="font-normal text-soft">in {r.tribe}</span>
          </p>
          <p className="t-small text-soft">
            Asked by {r.leader} on {r.created_at ? formatShortDate(r.created_at) : ""}
            {r.status === "open" ? `, ${plural(r.days, "day")} ago` : ""}. {reasonLabel(r.reason)}.
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          {r.rehearsal ? <Badge tone="outline">Practice</Badge> : null}
          {r.urgent ? <Badge tone="flame">{REMOVAL_WORDS.urgent}</Badge> : null}
          {r.restricted ? <Badge tone="charcoal">Care Team decides</Badge> : null}
          {statusBadge(r)}
        </span>
      </div>

      {r.under_18 ? <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3">{REMOVAL_WORDS.under18}</p> : null}
      {r.status === "open" && r.restricted ? <p className="t-small text-soft">{r.can_decide ? REMOVAL_WORDS.restricted : REMOVAL_WORDS.restrictedRead}</p> : null}

      {r.recommendation ? (
        <div className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-line px-4 py-3" data-testid="removal-recommendation">
          <p className="t-small">
            <span className="font-semibold">{REMOVAL_WORDS.recommendationBy(r.recommendation.by)}: </span>
            {REMOVAL_WORDS.recommendationWord[r.recommendation.decision]}
          </p>
          {r.recommendation.note ? <p className="t-small">“{r.recommendation.note}”</p> : null}
          {r.status === "open" && r.can_decide ? <p className="t-small text-soft">{REMOVAL_WORDS.decideFirst}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-surface px-4 py-3">
        <p className="t-small">
          <span className="font-semibold">What the leader wrote: </span>
          {r.note ?? (r.note_cleared ? REMOVAL_WORDS.cleared : "—")}
        </p>
        <p className="t-small text-soft">
          Attendance in this tribe: {r.attendance.present} present, {r.attendance.absent} absent, {r.attendance.excused} excused.
        </p>
      </div>

      {r.thread.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Questions and answers">
          {r.thread.map((t, i) => (
            <li key={i} className="t-small">
              <span className="font-semibold">{t.side === "approver" ? "The church asked: " : "The leader answered: "}</span>
              {t.body ?? "—"}
            </li>
          ))}
        </ul>
      ) : null}

      {r.status === "declined" || r.status === "approved" ? (
        <p className="t-small text-soft">
          {r.status === "approved" ? "Approved" : "Declined"}
          {r.decided_by ? ` by ${r.decided_by}` : ""}
          {r.decided_at ? ` on ${formatShortDate(r.decided_at)}` : ""}.{r.decision_note ? ` “${r.decision_note}”` : ""}
        </p>
      ) : null}

      {r.appeal ? (
        <div className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-line px-4 py-3" data-testid="removal-appeal">
          <p className="font-semibold">{REMOVAL_WORDS.appealHeading}</p>
          {r.appeal.note ? <p className="t-small">{r.appeal.note}</p> : null}
          <p className="t-small text-soft">
            {r.appeal.status === "open" ? REMOVAL_WORDS.appealOpen : r.appeal.status === "upheld" ? REMOVAL_WORDS.appealUpheld : REMOVAL_WORDS.appealReinstated}
            {r.appeal.decision_note ? ` “${r.appeal.decision_note}”` : ""}
          </p>
        </div>
      ) : null}

      {r.status === "open" && r.can_decide ? <DecideForm r={r} /> : null}
      {r.status === "open" && r.can_recommend && !r.can_decide ? <RecommendForm r={r} /> : null}
      {r.status === "approved" && (r.can_reinstate || r.can_judge_appeal) ? <AfterwardsForm r={r} /> : null}
    </li>
  );
}

const CHOICES = [
  { id: "approve", title: REMOVAL_WORDS.approve, description: REMOVAL_WORDS.approveSure },
  { id: "decline", title: REMOVAL_WORDS.decline, description: REMOVAL_WORDS.declineSure },
  { id: "ask", title: REMOVAL_WORDS.ask, description: REMOVAL_WORDS.askSure },
] as const;

function DecideForm({ r }: { r: BoardRequest }) {
  const d = useDo();
  const [choice, setChoice] = useState<string>("");
  const [note, setNote] = useState("");
  const problem = noteProblem(note, DECISION_NOTE_MIN, DECISION_NOTE_MAX);
  const options = r.waiting_on === "leader" ? CHOICES.filter((c) => c.id !== "ask") : CHOICES;
  return (
    <form
      noValidate
      className="flex flex-col gap-4 border-t border-line pt-4"
      data-testid="removal-decide"
      onSubmit={(e) => {
        e.preventDefault();
        if (!choice || problem) return;
        void d.go("decide", () => decideRemovalAction(r.id, choice, note), { saved: REMOVAL_WORDS.decided(choice === "approve" ? "Their place has been released." : choice === "decline" ? "The leader has been told." : "The leader has been asked.") });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[0.95rem] font-medium">{REMOVAL_WORDS.decideLabel}</legend>
        {options.map((c) => (
          <Choice key={c.id} name={`decision-${r.id}`} value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)} title={c.title} description={c.description} />
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-[0.95rem] font-medium">{REMOVAL_WORDS.noteForDecision}</span>
        <textarea className="input min-h-24 py-3" value={note} maxLength={DECISION_NOTE_MAX + 50} onChange={(e) => setNote(e.target.value)} data-testid="removal-decision-note" />
        <span className="t-small text-soft">{REMOVAL_WORDS.noteForDecisionHint}</span>
      </label>
      {note.trim().length > 0 && problem ? <p className="t-small text-soft">{problem}</p> : null}
      <Notice error={d.error} saved={d.saved} />
      <div>
        <Button type="submit" size="md" variant="solid" loading={d.busy === "decide"} disabled={!choice || problem !== null}>
          Send my decision
        </Button>
      </div>
    </form>
  );
}

const RECOMMENDATIONS = [
  { id: "approve", title: REMOVAL_WORDS.recommendApprove },
  { id: "decline", title: REMOVAL_WORDS.recommendDecline },
  { id: "ask", title: REMOVAL_WORDS.recommendAsk },
] as const;

/** The coach of the tribe says what they would do. It decides nothing: the person deciding reads it first, and the leader never sees it. */
function RecommendForm({ r }: { r: BoardRequest }) {
  const d = useDo();
  const mine = r.recommendation;
  const [choice, setChoice] = useState<string>(mine?.decision ?? "");
  const [note, setNote] = useState(mine?.note ?? "");
  const problem = noteProblem(note, DECISION_NOTE_MIN, DECISION_NOTE_MAX);
  return (
    <form
      noValidate
      className="flex flex-col gap-4 border-t border-line pt-4"
      data-testid="removal-recommend"
      onSubmit={(e) => {
        e.preventDefault();
        if (!choice || problem) return;
        void d.go("recommend", () => recommendRemovalAction(r.id, choice, note), { saved: REMOVAL_WORDS.recommendSent });
      }}
    >
      <p className="t-small text-soft">{REMOVAL_WORDS.coachReadOnly}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[0.95rem] font-medium">{REMOVAL_WORDS.recommendHeading}</legend>
        {RECOMMENDATIONS.map((c) => (
          <Choice key={c.id} name={`recommendation-${r.id}`} value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)} title={c.title} />
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-[0.95rem] font-medium">{REMOVAL_WORDS.noteForDecision}</span>
        <textarea className="input min-h-24 py-3" value={note} maxLength={DECISION_NOTE_MAX + 50} onChange={(e) => setNote(e.target.value)} data-testid="removal-recommend-note" />
        <span className="t-small text-soft">{REMOVAL_WORDS.recommendHint}</span>
      </label>
      {note.trim().length > 0 && problem ? <p className="t-small text-soft">{problem}</p> : null}
      <Notice error={d.error} saved={d.saved} />
      <div>
        <Button type="submit" size="md" variant="solid" loading={d.busy === "recommend"} disabled={!choice || problem !== null}>
          {mine ? REMOVAL_WORDS.recommendUpdate : REMOVAL_WORDS.recommendSubmit}
        </Button>
      </div>
    </form>
  );
}

/** After an approval: put the place back, or, if the member asked for it to be looked at again, keep the decision or put it back. */
function AfterwardsForm({ r }: { r: BoardRequest }) {
  const d = useDo();
  const [note, setNote] = useState("");
  const problem = noteProblem(note, DECISION_NOTE_MIN, DECISION_NOTE_MAX);
  const judging = r.appeal?.status === "open" && r.can_judge_appeal;
  return (
    <form className="flex flex-col gap-3 border-t border-line pt-4" noValidate data-testid="removal-afterwards" onSubmit={(e) => e.preventDefault()}>
      <label className="flex flex-col gap-1.5">
        <span className="text-[0.95rem] font-medium">{REMOVAL_WORDS.noteForDecision}</span>
        <textarea className="input min-h-20 py-3" value={note} maxLength={DECISION_NOTE_MAX + 50} onChange={(e) => setNote(e.target.value)} />
        <span className="t-small text-soft">{r.can_reinstate ? REMOVAL_WORDS.reinstateHint : REMOVAL_WORDS.noteForDecisionHint}</span>
      </label>
      <Notice error={d.error} saved={d.saved} />
      <div className="flex flex-wrap gap-2">
        {r.can_reinstate ? (
          <Button size="md" variant="solid" loading={d.busy === "reinstate"} disabled={problem !== null} onClick={() => void d.go("reinstate", () => reinstateRemovalAction(r.id, note), { saved: "Their place has been put back, and they and the leader have been told." })}>
            {REMOVAL_WORDS.reinstate}
          </Button>
        ) : null}
        {judging ? (
          <Button size="md" variant="quiet" loading={d.busy === "uphold"} disabled={problem !== null} onClick={() => void d.go("uphold", () => upholdRemovalAction(r.id, note), { saved: "The decision stands." })}>
            {REMOVAL_WORDS.uphold}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
