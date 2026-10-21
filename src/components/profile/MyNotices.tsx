"use client";

import { useState } from "react";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { DELIVERY_WORDS, type Delivery, type NoticePref } from "@/lib/admin/notices";
import { saveNoticePrefAction } from "@/app/(app)/profile/notice-actions";

const WHO: Record<string, string> = { admin: "As an admin", pastors: "As a pastor", directors: "As a director", care: "As the care team", coaches: "As a coach" };
const CHOICES: Delivery[] = ["instant", "daily", "weekly"];

/**
 * How a team member hears about what needs them, one choice for each role they hold. The choice is theirs alone. Someone who is both an admin
 * and a pastor still gets one summary, with a part for each role, and a deadline or a concern is always sent right away.
 */
export function MyNotices({ prefs }: { prefs: NoticePref[] }) {
  const d = useDo();
  const [chosen, setChosen] = useState<Record<string, Delivery>>(() => Object.fromEntries(prefs.map((p) => [p.group, p.delivery])));
  return (
    <div className="card flex flex-col gap-5 p-5 sm:p-6" data-testid="my-notices">
      <p className="t-body measure">
        When something needs you, we email you so you do not have to sign in to find out. Choose how: each thing as it happens, one summary a day, or one a week.
        {prefs.length > 1 ? " You hold more than one role, so a summary is one email with a part for each." : ""} A referee’s concern, a deletion request near its deadline, messages that are stuck and a new role are always sent right away.
      </p>
      {prefs.map((p) => (
        <fieldset key={p.group} className="flex flex-col gap-2" data-testid={`pref-${p.group}`}>
          <legend className="font-semibold">{WHO[p.group] ?? p.group}</legend>
          <div role="radiogroup" aria-label={`${WHO[p.group] ?? p.group}: how often`} className="grid grid-cols-1 gap-1 rounded-[var(--radius-control)] bg-surface p-1 sm:grid-cols-3">
            {CHOICES.map((c) => {
              const on = (chosen[p.group] ?? p.delivery) === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-testid={`pref-${p.group}-${c}`}
                  disabled={d.busy !== null}
                  onClick={() => (on ? undefined : void d.go(`${p.group}-${c}`, () => saveNoticePrefAction(p.group, c), { saved: "Saved.", after: () => setChosen((x) => ({ ...x, [p.group]: c })) }))}
                  className={`press min-h-11 rounded-[calc(var(--radius-control)-4px)] px-3 text-[0.92rem] font-semibold transition-colors ${on ? "bg-ink text-page" : "text-ink hover:bg-surface-strong"} disabled:opacity-60`}
                >
                  {DELIVERY_WORDS[c]}
                </button>
              );
            })}
          </div>
          {p.mode === "off" ? <p className="t-small text-soft">The office has not switched these on yet, so nothing is sent for now.</p> : null}
          {p.mode === "rehearsal" ? <p className="t-small text-soft">The office is rehearsing these. Nothing is emailed yet.</p> : null}
        </fieldset>
      ))}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
