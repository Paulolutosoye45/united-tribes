"use client";

import { useState } from "react";
import { saveSettingsAction } from "@/app/(app)/admin/referees/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Input } from "@/components/ui/Input";
import { STANDINGS, STANDING_LABEL, type Standing } from "@/lib/leaders/referee/labels";
import type { RefereeSettings as Settings } from "@/lib/leaders/referee/types";

/** What the check does and how strict it is. The defaults are sensible; most churches never need to change them. */
export function RefereeSettingsForm({ settings }: { settings: Settings }) {
  const run = useDo();
  const [gate, setGate] = useState<Standing[]>(settings.gateStandings);
  const [pct, setPct] = useState(String(settings.callbackPct));
  const [seconds, setSeconds] = useState(String(settings.minSeconds));
  const changed = gate.slice().sort().join() !== settings.gateStandings.slice().sort().join() || Number(pct) !== settings.callbackPct || Number(seconds) !== settings.minSeconds;

  const toggle = (s: Standing) => setGate((g) => (g.includes(s) ? g.filter((x) => x !== s) : [...g, s]));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run.go("save", () => saveSettingsAction({ gate_standings: gate, callback_pct: Number(pct), min_seconds: Number(seconds) }), { saved: "Saved. References already in have been checked against these settings." });
      }}
      className="flex flex-col gap-5"
      data-testid="referee-settings"
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="font-semibold">Who counts as “a pastor or unit head”</legend>
        <p className="t-small text-soft">Every application needs one reference from such a person. Someone on the list counts if their role is ticked here.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {STANDINGS.map((s) => (
            <Choice key={s} type="checkbox" name="gate" value={s} checked={gate.includes(s)} onChange={() => toggle(s)} title={STANDING_LABEL[s]} />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Share of references that get a call-back"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          hint={`Chosen at random, as a percentage (0 to 100). References that are held always get one. Now: ${settings.callbackPct}%.`}
        />
        <Input
          label="Too fast to be thoughtful (seconds)"
          type="number"
          inputMode="numeric"
          min={5}
          max={600}
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          hint={`A referee who finishes the four ratings faster than this is held for a look. Now: ${settings.minSeconds} seconds.`}
        />
      </div>
      <Notice error={run.error} saved={run.saved} />
      <div>
        <Button type="submit" size="md" loading={run.busy === "save"} disabled={!changed || gate.length === 0}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
