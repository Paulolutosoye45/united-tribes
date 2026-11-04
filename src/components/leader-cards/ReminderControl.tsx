"use client";

import { useState } from "react";
import { remindersAction } from "@/app/(app)/admin/people/leader-cards/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { DAY_NAMES, dayWords, hourWords, type ReminderMode, type Reminders } from "@/lib/leader-cards/cards";

const field = "h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none";
const MODES: { key: ReminderMode; name: string; line: string }[] = [
  { key: "off", name: "Off", line: "Nothing is sent." },
  { key: "rehearsal", name: "Rehearsal", line: "Writes down who it would have written to. Sends nothing." },
  { key: "on", name: "On", line: "Sends one kind email a day to each leader whose card is still open." },
];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] as const;

/** The Thursday, Friday and Saturday reminders: Off, Rehearsal or On, the days, the hour and why. Starts Off. */
export function ReminderControl({ reminders }: { reminders: Reminders }) {
  const d = useDo();
  const act = reminders.role === "act";
  const [mode, setMode] = useState<ReminderMode>(reminders.mode);
  const [days, setDays] = useState<number[]>(reminders.days);
  const [hour, setHour] = useState(reminders.startHour);
  const [reason, setReason] = useState("");
  const changed = mode !== reminders.mode || hour !== reminders.startHour || days.join() !== reminders.days.join();
  const toggle = (day: number) => setDays((cur) => (cur.includes(day) ? cur.filter((x) => x !== day) : [...cur, day].sort((a, b) => a - b)));

  return (
    <section aria-labelledby="lc-rem" className="card flex flex-col gap-4 p-4 sm:p-5" data-testid="lc-reminders">
      <div className="flex flex-col gap-1">
        <h2 id="lc-rem" className="t-heading">
          Reminders
        </h2>
        <p className="t-small max-w-[64ch] text-soft" data-testid="lc-reminders-line">
          {reminders.mode === "off"
            ? "Off. No leader is reminded until you move this."
            : `${reminders.mode === "on" ? "On" : "Rehearsal"}: ${dayWords(reminders.days)} from ${hourWords(reminders.startHour)}, to each leader whose card is still open. One email a day, ${reminders.maxTotal} at most, and none once their card is sent in.`}
          {reminders.paused ? " The Master pause is on, so nothing is sent whatever this says." : ""}
        </p>
        <p className="t-small text-soft" data-testid="lc-reminders-week">
          This week: {reminders.week.sent} sent, {reminders.week.wouldSend} it would have sent in rehearsal, {reminders.week.resent} sent again by hand.
        </p>
      </div>

      {act ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void d.go("rem", () => remindersAction(mode, days, hour, reason), { saved: `Reminders are ${MODES.find((m) => m.key === mode)?.name}.`, after: () => setReason("") });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Reminders">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={mode === m.key}
                onClick={() => setMode(m.key)}
                data-testid={`lc-mode-${m.key}`}
                className={`flex flex-col gap-1 rounded-[var(--radius-control)] border-[1.5px] p-3 text-left ${mode === m.key ? "border-ink bg-surface-strong" : "border-line bg-raised"}`}
              >
                <span className="font-semibold">{m.name}</span>
                <span className="t-small text-soft">{m.line}</span>
              </button>
            ))}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[0.95rem] font-medium">Days (one to four)</legend>
            <div className="flex flex-wrap gap-2">
              {DAY_ORDER.map((day) => (
                <label key={day} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border-[1.5px] px-3 ${days.includes(day) ? "border-ink bg-surface-strong" : "border-line bg-raised"}`}>
                  <input type="checkbox" checked={days.includes(day)} onChange={() => toggle(day)} data-testid={`lc-day-${day}`} />
                  {DAY_NAMES[day].slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex max-w-xs flex-col gap-1.5 text-[0.95rem] font-medium">
            Not before
            <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className={field} data-testid="lc-hour">
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourWords(h)}, Lagos time
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
            Why (kept in the log)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="For example: the first week of joining" className={field} data-testid="lc-reason" />
          </label>
          <div>
            <Button type="submit" size="md" variant="solid" loading={d.busy === "rem"} disabled={!changed || reason.trim().length < 5 || days.length < 1 || days.length > 4} data-testid="lc-save-reminders">
              Save reminders
            </Button>
          </div>
          <Notice error={d.error} saved={d.saved} />
        </form>
      ) : (
        <p className="t-small text-soft">You can read this. An admin, a director or a pastor moves it.</p>
      )}
    </section>
  );
}
