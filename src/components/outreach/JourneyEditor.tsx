"use client";

import { useMemo, useState } from "react";
import { approveEmailAction, discardEmailAction, editEmailAction, emailHistoryAction, setDaysAction } from "@/app/(app)/admin/reminders/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { ALL_FIELDS, ASKS, JOURNEY_FIELDS, TONES } from "@/lib/outreach/labels";
import { reminderPreview } from "@/lib/outreach/templates";
import { wordingProblem } from "@/lib/outreach/compose";
import type { JourneyEmail, JourneyOverview, VersionRow } from "@/lib/outreach/types";
import { keep } from "./useAction";
import { EmailFrame } from "./EmailFrame";

const field = "h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none";
const area = "min-h-[6rem] w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 py-3 text-base leading-relaxed focus:border-ink focus:outline-none";
const FIELD_NOTES: Record<string, string> = {
  first_name: "their first name", tribe: "their tribe", tribe_1: "their best match", leader_first: "their leader’s first name", seats_left: "seats left",
  season_starts: "when the season starts", joining_closes: "when joining closes", meets: "when and where the tribe meets", next_meeting: "the next gathering",
  erase_date: "when their draft is cleared", parts_left: "how many parts are left", minutes_left: "how many minutes are left", close_line: "the closing date sentence", my_page: "their home page",
};

function EmailCard({
  j, e, site, church, canEdit, canApprove, day,
}: {
  j: JourneyOverview; e: JourneyEmail; site: string; church: { name: string; address: string }; canEdit: boolean; canApprove: boolean; day: number;
}) {
  const d = useDo();
  const [editing, setEditing] = useState(false);
  const base = e.pending ?? e;
  const [subject, setSubject] = useState(base.subject);
  const [paragraphs, setParagraphs] = useState<string[]>(base.paragraphs);
  const [button, setButton] = useState(base.button_label ?? "");
  const [history, setHistory] = useState<VersionRow[] | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const tone = TONES[e.tone] ?? { label: e.tone, hint: "" };

  const live = useMemo(
    () => reminderPreview({ journey: j.key, step: e.step, tone: e.tone, subject: editing ? subject : e.subject, paragraphs: editing ? paragraphs : e.paragraphs, button_label: (editing ? button : e.button_label) || null, actions: e.actions }, site, church),
    [j.key, e, editing, subject, paragraphs, button, site, church],
  );
  const problems = [subject, ...paragraphs, button].map((t) => wordingProblem(t, ALL_FIELDS)).filter((p): p is string => Boolean(p));
  const pendingSpec = useMemo(
    () => (e.pending ? reminderPreview({ journey: j.key, step: e.step, tone: e.tone, subject: e.pending.subject, paragraphs: e.pending.paragraphs, button_label: e.pending.button_label, actions: e.actions }, site, church) : null),
    [e.pending, e.step, e.tone, e.actions, j.key, site, church],
  );

  return (
    <li className="card flex flex-col gap-5 p-5" data-testid={`email-${j.key}-${e.step}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="t-small font-semibold uppercase tracking-wide text-soft">
            Email {e.step} · day {day}
          </p>
          <h3 className="t-heading">{tone.label}</h3>
          <p className="t-small text-soft">{tone.hint}</p>
        </div>
        <dl className="flex gap-5">
          <div>
            <dt className="t-small text-soft">Sent</dt>
            <dd className="font-semibold tabular-nums">{e.sent.toLocaleString("en")}</dd>
          </div>
          <div>
            <dt className="t-small text-soft">Acted within a week</dt>
            <dd className="font-semibold tabular-nums">{e.acted_7d.toLocaleString("en")}</dd>
          </div>
          <div>
            <dt className="t-small text-soft">Stopped emails</dt>
            <dd className="font-semibold tabular-nums">{e.unsub.toLocaleString("en")}</dd>
          </div>
        </dl>
      </header>

      {e.pending ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/25 p-4" data-testid="pending">
          <p className="font-semibold">New wording is waiting for a pastor</p>
          <p className="t-small">
            {e.pending.edited_by_name ?? "Someone"} proposed a change. The email people get stays as it is until a pastor approves.
          </p>
          {pendingSpec ? <EmailFrame spec={pendingSpec} label="Proposed wording" /> : null}
          {canApprove ? (
            <div className="flex flex-wrap gap-3">
              <Button size="md" loading={d.busy === "ok"} onClick={() => void d.go("ok", () => approveEmailAction(e.id, j.key), { saved: "Approved. The next email uses these words." })}>
                Approve these words
              </Button>
              <Button variant="quiet" size="md" loading={d.busy === "no"} onClick={() => void d.go("no", () => discardEmailAction(e.id, j.key), { saved: "Discarded. The current words stay." })}>
                Discard
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium">Subject</span>
            <input className={field} value={subject} maxLength={160} onChange={(ev) => setSubject(ev.target.value)} />
          </label>
          {paragraphs.map((p, i) => (
            <label key={i} className="flex flex-col gap-1">
              <span className="t-small font-medium">Paragraph {i + 1}</span>
              <textarea className={area} value={p} maxLength={1200} onChange={(ev) => setParagraphs(paragraphs.map((x, k) => (k === i ? ev.target.value : x)))} />
            </label>
          ))}
          {e.actions.length === 0 && base.button_label !== null ? (
            <label className="flex flex-col gap-1">
              <span className="t-small font-medium">Button words</span>
              <input className={field} value={button} maxLength={40} onChange={(ev) => setButton(ev.target.value)} />
            </label>
          ) : base.button_label !== null ? (
            <label className="flex flex-col gap-1">
              <span className="t-small font-medium">Button words</span>
              <input className={field} value={button} maxLength={40} onChange={(ev) => setButton(ev.target.value)} />
            </label>
          ) : null}
          <details className="t-small">
            <summary className="cursor-pointer font-medium">Name fields you can use</summary>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {[...JOURNEY_FIELDS, "tribe", "first_name", "season_starts", "my_page"].map((f) => (
                <li key={f}>
                  <code>{`{${f}}`}</code> <span className="text-soft">{FIELD_NOTES[f]}</span>
                </li>
              ))}
            </ul>
          </details>
          {problems.length > 0 ? (
            <ul role="alert" className="flex flex-col gap-1 rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
              {[...new Set(problems)].map((p) => (
                <li key={p} className="t-small">
                  {p}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="t-small text-soft">
            {canApprove ? "As a pastor, your change goes live at once and is kept in the history." : "A pastor reads your change before it goes live. Until then, the current words are used."}
          </p>
          <Notice error={d.error} saved={d.saved} />
          <div className="flex flex-wrap gap-3">
            <Button
              size="md"
              disabled={problems.length > 0 || subject.trim().length < 3}
              loading={d.busy === "save"}
              onClick={() =>
                void d.go(
                  "save",
                  keep(() => editEmailAction(e.id, subject, paragraphs.map((p) => p.trim()).filter(Boolean), button.trim() || null, j.key), (r) => setOutcome(r)),
                  { saved: undefined, after: () => setEditing(false) },
                )
              }
            >
              {canApprove ? "Save and use these words" : "Send to a pastor"}
            </Button>
            <Button variant="ghost" size="md" onClick={() => { setEditing(false); setSubject(base.subject); setParagraphs(base.paragraphs); setButton(base.button_label ?? ""); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {outcome ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-gold/20 px-4 py-3 t-small">
          {outcome === "live" ? "Saved, and live now. The next email uses these words." : "Sent to a pastor. The current words stay until they approve."}
        </p>
      ) : null}

      <EmailFrame spec={live} label={`Email ${e.step}, ${tone.label}`} />
      {e.actions.length > 0 ? (
        <p className="t-small text-soft">
          Ends with: {e.actions.map((a) => ASKS[a]?.label).filter(Boolean).join(", ")}. Each is confirmed on a page before it counts.
        </p>
      ) : null}

      {!editing ? (
        <div className="flex flex-wrap items-center gap-3">
          {canEdit ? (
            <Button variant="quiet" size="md" onClick={() => setEditing(true)}>
              Edit the words
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="md"
            loading={d.busy === "history"}
            onClick={() => void d.go("history", keep(() => emailHistoryAction(e.id), setHistory))}
          >
            History
          </Button>
          <span className="t-small text-soft">
            Version {e.version}
            {e.approved_by ? ` · approved by ${e.approved_by}` : ""}
          </span>
        </div>
      ) : null}
      {history ? (
        <ul className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-surface p-4" aria-label="History">
          {history.map((h) => (
            <li key={h.version} className="t-small">
              <strong>v{h.version}</strong> · {new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {h.edited_by ?? "the team"}
              {h.approved_by ? `, approved by ${h.approved_by}` : ""}
              <br />
              <span className="text-soft">{h.subject}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!editing ? <Notice error={d.error} saved={d.saved} /> : null}
    </li>
  );
}

function Timing({ j, canChange }: { j: JourneyOverview; canChange: boolean }) {
  const d = useDo();
  const [days, setDays] = useState(j.day_offsets.map(String));
  const nums = days.map(Number);
  const ok = nums.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 90 && (i === 0 || n > nums[i - 1]));
  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="timing-heading">
      <h2 id="timing-heading" className="t-heading">
        When the four emails go
      </h2>
      <p className="t-small text-soft">Days after the person went quiet. Each is counted again from today, so someone who comes back and stops again starts fresh.</p>
      <div className="grid grid-cols-4 gap-3">
        {days.map((v, i) => (
          <label key={i} className="flex flex-col gap-1">
            <span className="t-small text-soft">Email {i + 1}</span>
            <input className={field} inputMode="numeric" value={v} disabled={!canChange} onChange={(ev) => setDays(days.map((x, k) => (k === i ? ev.target.value.replace(/\D/g, "").slice(0, 2) : x)))} aria-label={`Day for email ${i + 1}`} />
          </label>
        ))}
      </div>
      {!ok ? <p className="t-small text-danger">Each day must be later than the one before, within 90 days.</p> : null}
      <Notice error={d.error} saved={d.saved} />
      {canChange ? (
        <div>
          <Button size="md" disabled={!ok} loading={d.busy === "days"} onClick={() => void d.go("days", () => setDaysAction(j.key, nums), { saved: "Saved. People already part-way keep their place." })}>
            Save the days
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function JourneyEditor({ j, site, church, canChange, canEdit, canApprove }: { j: JourneyOverview; site: string; church: { name: string; address: string }; canChange: boolean; canEdit: boolean; canApprove: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      <Timing j={j} canChange={canChange} />
      <ol className="flex flex-col gap-6">
        {j.emails.map((e) => (
          <EmailCard key={e.id} j={j} e={e} site={site} church={church} canEdit={canEdit} canApprove={canApprove} day={j.day_offsets[e.step - 1]} />
        ))}
      </ol>
    </div>
  );
}
