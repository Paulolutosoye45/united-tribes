"use client";

import { useState } from "react";
import { autopilotSettingsAction } from "@/app/(app)/god/features/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AUTOPILOT_RANGES, checkAutopilotSettings, type AutopilotSettings } from "@/lib/seat/autopilot";

/**
 * The numbers behind the seat autopilot. Only the unlocked owner reaches this page, and the database refuses anyone else again. A change needs a reason, which is kept in
 * the log, and applies from the next plan: a plan already made keeps the numbers it was made with, and a person already placed stays placed.
 */
export function AutopilotSettingsCard({ settings }: { settings: AutopilotSettings }) {
  const d = useDo();
  const [mode, setMode] = useState<string>(settings.mode);
  const [bar, setBar] = useState(String(settings.bar));
  const [perTribe, setPerTribe] = useState(String(settings.perTribeDay));
  const [cap, setCap] = useState(String(settings.dayCap));
  const [extra, setExtra] = useState(String(settings.extraDays));
  const [small, setSmall] = useState(String(settings.smallDays));
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const changed =
    mode !== settings.mode || bar !== String(settings.bar) || perTribe !== String(settings.perTribeDay) || cap !== String(settings.dayCap) || extra !== String(settings.extraDays) || small !== String(settings.smallDays);
  const R = AUTOPILOT_RANGES;
  return (
    <section aria-labelledby="autopilot-settings-h" className="card flex flex-col gap-4 p-5" data-testid="autopilot-settings">
      <div className="flex flex-col gap-1">
        <h2 id="autopilot-settings-h" className="t-heading">Seat autopilot</h2>
        <p className="t-small max-w-[64ch] text-soft">
          The numbers behind the daily plan. Rehearsal writes the plan and places nobody. On follows the way chosen here: Suggest waits for one tap from the admin or the director, Auto places at the first beat after 9 am.
          Start with Suggest.
        </p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="t-small font-medium">When the switch is On</legend>
        <label className="t-body flex items-center gap-2">
          <input type="radio" name="autopilot-mode" value="suggest" checked={mode === "suggest"} onChange={() => setMode("suggest")} />
          Suggest: one tap places the day&rsquo;s plan
        </label>
        <label className="t-body flex items-center gap-2">
          <input type="radio" name="autopilot-mode" value="auto" checked={mode === "auto"} onChange={() => setMode("auto")} />
          Auto: it places by itself after 9 am
        </label>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="The bar (% fit)" type="number" inputMode="numeric" min={R.bar[0]} max={R.bar[1]} value={bar} onChange={(e) => setBar(e.target.value)} />
        <Input label="New members to one tribe in a day" type="number" inputMode="numeric" min={R.perTribe[0]} max={R.perTribe[1]} value={perTribe} onChange={(e) => setPerTribe(e.target.value)} />
        <Input label="Placements in a day" type="number" inputMode="numeric" min={R.dayCap[0]} max={R.dayCap[1]} value={cap} onChange={(e) => setCap(e.target.value)} />
        <Input label="Days it keeps placing after joining closes" type="number" inputMode="numeric" min={R.extra[0]} max={R.extra[1]} value={extra} onChange={(e) => setExtra(e.target.value)} />
        <Input label="Days before a tribe is called small" type="number" inputMode="numeric" min={R.small[0]} max={R.small[1]} value={small} onChange={(e) => setSmall(e.target.value)} />
      </div>
      <Input label="Why are you changing this? (5 to 300 characters)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      <div>
        <Button
          size="md"
          loading={d.busy === "save"}
          disabled={!changed || reason.trim().length < 5}
          onClick={() => {
            const checked = checkAutopilotSettings({ mode, bar, perTribe, dayCap: cap, extra, small, reason });
            if (!checked.ok) return setProblem(checked.message);
            setProblem(null);
            void d.go("save", () => autopilotSettingsAction(checked.value), { saved: "Saved.", after: () => setReason("") });
          }}
        >
          Save the numbers
        </Button>
      </div>
      {problem ? <p role="alert" className="t-small font-medium text-danger">{problem}</p> : null}
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}
