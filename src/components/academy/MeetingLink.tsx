"use client";

import { useState } from "react";
import { saveMeetingAction } from "@/app/(app)/lead/tribe/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Where the tribe meets. For an online tribe this is the link members receive in
 * the reminder two hours before; for an in-person one it is a short place note
 * ("Hall B, behind the main auditorium"). Never a home address.
 */
export function MeetingLink({ tribeId, link, placeNote, online }: { tribeId: string; link: string | null; placeNote: string | null; online: boolean }) {
  const [url, setUrl] = useState(link ?? "");
  const [note, setNote] = useState(placeNote ?? "");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setState(null);
    const result = await saveMeetingAction(tribeId, url, note);
    setBusy(false);
    setState(result.ok ? { ok: true, message: "Saved. Members get this in their reminders." } : { ok: false, message: result.message });
  }

  return (
    <section aria-labelledby="meeting-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="meeting-heading" className="t-heading">
          Where you meet
        </h2>
        <p className="t-small measure text-soft">
          {online ? "Paste your meeting link. Members receive it in the reminder two hours before each meeting." : "A short note on where to find the tribe. Never a home address."}
        </p>
      </div>
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        {online ? (
          <Input label="Meeting link" name="meeting_link" type="url" inputMode="url" placeholder="https://meet.google.com/abc-defg-hij" value={url} onChange={(e) => setUrl(e.target.value)} optional />
        ) : null}
        <Input label="Place note" name="place_note" placeholder={online ? "e.g. Google Meet" : "e.g. Hall B, behind the main auditorium"} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} optional />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" size="md" loading={busy}>
            Save
          </Button>
          <div aria-live="polite" className="min-h-6">
            {state ? (
              <p role={state.ok ? "status" : "alert"} className={`t-small ${state.ok ? "text-success" : "text-danger"}`}>
                {state.message}
              </p>
            ) : null}
          </div>
        </div>
      </form>
    </section>
  );
}
