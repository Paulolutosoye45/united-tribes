"use client";

import { useState } from "react";
import { seatSettingsAction } from "@/app/(app)/god/features/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SEAT_RANGES, checkSeatSettings, type SeatSettings } from "@/lib/seat/seat";

/**
 * The numbers behind the seat window. Only the unlocked owner reaches this page, and the database refuses anyone else again. A change needs a reason, which is kept in
 * the log, and it applies from the next step: a clock already running keeps the times it was given, and an email already sent stays sent.
 */
export function SeatWindowSettingsCard({ settings }: { settings: SeatSettings }) {
  const d = useDo();
  const [window, setWindow] = useState(String(settings.windowHours));
  const [remind, setRemind] = useState(String(settings.remindHours));
  const [last, setLast] = useState(String(settings.lastCallHours));
  const [back, setBack] = useState(String(settings.takeBackDays));
  const [offers, setOffers] = useState(String(settings.offersInRow));
  const [cap, setCap] = useState(String(settings.dayCap));
  const [bar, setBar] = useState(String(settings.bar));
  const [include, setInclude] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const changed =
    window !== String(settings.windowHours) || remind !== String(settings.remindHours) || last !== String(settings.lastCallHours) || back !== String(settings.takeBackDays) ||
    offers !== String(settings.offersInRow) || cap !== String(settings.dayCap) || bar !== String(settings.bar) || include.trim() !== "";
  const R = SEAT_RANGES;
  return (
    <section aria-labelledby="seat-settings-h" className="card flex flex-col gap-4 p-5" data-testid="seat-window-settings">
      <div className="flex flex-col gap-1">
        <h2 id="seat-settings-h" className="t-heading">Seat window</h2>
        <p className="t-small max-w-[64ch] text-soft">
          The numbers behind the 48-hour clock. Only seats whose first email went after {settings.countedFrom ? new Date(settings.countedFrom).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" }) : "the day you switch it on"} are put on a clock.
          A clock already running keeps the times it was given.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Hours to answer" type="number" inputMode="numeric" min={R.window[0]} max={R.window[1]} value={window} onChange={(e) => setWindow(e.target.value)} />
        <Input label="Reminder after (hours)" type="number" inputMode="numeric" min={R.remind[0]} max={R.remind[1]} value={remind} onChange={(e) => setRemind(e.target.value)} />
        <Input label="Last call after (hours)" type="number" inputMode="numeric" min={R.lastCall[0]} max={R.lastCall[1]} value={last} onChange={(e) => setLast(e.target.value)} />
        <Input label="Days to take a seat back" type="number" inputMode="numeric" min={R.takeBack[0]} max={R.takeBack[1]} value={back} onChange={(e) => setBack(e.target.value)} />
        <Input label="Offers in a row for one place" type="number" inputMode="numeric" min={R.offers[0]} max={R.offers[1]} value={offers} onChange={(e) => setOffers(e.target.value)} />
        <Input label="Most releases in one day" type="number" inputMode="numeric" min={R.dayCap[0]} max={R.dayCap[1]} value={cap} onChange={(e) => setCap(e.target.value)} />
        <Input label="The bar for the next person (%)" type="number" inputMode="numeric" min={R.bar[0]} max={R.bar[1]} value={bar} onChange={(e) => setBar(e.target.value)} />
        <Input label="Also count seats placed in the last (days)" type="number" inputMode="numeric" min={R.include[0]} max={R.include[1]} value={include} placeholder="Leave empty to keep the day" onChange={(e) => setInclude(e.target.value)} />
      </div>
      <Input label="Why are you changing this? (5 to 300 characters)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      <div>
        <Button
          size="md"
          loading={d.busy === "save"}
          disabled={!changed || reason.trim().length < 5}
          onClick={() => {
            const checked = checkSeatSettings({ window, remind, lastCall: last, takeBack: back, offers, dayCap: cap, bar, includeDays: include, reason });
            if (!checked.ok) return setProblem(checked.message);
            setProblem(null);
            void d.go("save", () => seatSettingsAction(checked.value), { saved: "Saved.", after: () => { setReason(""); setInclude(""); } });
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
