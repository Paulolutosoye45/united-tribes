"use client";

import { useState } from "react";
import { answerRemovalAction, askRemovalAction, withdrawRemovalAction } from "@/app/(app)/lead/tribe/removal-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { formatShortDate } from "@/lib/dates";
import { NOTE_MAX, REASONS, REMOVAL_WORDS, STATUS_LINE, noteProblem, type Mine, type MineRequest } from "@/lib/removal/removal";

type Member = { person_id: string; first_name: string };

/**
 * A leader's place to ask the church about a member's place in their tribe, and to see the answer. A leader never removes anyone here: the request goes
 * to a person who can decide, and the member is told nothing unless it is approved. Hidden while the church has not opened it (the database answers Off).
 */
export function RemovalAsk({ tribeId, mine, members }: { tribeId: string; mine: Mine; members: Member[] }) {
  if (!mine.can_ask || mine.state === "off") return null;
  const waiting = new Set(mine.requests.filter((r) => r.status === "open").map((r) => r.member_id));
  const choices = members.filter((m) => !waiting.has(m.person_id));
  const full = mine.open >= mine.max;

  return (
    <section aria-labelledby="removal-heading" className="flex flex-col gap-4" data-testid="removal-ask">
      <div className="flex flex-col gap-1.5">
        <h2 id="removal-heading" className="t-heading">
          {REMOVAL_WORDS.mineTitle}
        </h2>
        <p className="t-small measure text-soft">{REMOVAL_WORDS.mineIntro}</p>
        {mine.state === "rehearsal" ? (
          <p className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="removal-practice">
            {REMOVAL_WORDS.practice}
          </p>
        ) : null}
      </div>

      {mine.requests.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {mine.requests.map((r) => (
            <MineCard key={r.id} request={r} />
          ))}
        </ul>
      ) : null}

      {members.length === 0 ? null : full ? (
        <p className="t-small text-soft" data-testid="removal-limit">
          {REMOVAL_WORDS.limit(mine.open, mine.max)}
        </p>
      ) : choices.length === 0 ? null : (
        <AskForm tribeId={tribeId} choices={choices} practice={mine.state === "rehearsal"} />
      )}
    </section>
  );
}

function MineCard({ request: r }: { request: MineRequest }) {
  const d = useDo();
  const [answer, setAnswer] = useState("");
  const problem = noteProblem(answer, 1, NOTE_MAX);
  return (
    <li className="card flex flex-col gap-3 p-4 sm:p-5" data-testid="removal-mine-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{r.member_first}</p>
          <p className="t-small text-soft">Asked {r.created_at ? formatShortDate(r.created_at) : ""}</p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          {r.rehearsal ? <Badge tone="outline">Practice</Badge> : null}
          <Badge tone={r.status === "open" ? "gold" : "neutral"}>{r.status === "open" ? (r.waiting_on === "leader" ? "Your answer needed" : "Waiting") : r.status === "approved" ? "Approved" : r.status === "declined" ? "Not approved" : "Withdrawn"}</Badge>
        </span>
      </div>
      <p className="t-small text-soft">{STATUS_LINE(r)}</p>

      {r.status === "approved" && !r.rehearsal ? <p className="t-small">{REMOVAL_WORDS.removeFromGroup}</p> : null}
      {r.status === "declined" && r.decision_note ? (
        <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid="removal-decision-note">
          <span className="font-semibold">From the church: </span>
          {r.decision_note}
        </p>
      ) : null}

      {r.status === "open" && r.waiting_on === "leader" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void d.go("answer", () => answerRemovalAction(r.id, answer), { saved: REMOVAL_WORDS.answerSent, after: () => setAnswer("") });
          }}
        >
          {r.question ? (
            <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid="removal-question">
              <span className="font-semibold">The church asks: </span>
              {r.question}
            </p>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.95rem] font-medium">{REMOVAL_WORDS.answerLabel}</span>
            <textarea className="input min-h-24 py-3" value={answer} maxLength={NOTE_MAX} required onChange={(e) => setAnswer(e.target.value)} />
            <span className="t-small text-soft">
              {answer.trim().length} of {NOTE_MAX}
            </span>
          </label>
          <Notice error={d.error} saved={d.saved} />
          <div>
            <Button type="submit" size="md" variant="solid" loading={d.busy === "answer"} disabled={problem !== null}>
              {REMOVAL_WORDS.answerSubmit}
            </Button>
          </div>
        </form>
      ) : null}

      {r.status === "open" ? (
        <div className="flex flex-col gap-2">
          {r.waiting_on === "approver" ? <Notice error={d.error} saved={d.saved} /> : null}
          <div>
            <Button size="sm" variant="quiet" loading={d.busy === "withdraw"} onClick={() => void d.go("withdraw", () => withdrawRemovalAction(r.id), { saved: REMOVAL_WORDS.withdrawn })}>
              {REMOVAL_WORDS.withdraw}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function AskForm({ tribeId, choices, practice }: { tribeId: string; choices: Member[]; practice: boolean }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState(choices[0]?.person_id ?? "");
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [spoken, setSpoken] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const chosen = choices.find((c) => c.person_id === member) ?? choices[0];
  const problem = noteProblem(note);
  const ready = Boolean(chosen) && reason !== "" && problem === null && spoken;

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {said ? <Notice error={null} saved={said} /> : null}
        <div>
          <Button size="md" variant="quiet" onClick={() => (setSaid(null), setOpen(true))} data-testid="removal-open">
            Ask the church about a member’s place
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="card flex flex-col gap-5 p-5 sm:p-6"
      data-testid="removal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || !chosen) return;
        void d.go("ask", () => askRemovalAction(tribeId, chosen.person_id, reason, note, spoken, urgent), {
          after: () => (setOpen(false), setReason(""), setNote(""), setSpoken(false), setUrgent(false), setSaid(practice ? REMOVAL_WORDS.sentPractice : REMOVAL_WORDS.sent)),
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <h3 className="font-semibold">{chosen ? REMOVAL_WORDS.askTitle(chosen.first_name) : "Ask the church about a member’s place"}</h3>
        <p className="t-small measure text-soft">{REMOVAL_WORDS.askIntro}</p>
      </div>

      {choices.length > 1 ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.95rem] font-medium">Who is this about?</span>
          <select className="input" value={member} onChange={(e) => setMember(e.target.value)} data-testid="removal-member">
            {choices.map((c) => (
              <option key={c.person_id} value={c.person_id}>
                {c.first_name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[0.95rem] font-medium">{REMOVAL_WORDS.reasonLabel}</legend>
        {REASONS.map((r) => (
          <Choice key={r.id} name="removal-reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} title={r.label} description={r.hint} />
        ))}
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-[0.95rem] font-medium">{REMOVAL_WORDS.noteLabel}</span>
        <textarea className="input min-h-32 py-3" value={note} maxLength={NOTE_MAX + 50} onChange={(e) => setNote(e.target.value)} data-testid="removal-note" />
        <span className="t-small text-soft">
          {REMOVAL_WORDS.noteHint} ({note.trim().length} of {NOTE_MAX})
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 size-5" checked={spoken} onChange={(e) => setSpoken(e.target.checked)} data-testid="removal-spoken" />
        <span>
          <span className="block text-[0.95rem] font-medium">{REMOVAL_WORDS.spokenLabel}</span>
          <span className="t-small block text-soft">{REMOVAL_WORDS.spokenHint}</span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 size-5" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} data-testid="removal-urgent" />
        <span>
          <span className="block text-[0.95rem] font-medium">{REMOVAL_WORDS.urgentLabel}</span>
          <span className="t-small block text-soft">{REMOVAL_WORDS.urgentHint}</span>
        </span>
      </label>

      {note.trim().length > 0 && problem ? <p className="t-small text-soft">{problem}</p> : null}
      <Notice error={d.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="md" variant="solid" loading={d.busy === "ask"} disabled={!ready}>
          {REMOVAL_WORDS.submit}
        </Button>
        <Button type="button" size="md" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
