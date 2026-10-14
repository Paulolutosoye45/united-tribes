"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  clearConcernAction,
  decideAction,
  inviteToInterviewAction,
  saveReviewAction,
} from "@/app/(app)/review/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Textarea } from "@/components/ui/Input";
import { AiScorecard } from "./AiScorecard";
import { RefereeTrust } from "./RefereeTrust";
import { ScaleInput } from "@/components/intake/ui";
import type { Role } from "@/lib/auth/roles";
import { cn } from "@/lib/cn";
import { formatLagosDay, formatLagosTime, formatShortDate } from "@/lib/dates";
import { normaliseWhatsapp } from "@/lib/intake/answers";
import { STYLE_PAIRS } from "@/lib/intake/options";
import {
  CALLING_RUBRIC,
  GOAL_RELATIONS,
  INTERVIEW_RUBRIC,
  LEAD_BEST,
  REFEREE_QUESTIONS,
  REVIEW_STATUS,
  SCORE_WORDS,
  WALK_LABELS,
  type RubricQuestion,
} from "@/lib/leaders/options";
import type { ReviewReferee } from "@/lib/leaders/referee/types";
import type { ReferenceView, Readiness, ReviewDetail, Scorecard } from "@/lib/leaders/review-types";
import { isDecided } from "@/lib/leaders/status";

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function ReviewWorkspace({ detail, roles, scorecard = null, referees = null }: { detail: ReviewDetail; roles: Role[]; scorecard?: Scorecard | null; referees?: ReviewReferee[] | null }) {
  const answers = detail.answers as { calling?: Json; style?: Json };
  const calling = (answers.calling ?? {}) as Json;
  const style = (answers.style ?? {}) as Json;
  const decided = isDecided(detail.status);
  const isPastor = roles.includes("pastor");
  const st = REVIEW_STATUS[detail.status] ?? { label: detail.status, tone: "neutral" as const };
  const relation = GOAL_RELATIONS.find((r) => r.id === calling.goalRelation)?.label;
  const goal = detail.goal_title ?? str(calling.goalOther);
  const phone = normaliseWhatsapp(detail.whatsapp ?? "");
  const walk = Number(calling.walkRating);
  const interviewOpen = detail.status === "interview_booked" || detail.status === "interviewed";

  return (
    <div className="flex flex-col gap-8">
      <Link href="/review" className="press -ml-1 inline-flex w-fit items-center gap-1.5 rounded-lg px-1 py-1 text-[0.95rem] font-medium text-soft hover:text-ink">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
        All applications
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="t-title">{detail.applicant}</h1>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <p className="t-body text-soft">
          {[detail.community_name, goal && `Goal: ${goal}`, relation && relation.toLowerCase()].filter(Boolean).join(" · ")}
          {detail.submitted_at ? ` · Sent ${formatShortDate(detail.submitted_at)}` : ""}
        </p>
        {phone ? (
          <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="t-small w-fit font-semibold text-accent underline underline-offset-4">
            WhatsApp {phone}
          </a>
        ) : null}
        {detail.interview ? (
          <p className="t-small text-soft">
            Interview {formatLagosDay(detail.interview.starts_at)}, {formatLagosTime(detail.interview.starts_at)} · {detail.interview.mode === "online" ? "Online" : "In person"} · {detail.interview.place}
          </p>
        ) : null}
      </header>

      {decided ? (
        <section className="card flex flex-col gap-2 p-5" aria-label="Decision">
          <p className="font-semibold">{st.label}{detail.decided_at ? `, ${formatShortDate(detail.decided_at)}` : ""}</p>
          {detail.decision_note ? <p className="t-body whitespace-pre-line text-soft">{detail.decision_note}</p> : null}
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:items-start">
        <div className="flex flex-col gap-8">
          <Section title="Their answers">
            <Answer label="Their story with the goal" text={str(calling.goalStory)} />
            <Answer label="Why they want to lead" text={str(calling.why)} />
            <Answer label="A time they walked with someone" text={str(calling.walked)} />
            <Answer
              label={`Their walk with God${walk ? `, ${walk} of 5` : ""}`}
              text={str(calling.walkNote)}
              sub={walk ? WALK_LABELS[walk - 1] : undefined}
            />
            <Answer label="What could get in the way" text={str(calling.obstacles)} />
          </Section>

          <Section title="Style" hint="Used to pair them with an assistant. It never counts for or against them.">
            <dl className="divide-y divide-line">
              <div className="flex justify-between gap-4 px-5 py-3">
                <dt className="t-small text-soft">Leads best by</dt>
                <dd className="text-right font-medium">{LEAD_BEST.find((o) => o.id === style.leadBest)?.label ?? "Not answered"}</dd>
              </div>
              {STYLE_PAIRS.map((p) => {
                const v = Number(style[p.key] ?? 0);
                return (
                  <div key={p.key} className="flex justify-between gap-4 px-5 py-3">
                    <dt className="t-small text-soft">{p.left} / {p.right}</dt>
                    <dd className="shrink-0 font-medium">{v === -1 ? p.left : v === 1 ? p.right : "Either"}</dd>
                  </div>
                );
              })}
            </dl>
          </Section>

          <Section title="Situations" hint="Scored by the system against the answer key.">
            <p className="px-5 py-4">
              <span className="t-figure !text-[2.2rem]">{detail.scenario ? Math.round(Number(detail.scenario.pct)) : "–"}</span>
              <span className="t-small ml-2 text-soft">out of 100</span>
            </p>
          </Section>

          <ReferencesBlock appId={detail.id} references={detail.references} canClear={isPastor && !decided} trust={referees} />
        </div>

        <div className="flex flex-col gap-8">
          {detail.can_invite || (detail.status === "submitted" && detail.readiness) ? <InvitePanel detail={detail} /> : null}

          {scorecard ? <AiScorecard appId={detail.id} card={scorecard} /> : null}

          <RubricPanel
            appId={detail.id}
            stage="calling"
            title="Score the application"
            intro="Score the six questions from 1 to 5. Read the written answers first."
            rubric={CALLING_RUBRIC}
            mine={detail.mine.calling}
            others={detail.others.calling}
            locked={decided}
          />

          {interviewOpen || detail.mine.interview ? (
            <RubricPanel
              appId={detail.id}
              stage="interview"
              title="Score the interview"
              intro="Score each of the five questions from 1 to 5 after the conversation."
              rubric={INTERVIEW_RUBRIC}
              mine={detail.mine.interview}
              others={detail.others.interview}
              locked={decided}
            />
          ) : null}

          {detail.readiness ? <ReadinessCard readiness={detail.readiness} /> : null}
          {detail.can_decide ? <DecisionPanel detail={detail} /> : null}
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="t-heading">{title}</h2>
        {hint ? <p className="t-small text-soft">{hint}</p> : null}
      </div>
      <div className="card overflow-hidden">{children}</div>
    </section>
  );
}

function Answer({ label, text, sub }: { label: string; text: string; sub?: string }) {
  return (
    <div className="border-b border-line px-5 py-4 last:border-b-0">
      <h3 className="t-small font-semibold text-soft">{label}</h3>
      {sub ? <p className="t-small mt-0.5 text-soft">{sub}</p> : null}
      <p className="t-body mt-1.5 whitespace-pre-line break-words">{text || <span className="text-soft">Not answered</span>}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

function ReferencesBlock({ appId, references, canClear, trust }: { appId: string; references: ReferenceView[]; canClear: boolean; trust: ReviewReferee[] | null }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="t-heading">References</h2>
        <p className="t-small text-soft">Rated by the referee from 1 to 5. The applicant never sees these.</p>
      </div>
      <ul className="flex flex-col gap-3">
        {references.length === 0 ? <li className="card t-body p-5 text-soft">No referees named.</li> : null}
        {references.map((r) => {
          const t = trust?.find((x) => x.id === r.id) ?? null;
          return (
          <li key={r.id} className="card flex flex-col gap-3 p-5" data-testid={`reference-${r.slot}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.name}</p>
                <p className="t-small text-soft">
                  {r.relationship}
                  {r.head ? (t ? ", says pastor or unit head" : ", pastor or unit head") : ""} · {r.contact}
                </p>
              </div>
              <Badge tone={r.answered ? "gold" : "outline"}>{r.answered ? "Answered" : "Waiting"}</Badge>
            </div>
            {t ? <RefereeTrust appId={appId} trust={t} answered={r.answered} /> : null}
            {r.answered ? (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  {REFEREE_QUESTIONS.map((q) => (
                    <div key={q.id}>
                      <dt className="t-small text-soft">{q.title}</dt>
                      <dd className="text-lg font-bold tabular-nums">{r[q.id] ?? "–"}<span className="t-small font-normal text-soft"> / 5</span></dd>
                    </div>
                  ))}
                </dl>
                {r.concern ? (
                  <div className={cn("rounded-[var(--radius-control)] px-4 py-3", r.concern_cleared ? "bg-surface" : "bg-danger/10")}>
                    <p className={cn("t-small font-semibold", r.concern_cleared ? "text-soft" : "text-danger")}>
                      {r.concern_cleared ? "Concern, followed up by a pastor" : "Concern raised"}
                    </p>
                    <p className="t-body mt-1 whitespace-pre-line break-words">{r.concern_note}</p>
                    {r.concern_cleared && r.concern_cleared_note ? (
                      <p className="t-small mt-2 text-soft">Follow-up: {r.concern_cleared_note}</p>
                    ) : null}
                    {!r.concern_cleared && canClear ? <ClearConcern appId={appId} referenceId={r.id} /> : null}
                  </div>
                ) : (
                  <p className="t-small text-soft">No concern raised.</p>
                )}
              </>
            ) : null}
          </li>
          );
        })}
      </ul>
    </section>
  );
}

function ClearConcern({ appId, referenceId }: { appId: string; referenceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await clearConcernAction(appId, referenceId, note);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="quiet" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        I have followed this up
      </Button>
    );
  }
  return (
    <div className="pop-in mt-3 flex flex-col gap-3">
      <Textarea
        label="What did you do to follow it up?"
        name="clear-note"
        rows={3}
        maxLength={600}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        hint="At least a sentence. This stays on the record."
      />
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button size="sm" loading={busy} disabled={note.trim().length < 10} onClick={() => void save()}>
          Mark as followed up
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function RubricPanel({
  appId,
  stage,
  title,
  intro,
  rubric,
  mine,
  others,
  locked,
}: {
  appId: string;
  stage: "calling" | "interview";
  title: string;
  intro: string;
  rubric: readonly (RubricQuestion & { ask?: string })[];
  mine: { scores: Record<string, number>; notes: string | null } | null;
  others: { reviewer: string; pct: number; notes: string | null }[] | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number>>(mine?.scores ?? {});
  const [notes, setNotes] = useState(mine?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const complete = rubric.every((q) => scores[q.id] >= 1);
  const average = complete ? Math.round((rubric.reduce((s, q) => s + scores[q.id], 0) / rubric.length / 5) * 100) : null;

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await saveReviewAction(appId, stage, scores, notes);
    setBusy(false);
    if (!result.ok) return setMessage({ ok: false, text: result.message });
    setMessage({ ok: true, text: mine ? "Updated." : "Saved." });
    router.refresh();
  }

  return (
    <section aria-labelledby={`${stage}-heading`} className="flex flex-col gap-3">
      <div>
        <h2 id={`${stage}-heading`} className="t-heading">
          {title}
        </h2>
        <p className="t-small text-soft">{intro}</p>
      </div>
      <div className="card flex flex-col divide-y divide-line">
        {rubric.map((q, i) => (
          <fieldset key={q.id} disabled={locked} className="flex flex-col gap-3 p-5">
            <div>
              <legend className="font-semibold leading-snug">
                {q.ask ?? q.title}
              </legend>
              <p className="t-small text-soft">{q.ask ? q.title + ": " : ""}{q.looksAt}</p>
            </div>
            <ScaleInput
              name={`${stage}-${q.id}`}
              label={`${q.title}, from 1 to 5`}
              value={scores[q.id]}
              onChange={(n) => setScores((s) => ({ ...s, [q.id]: n }))}
              labels={SCORE_WORDS}
              ends="1 is not evident, 5 is strong"
            />
            <details className="t-small text-soft">
              <summary className="cursor-pointer font-medium text-ink">What 1, 3 and 5 look like</summary>
              <dl className="mt-2 flex flex-col gap-1.5">
                <div><dt className="inline font-semibold text-ink">1: </dt><dd className="inline">{q.low}</dd></div>
                <div><dt className="inline font-semibold text-ink">3: </dt><dd className="inline">{q.mid}</dd></div>
                <div><dt className="inline font-semibold text-ink">5: </dt><dd className="inline">{q.high}</dd></div>
              </dl>
            </details>
            <span className="sr-only">Question {i + 1} of {rubric.length}</span>
          </fieldset>
        ))}
        <div className="flex flex-col gap-4 p-5">
          <Textarea
            label="Notes for the panel"
            name={`${stage}-notes`}
            rows={3}
            maxLength={1000}
            optional
            disabled={locked}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            hint="Seen by other reviewers once they have scored. Never by the applicant."
          />
          {message ? (
            <p role={message.ok ? "status" : "alert"} className={cn("t-small", message.ok ? "text-success" : "text-danger")}>
              {message.text}
            </p>
          ) : null}
          {locked ? (
            <p className="t-small text-soft">A decision has been made, so scores can no longer change.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={busy} disabled={!complete} onClick={() => void save()}>
                {mine ? "Update my scores" : "Submit my scores"}
              </Button>
              {average !== null ? <span className="t-small text-soft">Your average: {average}%</span> : null}
            </div>
          )}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="t-small font-semibold">Other reviewers</h3>
        {others === null ? (
          <p className="t-small mt-1 text-soft">You will see your colleagues’ scores after you submit yours. This keeps each score independent.</p>
        ) : others.length === 0 ? (
          <p className="t-small mt-1 text-soft">No one else has scored this yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {others.map((o) => (
              <li key={o.reviewer} className="flex flex-col gap-0.5">
                <span className="flex justify-between gap-3">
                  <span className="font-medium">{o.reviewer}</span>
                  <span className="font-bold tabular-nums">{Math.round(Number(o.pct))}%</span>
                </span>
                {o.notes ? <span className="t-small whitespace-pre-line text-soft">{o.notes}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Invite, readiness, decision
// ---------------------------------------------------------------------------

function InvitePanel({ detail }: { detail: ReviewDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refsIn = detail.references.filter((r) => r.answered).length;
  const callingBy = detail.readiness?.calling_reviews ?? 0;
  // When the first check passed the application, its score stands in for the two reviewers' calling scores.
  const byFirstCheck = detail.readiness?.calling_source === "ai";
  const ready = refsIn >= 2 && (byFirstCheck || callingBy >= 2);

  async function invite() {
    setBusy(true);
    setError(null);
    const result = await inviteToInterviewAction(detail.id);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  const checks = [
    { ok: refsIn >= 2, text: `Both references in (${refsIn} of 2)` },
    byFirstCheck
      ? { ok: true, text: "The first check has scored it" }
      : { ok: callingBy >= 2, text: `Two reviewers have scored (${callingBy} of 2)` },
  ];

  return (
    <section aria-labelledby="invite-heading" className="card flex flex-col gap-4 p-5">
      <div>
        <h2 id="invite-heading" className="t-heading">
          Invite to interview
        </h2>
        <p className="t-small text-soft">Once invited, the applicant picks a time from the open slots.</p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {checks.map((c) => (
          <li key={c.text} className="t-small flex items-center gap-2">
            <span aria-hidden="true" className={cn("grid h-5 w-5 place-items-center rounded-full text-[0.7rem] font-bold", c.ok ? "bg-gold text-on-flame" : "bg-surface-strong text-soft")}>
              {c.ok ? "✓" : ""}
            </span>
            <span className={c.ok ? "" : "text-soft"}>
              {c.text}
              <span className="sr-only">{c.ok ? " (done)" : " (not yet)"}</span>
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button loading={busy} disabled={!ready || !detail.can_invite} onClick={() => void invite()}>
          Invite to interview
        </Button>
      </div>
    </section>
  );
}

function Bar({ label, weight, value, note }: { label: string; weight: number; value: number | null; note?: string }) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[0.92rem]">
        <span>
          {label} <span className="t-small text-soft">{weight}%</span>
        </span>
        <span className="font-semibold tabular-nums">{value === null ? "waiting" : Math.round(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-strong">
        <div className="draw-line h-full rounded-full" style={{ width: `${value ?? 0}%`, background: "linear-gradient(90deg, var(--crest-gold), var(--crest-flame))" }} />
      </div>
      {note ? <p className="t-small text-soft">{note}</p> : null}
    </li>
  );
}

function ReadinessCard({ readiness: r }: { readiness: Readiness }) {
  const band = r.band === "leader" ? "Leader range" : r.band === "assistant_leader" ? "Assistant leader range" : r.band === "below" ? "Below the line" : null;
  const gates = [
    { ok: r.gates.goal_declared, text: "Season Goal declared" },
    {
      ok: r.gates.references_clean,
      text: r.gates.open_concerns > 0 ? `Reference check: ${r.gates.open_concerns} open ${r.gates.open_concerns === 1 ? "concern" : "concerns"}` : "Reference check clean: both answered, one a pastor or unit head",
    },
  ];
  return (
    <section aria-labelledby="readiness-heading" className="card flex flex-col gap-5 p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="readiness-heading" className="t-heading">
            Leader Readiness Score
          </h2>
          <p className="t-small text-soft">75 or more for a leader, 60 to 74 for an assistant leader.</p>
        </div>
        <div className="text-right">
          <p className="t-figure !text-[clamp(2.4rem,10vw,3.4rem)]">{r.readiness === null ? "–" : Math.round(Number(r.readiness) * 10) / 10}</p>
          {band ? <p className="t-small font-semibold">{band}</p> : null}
        </div>
      </div>
      <ul className="flex flex-col gap-4">
        <Bar
          label="Calling and goal fit"
          weight={30}
          value={r.calling}
          note={r.calling_source === "ai" ? `From the first check${r.calling_reviews > 0 ? `, ${r.calling_reviews} ${r.calling_reviews === 1 ? "reviewer" : "reviewers"} also scored` : ""}` : `${r.calling_reviews} of 2 reviewers`}
        />
        <Bar label="Situations" weight={25} value={r.scenarios} />
        <Bar label="References" weight={25} value={r.references} note={`${r.references_received} of 2 answered`} />
        <Bar label="Interview" weight={20} value={r.interview} note={`${r.interview_reviews} of 2 panelists`} />
      </ul>
      <ul className="flex flex-col gap-2 border-t border-line pt-4">
        {gates.map((g) => (
          <li key={g.text} className="t-small flex items-start gap-2">
            <span aria-hidden="true" className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold", g.ok ? "bg-gold text-on-flame" : "bg-danger/15 text-danger")}>
              {g.ok ? "✓" : "!"}
            </span>
            <span>
              {g.text}
              <span className="sr-only">{g.ok ? " (met)" : " (not met)"}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Decision = "leader" | "assistant_leader" | "not_approved";

function DecisionPanel({ detail }: { detail: ReviewDetail }) {
  const router = useRouter();
  const r = detail.readiness;
  const [choice, setChoice] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const interviewed = detail.status === "interviewed";
  const score = r?.readiness ?? null;
  const why = (need: number): string | null => {
    if (!interviewed) return "Available once the interview is scored.";
    if (score === null) return "Waiting for all the scores.";
    if (!r?.gates.goal_declared) return "No Season Goal declared.";
    if (!r?.gates.references_clean) return "The reference check is not clean.";
    if (Number(score) < need) return `Readiness is ${Math.round(Number(score) * 10) / 10}, below ${need}.`;
    return null;
  };
  const leaderWhy = why(75);
  const assistantWhy = why(60);

  const options: { id: Decision; title: string; description: string; blocked: string | null }[] = [
    { id: "leader", title: "Approve as a leader", description: "Gives them the leader role now.", blocked: leaderWhy },
    { id: "assistant_leader", title: "Approve as an assistant leader", description: "Gives them the assistant leader role now.", blocked: assistantWhy },
    { id: "not_approved", title: "Not approved this time", description: "Closes the application with a kind note.", blocked: null },
  ];

  async function record() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    const result = await decideAction(detail.id, choice, note);
    setBusy(false);
    if (!result.ok) {
      setConfirming(false);
      return setError(result.message);
    }
    router.refresh();
  }

  return (
    <section aria-labelledby="decide-heading" className="card flex flex-col gap-4 p-5">
      <div>
        <h2 id="decide-heading" className="t-heading">
          Decision
        </h2>
        <p className="t-small text-soft">Only a pastor decides. The score guides you. It does not decide for you.</p>
      </div>
      <div role="radiogroup" aria-label="Decision" className="flex flex-col gap-3">
        {options.map((o) => (
          <Choice
            key={o.id}
            name="decision"
            value={o.id}
            checked={choice === o.id}
            disabled={o.blocked !== null}
            onChange={() => {
              setChoice(o.id);
              setConfirming(false);
            }}
            title={o.title}
            description={o.blocked ?? o.description}
          />
        ))}
      </div>
      <Textarea
        label="A short note the applicant will read"
        name="decision-note"
        rows={3}
        maxLength={600}
        optional
        value={note}
        onChange={(e) => setNote(e.target.value)}
        hint="Kind and specific. Whatever the outcome, they are being thanked."
      />
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      {confirming && choice ? (
        <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4">
          <p className="font-semibold">
            {choice === "not_approved" ? `Close ${detail.applicant}’s application?` : `Approve ${detail.applicant} as ${choice === "leader" ? "a leader" : "an assistant leader"}?`}
          </p>
          <p className="t-small text-soft">This is recorded with your name and cannot be undone here.</p>
          <div className="flex gap-3">
            <Button variant="solid" loading={busy} onClick={() => void record()}>
              Yes, record it
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button disabled={!choice} onClick={() => setConfirming(true)}>
            Record decision
          </Button>
        </div>
      )}
    </section>
  );
}
