"use client";

import { setNoticeModeAction } from "@/app/(app)/admin/notifications/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { MODE_WORDS, NOTICE_MODES, type NoticeMode } from "@/lib/admin/notices";

/** Off, Rehearsal or On for one group of team notices. Only an admin or director can change it; everyone else with the page sees where it stands. */
export function ModeSwitch({ group, label, mode, canEdit }: { group: string; label: string; mode: NoticeMode; canEdit: boolean }) {
  const d = useDo();
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={`${label}: switch`} className="grid grid-cols-3 gap-1 rounded-full bg-surface p-1">
        {NOTICE_MODES.map((m) => {
          const on = mode === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`mode-${group}-${m}`}
              disabled={!canEdit || d.busy !== null}
              onClick={() => (on ? undefined : void d.go(m, () => setNoticeModeAction(group, m), { saved: MODE_WORDS[m].saved }))}
              className={`press min-h-11 rounded-full px-2 text-[0.9rem] font-semibold transition-colors ${on ? (m === "on" ? "bg-flame text-white" : "bg-ink text-page") : "text-ink hover:bg-surface-strong"} disabled:opacity-60`}
            >
              {MODE_WORDS[m].label}
            </button>
          );
        })}
      </div>
      <p className="t-small text-soft">{MODE_WORDS[mode].hint}</p>
      {canEdit ? null : <p className="t-small text-soft">Only an admin or a director can change this.</p>}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
