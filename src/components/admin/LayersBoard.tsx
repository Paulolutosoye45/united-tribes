"use client";

import { useState } from "react";
import { saveGoalIdeaAction, saveCommunityPromptAction } from "@/app/(app)/admin/guides/actions";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import type { Layers } from "@/lib/admin/types";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

const PHASES = [
  { n: 1, label: "Weeks 1 to 4" },
  { n: 2, label: "Weeks 5 to 8" },
  { n: 3, label: "Weeks 9 to 12" },
] as const;

export function LayersBoard({ layers }: { layers: Layers }) {
  return (
    <ul className="flex flex-col gap-4">
      {layers.communities.map((t) => (
        <li key={t.id}>
          <details className="card p-0" open={t.active && layers.communities.indexOf(t) === 0}>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-4">
              <span className="t-heading">{t.name}</span>
              <span className="t-small text-soft">
                {t.prompts.filter(Boolean).length} of 3 prompts · {t.goals.reduce((n, g) => n + g.ideas.filter(Boolean).length, 0)} of {t.goals.length * 3} step ideas
              </span>
            </summary>
            <div className="flex flex-col gap-8 border-t border-line px-5 py-5">
              <section aria-label={`${t.name}: skill-share prompts`} className="flex flex-col gap-4">
                <div className="flex flex-col gap-0.5">
                  <h3 className="font-semibold">Skill-share prompt</h3>
                  <p className="t-small text-soft">One prompt for the whole community: a way for members to teach each other something from their field.</p>
                </div>
                {PHASES.map((p) => (
                  <LayerField key={p.n} label={p.label} initial={t.prompts[p.n - 1] ?? ""} canEdit={layers.can_edit} save={(value) => saveCommunityPromptAction(t.id, p.n, value)} />
                ))}
              </section>
              {t.goals.map((g) => (
                <section key={g.id} aria-label={`${g.title}: step ideas`} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-0.5">
                    <h3 className="font-semibold">{g.title}</h3>
                    <p className="t-small text-soft">Ideas for the weekly step toward this goal, offered when a member is stuck.</p>
                  </div>
                  {PHASES.map((p) => (
                    <LayerField key={p.n} label={p.label} initial={g.ideas[p.n - 1] ?? ""} canEdit={layers.can_edit} save={(value) => saveGoalIdeaAction(g.id, p.n, value)} />
                  ))}
                </section>
              ))}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function LayerField({ label, initial, canEdit, save }: { label: string; initial: string; canEdit: boolean; save: (value: string) => Promise<{ ok: true } | { ok: false; message: string }> }) {
  const d = useDo();
  const [value, setValue] = useState(initial);
  const changed = value.trim() !== initial.trim();
  return (
    <div className="flex flex-col gap-2">
      <Textarea label={label} className="min-h-20" value={value} onChange={(e) => setValue(e.target.value)} maxLength={300} disabled={!canEdit} optional hint={canEdit ? "Leave it empty to remove it." : undefined} />
      <Notice error={d.error} saved={d.saved} />
      {canEdit && changed ? (
        <div>
          <Button size="sm" loading={d.busy === "save"} onClick={() => void d.go("save", () => save(value), { saved: "Saved." })}>
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}
