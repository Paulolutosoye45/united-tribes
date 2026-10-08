"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addSessionAction, markAttendanceAction, removeSessionAction } from "@/app/(app)/review/academy/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { SESSION_KINDS } from "@/lib/academy/options";
import type { SessionAdmin, SessionKind } from "@/lib/academy/types";
import { formatLagosDay, formatLagosTime } from "@/lib/dates";

export function SessionManager({ sessions, canAdd, canMark }: { sessions: SessionAdmin[]; canAdd: boolean; canMark: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<SessionKind>("practice_workshop");
  const [local, setLocal] = useState("");
  const [minutes, setMinutes] = useState("120");
  const [mode, setMode] = useState<"online" | "in_person">("in_person");
  const [place, setPlace] = useState("");
  const [capacity, setCapacity] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const result = await addSessionAction({ kind, local, minutes: Number(minutes), mode, place, capacity: Number(capacity) });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setLocal("");
    router.refresh();
  }

  async function run(id: string, action: () => ReturnType<typeof removeSessionAction>) {
    setWorking(id);
    setError(null);
    const result = await action();
    setWorking(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-10">
      {canAdd ? (
        <section aria-labelledby="add-session-heading" className="flex flex-col gap-4">
          <h2 id="add-session-heading" className="t-heading">
            Add a workshop date
          </h2>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
            className="card grid gap-5 p-5 sm:grid-cols-2 sm:p-7"
          >
            <Select label="Which workshop" name="kind" value={kind} onChange={(e) => setKind(e.target.value as SessionKind)}>
              {(Object.keys(SESSION_KINDS) as SessionKind[]).map((k) => (
                <option key={k} value={k}>
                  {SESSION_KINDS[k].label}
                </option>
              ))}
            </Select>
            <Input label="Date and time" name="starts" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} hint="In Lagos time." />
            <Select label="Length" name="minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
              {[90, 120, 150, 180].map((m) => (
                <option key={m} value={m}>
                  {m / 60} hours
                </option>
              ))}
            </Select>
            <Select label="How" name="mode" value={mode} onChange={(e) => setMode(e.target.value as "online" | "in_person")}>
              <option value="in_person">In person</option>
              <option value="online">Online</option>
            </Select>
            <Input
              label={mode === "online" ? "Meeting link" : "Where"}
              name="place"
              value={place}
              maxLength={200}
              placeholder={mode === "online" ? "https://meet.google.com/…" : "e.g. Hall B, TCN Iganmu"}
              onChange={(e) => setPlace(e.target.value)}
            />
            <Input label="Seats" name="capacity" type="number" inputMode="numeric" min={2} max={200} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            {error ? (
              <p role="alert" className="t-small text-danger sm:col-span-2">
                {error}
              </p>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit" size="lg" loading={busy} disabled={!local || place.trim().length < 2}>
                Add this date
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="sessions-heading" className="flex flex-col gap-4">
        <h2 id="sessions-heading" className="t-heading">
          Workshops
        </h2>
        {!canAdd && error ? (
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
        ) : null}
        {sessions.length === 0 ? (
          <p className="card t-body p-6 text-soft">No workshops yet. {canAdd ? "Add a date above so leaders can book." : "The office adds them."}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sessions.map((s) => (
              <li key={s.id} className="card flex flex-col gap-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {SESSION_KINDS[s.kind].label} · {formatLagosDay(s.starts_at)}, {formatLagosTime(s.starts_at)}
                    </p>
                    <p className="t-small break-words text-soft">
                      {s.minutes / 60} {s.minutes === 60 ? "hour" : "hours"} · {s.mode === "online" ? "Online" : "In person"} · {s.place}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={s.booked >= s.capacity ? "flame" : "outline"}>
                      {s.booked} of {s.capacity} seats
                    </Badge>
                    {canAdd && s.booked === 0 ? (
                      <Button variant="quiet" size="sm" loading={working === s.id} onClick={() => void run(s.id, () => removeSessionAction(s.id))}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>

                {s.roster.length > 0 ? (
                  <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line" aria-label="Register">
                    {s.roster.map((p) => (
                      <li key={p.person_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                        <span className="font-medium">{p.name}</span>
                        {canMark && s.started ? (
                          <span className="flex items-center gap-2" role="group" aria-label={`Register for ${p.name}`}>
                            <Button
                              variant={p.attended === true ? "solid" : "quiet"}
                              size="sm"
                              loading={working === `${s.id}:${p.person_id}:y`}
                              aria-pressed={p.attended === true}
                              onClick={() => void run(`${s.id}:${p.person_id}:y`, () => markAttendanceAction(s.id, p.person_id, true))}
                            >
                              Came
                            </Button>
                            <Button
                              variant={p.attended === false ? "solid" : "quiet"}
                              size="sm"
                              loading={working === `${s.id}:${p.person_id}:n`}
                              aria-pressed={p.attended === false}
                              onClick={() => void run(`${s.id}:${p.person_id}:n`, () => markAttendanceAction(s.id, p.person_id, false))}
                            >
                              Absent
                            </Button>
                          </span>
                        ) : (
                          <span className="t-small text-soft">{p.attended === true ? "Came" : p.attended === false ? "Absent" : s.started ? "Not marked" : "Booked"}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
