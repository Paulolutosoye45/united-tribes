"use client";

import { useState } from "react";
import { markHandAction, openStaffChatAction } from "@/app/(app)/admin/messages/by-hand/actions";
import { Button } from "@/components/ui/Button";
import { whenText } from "@/lib/signin/admin";
import type { StaffList } from "@/lib/whatsapp/mode-view";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

const ROLE_WORDS: Record<string, string> = { leader: "Leader", assistant_leader: "Assistant leader", coach: "Coach" };
const field = "w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 py-2 text-base focus:border-ink focus:outline-none";

/** The leaders and coaches who said yes to WhatsApp, for the office to message from its own phone. No numbers are shown. */
export function HandStaff({ list }: { list: StaffList }) {
  const d = useDo();
  const [text, setText] = useState("Hi [first], a quick note from the church office: ");
  const [open, setOpen] = useState<{ key: string; log: number; link: string; first: string } | null>(null);
  return (
    <div className="flex flex-col gap-6" data-testid="hand-staff">
      <section className="card flex flex-col gap-4 p-5 sm:p-6">
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          What to say ([first] becomes each person&rsquo;s first name)
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} className={field} data-testid="hand-staff-text" />
        </label>
        {list.people.length === 0 ? (
          <p className="t-small text-soft" data-testid="hand-staff-none">
            No leader or coach has said yes to WhatsApp with a number saved yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="hand-staff-list">
            {list.people.map((p) => (
              <li key={p.person} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`hand-staff-${p.person}`}>
                <span className="flex flex-col">
                  <span className="font-medium">{p.name}</span>
                  <span className="t-small text-soft">
                    {ROLE_WORDS[p.role] ?? p.role}
                    {p.tribe ? ` · ${p.tribe}` : ""}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`hand-staff-open-${p.person}`}
                  loading={d.busy === p.person}
                  disabled={!text.trim()}
                  onClick={() =>
                    void d.go(p.person, async () => {
                      const r = await openStaffChatAction(p.person, "leader_note", text.replace(/\[first\]/g, p.first));
                      if (!r.ok) return r;
                      setOpen({ key: p.person, log: r.data.log, link: r.data.link, first: r.data.first });
                      window.open(r.data.link, "_blank", "noopener,noreferrer");
                      return { ok: true };
                    })
                  }
                >
                  Message {p.first}
                </Button>
                {open?.key === p.person ? (
                  <div className="pop-in flex w-full flex-col gap-3 rounded-[var(--radius-control)] bg-surface-strong px-4 py-3" data-testid="hand-staff-opened">
                    <p className="t-small">
                      WhatsApp should have opened for {open.first}. If it did not,{" "}
                      <a href={open.link} target="_blank" rel="noopener noreferrer" className="underline">
                        open it here
                      </a>
                      . Did you send it?
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button size="sm" variant="solid" onClick={() => void d.go("mark", () => markHandAction(open.log, "sent").then((r) => (r.ok ? { ok: true as const } : r)), { saved: "Marked as sent.", after: () => setOpen(null) })}>
                        Yes, I sent it
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void d.go("mark", () => markHandAction(open.log, "skipped").then((r) => (r.ok ? { ok: true as const } : r)), { saved: "Noted: left for now.", after: () => setOpen(null) })}>
                        I left it
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Notice error={d.error} saved={d.saved} />
      </section>
      {list.recent.length > 0 ? (
        <details className="card p-5 sm:p-6">
          <summary className="t-small cursor-pointer font-medium">Sent lately</summary>
          <ul className="t-small mt-3 flex flex-col gap-2" data-testid="hand-staff-recent">
            {list.recent.map((l) => (
              <li key={l.id}>
                <span className="text-soft">{whenText(l.at)}</span> · to {l.person ?? "a leader"}
                {l.by ? ` (${l.by})` : ""} · {l.outcome === "sent" ? "sent" : l.outcome === "skipped" ? "left" : "opened"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
