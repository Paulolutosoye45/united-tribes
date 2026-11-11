"use client";

import { useState } from "react";
import { promptSettingsAction } from "@/app/(app)/god/features/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { KIND_LABELS, PROMPT_RANGES, checkPromptSettings, type PromptSettings } from "@/lib/prompt/office";
import { PROMPT_KINDS } from "@/lib/prompt/prompt";

/**
 * The numbers behind the sign-in prompt, and a switch for each kind of task. Only the unlocked owner reaches this page, and the database refuses anyone else again. A change
 * needs a reason, which is kept in the log, and takes hold at the next visit: a person already looking at the screen keeps what they have.
 */
export function PromptSettingsCard({ settings }: { settings: PromptSettings }) {
  const d = useDo();
  const [visit, setVisit] = useState(String(settings.visitHours));
  const [tasks, setTasks] = useState(String(settings.maxTasks));
  const [last, setLast] = useState(String(settings.lastHours));
  const [worth, setWorth] = useState(String(settings.worthCallAfter));
  const [off, setOff] = useState<string[]>(settings.kindsOff);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const R = PROMPT_RANGES;
  const changed =
    visit !== String(settings.visitHours) || tasks !== String(settings.maxTasks) || last !== String(settings.lastHours) || worth !== String(settings.worthCallAfter) ||
    [...off].sort().join() !== [...settings.kindsOff].sort().join();
  return (
    <section aria-labelledby="prompt-settings-h" className="card flex flex-col gap-4 p-5" data-testid="prompt-settings">
      <div className="flex flex-col gap-1">
        <h2 id="prompt-settings-h" className="t-heading">Sign-in prompt</h2>
        <p className="t-small max-w-[64ch] text-soft">
          The screen that opens when a member or leader signs in and owes the church something. The switch above says who sees it. These numbers say how it behaves. “Not now” closes a task for one visit only.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Hours away that start a new visit" type="number" inputMode="numeric" min={R.visit[0]} max={R.visit[1]} value={visit} onChange={(e) => setVisit(e.target.value)} />
        <Input label="Tasks in one visit" type="number" inputMode="numeric" min={R.tasks[0]} max={R.tasks[1]} value={tasks} onChange={(e) => setTasks(e.target.value)} />
        <Input label="Hours before a seat is released with no “Not now”" type="number" inputMode="numeric" min={R.last[0]} max={R.last[1]} value={last} onChange={(e) => setLast(e.target.value)} />
        <Input label="“Not now” in a row before a call is worth it" type="number" inputMode="numeric" min={R.worth[0]} max={R.worth[1]} value={worth} onChange={(e) => setWorth(e.target.value)} />
      </div>
      <fieldset className="flex flex-col gap-1" data-testid="prompt-kinds">
        <legend className="t-body mb-1 font-semibold">Tasks that are turned off</legend>
        {PROMPT_KINDS.map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="size-5" checked={off.includes(k)} onChange={(e) => setOff((o) => (e.target.checked ? [...o, k] : o.filter((x) => x !== k)))} data-kind={k} />
            <span className="t-body">{KIND_LABELS[k]}</span>
          </label>
        ))}
      </fieldset>
      <Input label="Why are you changing this? (5 to 300 characters)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      <div>
        <Button
          size="md"
          loading={d.busy === "save"}
          disabled={!changed || reason.trim().length < 5}
          onClick={() => {
            const checked = checkPromptSettings({ visit, tasks, last, worth, kindsOff: off, reason });
            if (!checked.ok) return setProblem(checked.message);
            setProblem(null);
            void d.go("save", () => promptSettingsAction(checked.value), { saved: "Saved.", after: () => setReason("") });
          }}
        >
          Save
        </Button>
      </div>
      {problem ? <p role="alert" className="t-small font-medium text-danger">{problem}</p> : null}
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}
