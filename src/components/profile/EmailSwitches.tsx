"use client";

import { useState } from "react";
import { saveEmailSwitchesAction } from "@/app/(app)/profile/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import type { EmailSwitches as Switches } from "@/lib/outreach/types";

const ROWS = [
  { key: "reminders", title: "Reminders", note: "A gentle nudge if you start your form or application and get busy, or if a tribe is waiting for you." },
  { key: "announcements", title: "Announcements", note: "News from the church office, now and then." },
  { key: "tribe", title: "My tribe", note: "Meeting times, your weekly check-in and anything from your leader. Turning this off stops all email about your tribe." },
] as const;

/** Three plain switches, each taking effect at once and kept in the record of what you agreed to. */
export function EmailSwitches({ initial }: { initial: Switches }) {
  const d = useDo();
  const [v, setV] = useState(initial);
  const changed = v.reminders !== initial.reminders || v.announcements !== initial.announcements || v.tribe !== initial.tribe;
  return (
    <div className="card flex flex-col gap-5 p-5 sm:p-6" data-testid="email-switches">
      <p className="t-small text-soft">Every email we send also has a link at the bottom to stop that kind. Safety messages, like a sign-in code, always arrive.</p>
      {ROWS.map((r) => (
        <label key={r.key} className="flex items-start gap-4">
          <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--flame)]" checked={v[r.key]} onChange={(e) => setV({ ...v, [r.key]: e.target.checked })} />
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">{r.title}</span>
            <span className="t-small text-soft">{r.note}</span>
          </span>
        </label>
      ))}
      <Notice error={d.error} saved={d.saved} />
      <div>
        <Button size="md" disabled={!changed} loading={d.busy === "save"} onClick={() => void d.go("save", () => saveEmailSwitchesAction(v.reminders, v.announcements, v.tribe), { saved: "Saved. It takes effect straight away." })}>
          Save
        </Button>
      </div>
    </div>
  );
}
