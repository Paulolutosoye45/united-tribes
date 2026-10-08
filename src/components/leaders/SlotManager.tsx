"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addSlotAction, removeSlotAction } from "@/app/(app)/review/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { formatLagosDay, formatLagosTime, lagosDateKey } from "@/lib/dates";
import type { SlotView } from "@/lib/leaders/review-types";

export function SlotManager({ slots, canAdd, canSeeNames }: { slots: SlotView[]; canAdd: boolean; canSeeNames: boolean }) {
  const router = useRouter();
  const [local, setLocal] = useState("");
  const [minutes, setMinutes] = useState("20");
  const [mode, setMode] = useState<"online" | "in_person">("online");
  const [place, setPlace] = useState("");
  const [panel, setPanel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const result = await addSlotAction({ local, minutes: Number(minutes), mode, place, panel });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setLocal("");
    router.refresh();
  }

  async function remove(id: string) {
    setRemoving(id);
    setError(null);
    const result = await removeSlotAction(id);
    setRemoving(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  const days = new Map<string, SlotView[]>();
  for (const s of slots) {
    const key = lagosDateKey(s.starts_at);
    days.set(key, [...(days.get(key) ?? []), s]);
  }

  return (
    <div className="flex flex-col gap-10">
      {canAdd ? (
        <section aria-labelledby="add-slot-heading" className="flex flex-col gap-4">
          <h2 id="add-slot-heading" className="t-heading">
            Add a time
          </h2>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
            className="card grid gap-5 p-5 sm:grid-cols-2 sm:p-7"
          >
            <Input label="Date and time" name="starts" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} hint="In Lagos time." />
            <Select label="Length" name="minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
              {[20, 30, 45].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
            <Select label="How" name="mode" value={mode} onChange={(e) => setMode(e.target.value as "online" | "in_person")}>
              <option value="online">Online</option>
              <option value="in_person">In person</option>
            </Select>
            <Input
              label={mode === "online" ? "Meeting link" : "Where"}
              name="place"
              value={place}
              maxLength={200}
              placeholder={mode === "online" ? "https://meet.google.com/…" : "e.g. Room 3, TCN Iganmu"}
              onChange={(e) => setPlace(e.target.value)}
            />
            <div className="sm:col-span-2">
              <Input label="Panelists" name="panel" value={panel} maxLength={200} optional placeholder="e.g. Pastor Ife and Coach Bola" onChange={(e) => setPanel(e.target.value)} />
            </div>
            {error ? (
              <p role="alert" className="t-small text-danger sm:col-span-2">
                {error}
              </p>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit" size="lg" loading={busy} disabled={!local || place.trim().length < 2}>
                Add this time
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="slots-heading" className="flex flex-col gap-4">
        <h2 id="slots-heading" className="t-heading">
          Upcoming times
        </h2>
        {slots.length === 0 ? (
          <p className="card t-body p-6 text-soft">No times yet. {canAdd ? "Add a few above so invited applicants can book." : "The office adds them."}</p>
        ) : (
          <div className="flex flex-col gap-6">
            {[...days.entries()].map(([key, list]) => (
              <div key={key} className="flex flex-col gap-2.5">
                <h3 className="t-small font-semibold text-soft">{formatLagosDay(list[0].starts_at)}</h3>
                <ul className="flex flex-col gap-2.5">
                  {list.map((s) => (
                    <li key={s.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {formatLagosTime(s.starts_at)}
                          <span className="t-small ml-2 font-normal text-soft">
                            {s.minutes} min · {s.mode === "online" ? "Online" : "In person"}
                          </span>
                        </p>
                        <p className="t-small break-words text-soft">
                          {s.place}
                          {s.panel ? ` · ${s.panel}` : ""}
                        </p>
                        {s.booked ? (
                          <p className="t-small mt-1 font-medium">
                            {canSeeNames && s.applicant ? (
                              s.application_id ? (
                                <Link href={`/review/${s.application_id}`} className="underline underline-offset-4">
                                  Booked by {s.applicant}
                                </Link>
                              ) : (
                                `Booked by ${s.applicant}`
                              )
                            ) : (
                              "Booked"
                            )}
                          </p>
                        ) : null}
                      </div>
                      {s.booked ? (
                        <Badge tone="gold">Booked</Badge>
                      ) : canAdd ? (
                        <Button variant="quiet" size="sm" loading={removing === s.id} onClick={() => void remove(s.id)}>
                          Remove
                        </Button>
                      ) : (
                        <Badge tone="outline">Open</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
