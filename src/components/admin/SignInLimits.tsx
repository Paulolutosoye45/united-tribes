"use client";

import { useState } from "react";
import { setSigninLimitsAction } from "@/app/(app)/admin/signin/actions";
import { Button } from "@/components/ui/Button";
import { BREAKER_LIMITS, LIMITS, type LimitInfo, type SigninOverview } from "@/lib/signin/admin";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

function Row({ info, value, onChange }: { info: LimitInfo; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={`si-${info.key}`} className="font-semibold">
          {info.label}
        </label>
        {info.help ? <p className="t-small text-soft">{info.help}</p> : null}
        <p className="t-small text-soft">
          Usual setting {info.fallback} {info.unit}. Allowed from {info.min} to {info.max}.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={`si-${info.key}`}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-24 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-right text-base focus:border-ink focus:outline-none"
        />
        <span className="t-small w-16 text-soft">{info.unit}</span>
      </div>
    </div>
  );
}

/** The limits on codes, and what makes the breaker pause WhatsApp. Each change is recorded with the person's name. */
export function SignInLimits({ overview }: { overview: SigninOverview }) {
  const d = useDo();
  const stored = overview.settings as unknown as Record<string, number>;
  const all = [...LIMITS, ...BREAKER_LIMITS];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(all.map((i) => [i.key, String(stored[i.key])])));
  const [problem, setProblem] = useState<string | null>(null);

  const changed = all.filter((i) => values[i.key].trim() !== String(stored[i.key]));

  function save() {
    const changes: Record<string, number> = {};
    for (const i of changed) {
      const typed = Number(values[i.key]);
      if (values[i.key].trim() === "" || !Number.isInteger(typed)) return setProblem(`${i.label}: type a whole number.`);
      if (typed < i.min || typed > i.max) return setProblem(`${i.label}: choose a number from ${i.min} to ${i.max}.`);
      if (i.raises && typed > stored[i.key] && !overview.can_raise) return setProblem(`${i.label}: only the director can raise this. You can lower it.`);
      changes[i.key] = typed;
    }
    setProblem(null);
    void d.go("limits", () => setSigninLimitsAction(changes), { saved: "Saved. The new limits apply from the next code." });
  }

  return (
    <section aria-labelledby="signin-limits-heading" className="flex flex-col gap-4" data-testid="signin-limits">
      <div>
        <h2 id="signin-limits-heading" className="t-heading">
          Limits
        </h2>
        <p className="t-small text-soft">How many codes may go out, and when WhatsApp pauses itself. The usual settings suit most churches. Change one at a time.</p>
      </div>
      <form
        noValidate
        className="card flex flex-col divide-y divide-line p-0"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {LIMITS.map((i) => (
          <Row key={i.key} info={i} value={values[i.key]} onChange={(v) => { setValues((prev) => ({ ...prev, [i.key]: v })); setProblem(null); }} />
        ))}
        <div className="px-5 py-4">
          <p className="font-semibold">What makes WhatsApp pause itself</p>
          <p className="t-small text-soft">If failed sends, refusals, missing receipts or STOP replies pile up, the breaker pauses WhatsApp and tells the director and data lead. Only a person starts it again.</p>
        </div>
        {BREAKER_LIMITS.map((i) => (
          <Row key={i.key} info={i} value={values[i.key]} onChange={(v) => { setValues((prev) => ({ ...prev, [i.key]: v })); setProblem(null); }} />
        ))}
        <div className="flex flex-col gap-3 px-5 py-4">
          <Notice error={problem ?? d.error} saved={problem ? null : d.saved} />
          <div>
            <Button type="submit" size="md" loading={d.busy === "limits"} disabled={changed.length === 0}>
              Save changes
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
