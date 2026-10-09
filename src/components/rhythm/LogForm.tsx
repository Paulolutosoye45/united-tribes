"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveLogAction } from "@/app/(app)/rhythm/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import type { Attendance, CircleWeek } from "@/lib/rhythm/types";
import { ATTENDANCE_LABELS, OUTCOME_LABELS, percent } from "@/lib/rhythm/wording";

const CHOICES: Attendance[] = ["present", "absent", "excused"];

/** The two-minute log: did we meet, who came, one line about the week. */
export function LogForm({ week }: { week: CircleWeek }) {
  const router = useRouter();
  const office = week.log_open && !week.can_edit;
  const [held, setHeld] = useState<boolean>(week.log?.held ?? true);
  const [marks, setMarks] = useState<Record<string, Attendance>>(() =>
    Object.fromEntries(week.members.map((m) => [m.person_id, m.attendance ?? "present"])),
  );
  const [highlight, setHighlight] = useState(week.log?.highlight ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const r = week.report;
  const count = Object.values(marks).filter((v) => v === "present").length;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await saveLogAction(
      week.circle.id,
      week.week,
      held,
      highlight,
      week.members.map((m) => ({ person: m.person_id, status: marks[m.person_id] ?? "present" })),
    );
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSaved(true);
    router.refresh();
  }

  return (
    <section id="log" aria-labelledby="log-heading" className="card flex scroll-mt-24 flex-col gap-5 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="log-heading" className="t-heading">
            {week.log ? "Your log for this week" : "Log this week’s meeting"}
          </h2>
          <p className="t-small text-soft">Two minutes. Who came, and one line about the week.</p>
        </div>
        {week.log ? <Badge tone="gold">Logged</Badge> : null}
      </div>

      {!week.log_open ? (
        <p className="t-body text-soft">
          {week.week > (week.current_week ?? week.weeks)
            ? "This week has not started yet. You can log it once it has."
            : week.log
              ? "This week is closed. Ask a pastor if something needs correcting."
              : "This week is closed, and no meeting was logged. Ask a pastor if you need it recorded."}
        </p>
      ) : null}

      {week.log_open ? (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {office ? <p className="t-small rounded-[var(--radius-control)] bg-surface-strong p-3 text-soft">You are correcting this log as a pastor or director.</p> : null}
          <div role="radiogroup" aria-label="Did the Tribe meet?" className="segmented">
            <label>
              <input type="radio" name="held" checked={held} onChange={() => setHeld(true)} className="sr-only" />
              We met
            </label>
            <label>
              <input type="radio" name="held" checked={!held} onChange={() => setHeld(false)} className="sr-only" />
              We did not meet
            </label>
          </div>

          {held ? (
            <fieldset className="flex flex-col gap-2.5">
              <legend className="t-small mb-1 text-soft">{count} of {week.members.length} here</legend>
              <ul className="flex flex-col gap-2.5">
                {week.members.map((m) => (
                  <li key={m.person_id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold leading-snug">{m.name}</p>
                      <p className="t-small text-soft">
                        {m.step && m.step !== "none" ? `Step: ${m.step === "set" ? "chosen" : OUTCOME_LABELS[m.step].toLowerCase()}` : "No step chosen"}
                        {m.open_follow_up ? " · needs a call" : ""}
                      </p>
                    </div>
                    <div role="radiogroup" aria-label={`${m.name} this week`} className="grid shrink-0 grid-cols-3 gap-1.5">
                      {CHOICES.map((c) => (
                        <label
                          key={c}
                          className={cn(
                            "press grid h-11 min-w-[4.5rem] cursor-pointer place-items-center rounded-xl border-[1.5px] px-2 text-[0.9rem] font-medium transition-[background-color,border-color] duration-200",
                            marks[m.person_id] === c
                              ? c === "present"
                                ? "border-ink bg-gold font-semibold"
                                : "border-ink bg-surface-strong font-semibold"
                              : "border-line bg-raised text-soft hover:border-soft",
                          )}
                        >
                          <input
                            type="radio"
                            name={`att-${m.person_id}`}
                            value={c}
                            checked={marks[m.person_id] === c}
                            onChange={() => setMarks({ ...marks, [m.person_id]: c })}
                            className="sr-only"
                          />
                          {ATTENDANCE_LABELS[c]}
                        </label>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : (
            <p className="t-body text-soft">No attendance is counted for a week the Tribe did not meet. A line below helps your coach understand what happened.</p>
          )}

          <Textarea
            label={held ? "One highlight from the meeting" : "What happened?"}
            name="highlight"
            optional
            rows={3}
            maxLength={300}
            value={highlight}
            onChange={(e) => setHighlight(e.target.value)}
            hint="Your coach and the pastorate can read this. Leave out private details."
            className="!min-h-24"
          />
          {error ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="md" loading={busy} disabled={week.members.length === 0 && held}>
              {week.log ? "Save changes" : "Save the log"}
            </Button>
            {saved ? (
              <p role="status" className="t-small text-soft">
                Saved. Thank you.
              </p>
            ) : null}
            {week.members.length === 0 ? <p className="t-small text-soft">No one has joined yet, so there is nobody to mark.</p> : null}
          </div>
        </form>
      ) : null}

      {week.log ? (
        <dl className="grid grid-cols-2 gap-3 border-t border-line pt-5 sm:grid-cols-4">
          <div>
            <dt className="t-small text-soft">Met</dt>
            <dd className="font-semibold">{r.held ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="t-small text-soft">Here</dt>
            <dd className="font-semibold">{r.held ? `${r.present} of ${r.members} (${percent(r.attendance_rate)})` : "–"}</dd>
          </div>
          <div>
            <dt className="t-small text-soft">Steps done</dt>
            <dd className="font-semibold">{r.steps_done + r.steps_partly} of {r.members}</dd>
          </div>
          <div>
            <dt className="t-small text-soft">To call</dt>
            <dd className="font-semibold">{r.follow_ups_open}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
