"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearFirstCheckAction, sendBackAction } from "@/app/(app)/review/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { CALLING_RUBRIC } from "@/lib/leaders/options";
import { FIELD_INFO, FLAG_LABEL, WRITTEN_FIELDS, isWrittenField, type Flag, type WrittenField } from "@/lib/leaders/quality/fields";
import { MODE_LABEL, ORIGIN_LABEL, OUTCOME_LABEL, STATE_LABEL, STATE_SHORT } from "@/lib/leaders/quality/wording";
import type { Scorecard } from "@/lib/leaders/review-types";
import { formatShortDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

const fieldLabel = (f: string) => (isWrittenField(f) ? FIELD_INFO[f].label : f);
const flagLabel = (f: string) => FLAG_LABEL[f as Flag] ?? f;

/**
 * The first check's reading on the review page: six scores, each with the applicant's own words that justify it,
 * the flags, and what a pastor can do about an application the check held. It is a first reading, never a verdict.
 * A coach sees it only after scoring (the database decides), so it cannot steer a score that is not formed yet.
 */
export function AiScorecard({ appId, card }: { appId: string; card: Scorecard }) {
  const run = card.run;
  if (card.mode === "off" && !run) return null;
  if (card.state === "not_applicable" && !run) return null;

  const tone = card.state === "held" ? "flame" : card.state === "clear" || card.state === "cleared_by_person" ? "gold" : "outline";

  return (
    <section aria-labelledby="first-check-heading" className="flex flex-col gap-3" data-testid="ai-scorecard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="first-check-heading" className="t-heading">
            First check
          </h2>
          <p className="t-small text-soft">A first reading to save your time. It can be wrong. Read the answers yourself.</p>
        </div>
        <Badge tone={tone}>{STATE_SHORT[card.state] ?? STATE_LABEL[card.state] ?? card.state}</Badge>
      </div>

      <div className="card flex flex-col gap-5 p-5">
        <p className="t-small text-soft" data-testid="first-check-state">
          {STATE_LABEL[card.state] ?? card.state}
          {card.mode !== "on" ? ` · Switch: ${MODE_LABEL[card.mode]}` : ""}
          {card.rewrites_used > 0 ? ` · Updated by the applicant ${card.rewrites_used} ${card.rewrites_used === 1 ? "time" : "times"}` : ""}
          {card.asked_person ? " · The applicant asked for a person to read it" : ""}
        </p>

        {!card.visible ? (
          <p className="t-body text-soft">The reading appears here once you have scored the application yourself, so it cannot steer your score.</p>
        ) : run ? (
          <Reading card={card} />
        ) : (
          <p className="t-body text-soft">No reading yet.</p>
        )}

        {card.visible && card.basis === "ai" && card.state === "clear" ? (
          <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3">
            The first check passed this application, so its score stands in for the first calling score at the same 30% weight.
            {card.audit_sample ? " This one is picked for an audit: please score it yourself as well, so the check can be compared with a person." : ""}
          </p>
        ) : null}

        {card.visible ? <History card={card} /> : null}

        {card.can_clear || card.can_send_back ? (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            {card.can_clear ? <ClearForm appId={appId} /> : null}
            {card.can_send_back ? <SendBackForm appId={appId} /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Reading({ card }: { card: Scorecard }) {
  const run = card.run!;
  const reasons = (run.reasons ?? {}) as Record<string, unknown>;
  const dropped = typeof reasons.dropped_quotes === "number" ? reasons.dropped_quotes : 0;
  return (
    <div className="flex flex-col gap-5">
      {run.shadow ? (
        <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3">Recorded only. The applicant was not told and nobody was held up.</p>
      ) : null}

      {run.scores ? (
        <ul className="flex flex-col gap-4">
          {CALLING_RUBRIC.map((q) => {
            const score = run.scores?.[q.id];
            const quotes = run.evidence?.[q.id] ?? [];
            const why = typeof reasons[q.id] === "string" ? (reasons[q.id] as string) : "";
            return (
              <li key={q.id} className="flex flex-col gap-1.5" data-testid={`ai-${q.id}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{q.title}</span>
                  <span className="font-bold tabular-nums">{score ?? "–"}<span className="t-small font-normal text-soft"> / 5</span></span>
                </div>
                {why ? <p className="t-small text-soft">{why}</p> : null}
                {quotes.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {quotes.map((e, i) => (
                      <li key={i} className="border-l-2 border-gold pl-3">
                        <p className="t-small italic">“{e.quote}”</p>
                        <p className="t-small text-soft">{fieldLabel(e.field)}</p>
                      </li>
                    ))}
                  </ul>
                ) : (score ?? 0) >= 3 && q.id !== "q6" ? (
                  <p className="t-small text-danger">No words from the answer back this score.</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="t-body text-soft">
          The AI was not asked to score this one: the plain checks stopped it first, or the applicant has not agreed to the wording that allows it.
        </p>
      )}

      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Overall" value={run.calling_pct === null ? "–" : `${Math.round(Number(run.calling_pct))}%`} />
        <Stat label="Confidence" value={run.confidence === null ? "–" : `${Math.round(Number(run.confidence) * 100)}%`} />
        <Stat label="Result" value={OUTCOME_LABEL[run.outcome] ?? run.outcome} small />
      </dl>

      {run.flags.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="ai-flags">
          <h3 className="t-small font-semibold text-soft">Worth a look</h3>
          <ul className="flex flex-wrap gap-2">
            {run.flags.map((f) => (
              <li key={f}>
                <Badge tone="flame">{flagLabel(f)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {dropped > 0 ? <p className="t-small text-soft">{dropped === 1 ? "One quote was" : `${dropped} quotes were`} left out because the words are not in the applicant’s answer.</p> : null}

      {(card.forced_fields ?? []).length > 0 ? (
        <p className="t-small">
          <span className="font-semibold">Let through after several tries: </span>
          {(card.forced_fields ?? []).map(fieldLabel).join(", ")}. Read these closely.
        </p>
      ) : null}

      {(card.duplicates ?? []).length > 0 ? (
        <p className="t-small" data-testid="ai-duplicates">
          <span className="font-semibold">Same words as: </span>
          {(card.duplicates ?? []).map((d, i) => (
            <span key={d.id}>
              {i > 0 ? ", " : ""}
              <Link href={`/review/${d.id}`} className="font-semibold text-accent underline underline-offset-4">
                {d.applicant}
              </Link>
            </span>
          ))}
        </p>
      ) : null}

      <p className="t-small text-soft">
        {ORIGIN_LABEL[run.origin] ?? run.origin} · Run {run.run} · {run.model && run.model !== "none" ? run.model : "no AI call"} · {formatShortDate(run.at)}
      </p>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-[var(--radius-control)] bg-surface px-3 py-2.5">
      <dt className="t-small text-soft">{label}</dt>
      <dd className={cn("font-bold", small ? "text-[0.95rem] leading-snug" : "text-xl tabular-nums")}>{value}</dd>
    </div>
  );
}

function History({ card }: { card: Scorecard }) {
  const versions = card.versions ?? [];
  const runs = card.runs ?? [];
  if (versions.length === 0 && runs.length <= 1) return null;
  return (
    <div className="flex flex-col gap-2">
      {versions.length > 0 ? (
        <details className="t-small">
          <summary className="cursor-pointer font-medium">Earlier versions of their answers ({versions.length})</summary>
          <ul className="mt-2 flex flex-col gap-3">
            {WRITTEN_FIELDS.flatMap((f) =>
              versions
                .filter((v) => v.field === f)
                .map((v) => (
                  <li key={`${f}-${v.round}`} className="rounded-[var(--radius-control)] bg-surface px-3 py-2.5">
                    <p className="font-semibold">{fieldLabel(f)} · before update {v.round + 1}</p>
                    <p className="mt-1 whitespace-pre-line break-words text-soft">{v.body || "Empty"}</p>
                  </li>
                )),
            )}
          </ul>
        </details>
      ) : null}
      {runs.length > 1 ? (
        <details className="t-small">
          <summary className="cursor-pointer font-medium">Every reading ({runs.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {runs.map((r) => (
              <li key={r.run} className="flex justify-between gap-3">
                <span>
                  Run {r.run} · {ORIGIN_LABEL[r.origin] ?? r.origin}
                  {r.shadow ? " (recording only)" : ""}
                </span>
                <span className="text-soft">
                  {r.calling_pct === null ? "no score" : `${Math.round(Number(r.calling_pct))}%`} · {OUTCOME_LABEL[r.outcome] ?? r.outcome}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ClearForm({ appId }: { appId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await clearFirstCheckAction(appId, note);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  if (!open) {
    return (
      <div>
        <Button variant="quiet" size="md" onClick={() => setOpen(true)}>
          I have read it. Let it through
        </Button>
      </div>
    );
  }
  return (
    <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4">
      <p className="font-semibold">Let this application through the first check?</p>
      <p className="t-small text-soft">Reviewers then score it as usual. This is recorded with your name.</p>
      <Textarea label="Why (optional)" name="clear-first-note" rows={2} maxLength={500} optional value={note} onChange={(e) => setNote(e.target.value)} />
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button variant="solid" size="md" loading={busy} onClick={() => void save()}>
          Yes, let it through
        </Button>
        <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
          Not yet
        </Button>
      </div>
    </div>
  );
}

function SendBackForm({ appId }: { appId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<WrittenField[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const result = await sendBackAction(appId, picked, note);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  if (!open) {
    return (
      <div>
        <Button variant="ghost" size="md" onClick={() => setOpen(true)}>
          Ask them to add to an answer
        </Button>
      </div>
    );
  }
  return (
    <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4">
      <p className="font-semibold">Ask the applicant to add to an answer</p>
      <p className="t-small text-soft">They see only the words you write below, never the first check’s reading. They get one more chance to update.</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Which answers</legend>
        {WRITTEN_FIELDS.map((f) => (
          <label key={f} className="flex items-center gap-3 text-[0.95rem]">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={picked.includes(f)}
              onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f] : p.filter((x) => x !== f)))}
            />
            {FIELD_INFO[f].label}
          </label>
        ))}
      </fieldset>
      <Textarea
        label="What would you like them to add?"
        name="send-back-note"
        rows={3}
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        hint="Kind and specific, in a sentence or two."
      />
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button size="md" loading={busy} disabled={picked.length === 0 || note.trim().length < 10} onClick={() => void send()}>
          Send it back
        </Button>
        <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
