"use client";

import { CompanionSwitch, PickNote } from "@/components/companion/Companion";
import { Chip, Sparkle } from "@/components/ui/Chip";
import { areaFromStory } from "@/lib/intake/areas";
import {
  CHILDREN,
  RELATIONSHIPS,
  WORK_FIELDS,
  WORK_STATUSES,
  type HeardOption,
} from "@/lib/intake/options";
import type { HeardField } from "@/lib/intake/heard";
import { StepHeading, SuggestionLabel } from "./ui";
import type { StepProps } from "./types";
import type { Companion } from "./useCompanion";

type Group = {
  field: HeardField;
  /** The answer this question fills in. */
  key: "workStatus" | "workField" | "relationship" | "children";
  heading: string;
  options: readonly HeardOption[];
  multi: boolean;
  value: (a: StepProps["answers"]) => string[];
  write: (ids: string[]) => Partial<StepProps["answers"]>;
};

const GROUPS: Group[] = [
  {
    field: "work_status",
    key: "workStatus",
    heading: "Your work",
    options: WORK_STATUSES,
    multi: false,
    value: (a) => (a.workStatus ? [a.workStatus] : []),
    write: (ids) => ({ workStatus: ids[0] as StepProps["answers"]["workStatus"] }),
  },
  {
    field: "work_field",
    key: "workField",
    heading: "Your field",
    options: WORK_FIELDS,
    multi: false,
    value: (a) => (a.workField ? [a.workField] : []),
    write: (ids) => ({ workField: ids[0] as StepProps["answers"]["workField"] }),
  },
  {
    field: "relationship",
    key: "relationship",
    heading: "Your relationship",
    options: RELATIONSHIPS,
    multi: false,
    value: (a) => (a.relationship ? [a.relationship] : []),
    write: (ids) => ({ relationship: ids[0] as StepProps["answers"]["relationship"] }),
  },
  {
    field: "children",
    key: "children",
    heading: "Children",
    options: CHILDREN,
    multi: true,
    value: (a) => a.children ?? [],
    write: (ids) => ({ children: ids as StepProps["answers"]["children"] }),
  },
];

/**
 * "We heard…": what the Companion picked out of the season story, as chips the person can keep, change or remove. Nothing is
 * kept unless it is still selected when they continue. Without the Companion the same chips are simply there to tap.
 */
export function HeardStep({
  answers,
  set,
  cmp,
  loading,
}: StepProps & { cmp: Companion; /** The AI service has been asked and has not yet answered. */ loading: boolean }) {
  const live = areaFromStory(answers.story ?? "");
  const offerArea = live && live.slug !== answers.areaSlug;
  const anySuggested = cmp.on && GROUPS.some((g) => cmp.picks.heard[g.field].length > 0);

  return (
    <>
      <StepHeading
        title={anySuggested ? "Here is what we heard." : "A little more about you."}
        hint="Tap to keep, change or remove. This only helps us suggest your community and goals. Other members never see it, and every part is optional."
      />
      {loading && cmp.on ? (
        <div className="mb-6">
          <SuggestionLabel loading>Checking again with your assistant</SuggestionLabel>
        </div>
      ) : null}

      <div className="flex flex-col gap-7">
        {GROUPS.map((g) => {
          const chosen = g.value(answers);
          const picks = cmp.on ? cmp.picks.heard[g.field] : [];
          const byId = new Map(picks.map((p) => [p.id, p]));
          const mine = cmp.picked(g.key) ? picks.find((p) => chosen.includes(p.id)) : undefined;
          return (
            <section key={g.field} aria-labelledby={`heard-${g.field}`}>
              <h2 id={`heard-${g.field}`} className="t-heading mb-3">
                {g.heading}
              </h2>
              <div role="group" aria-labelledby={`heard-${g.field}`} className="flex flex-wrap gap-2.5">
                {g.options.map((o) => {
                  const on = chosen.includes(o.id);
                  return (
                    <Chip
                      key={o.id}
                      selected={on}
                      suggested={byId.has(o.id)}
                      onClick={() => {
                        if (g.multi) {
                          // "No children" cannot sit beside any other answer.
                          const next = on
                            ? chosen.filter((x) => x !== o.id)
                            : o.id === "none"
                              ? ["none"]
                              : [...chosen.filter((x) => x !== "none"), o.id];
                          set(g.write(next));
                        } else {
                          set(g.write(on ? [] : [o.id]));
                        }
                      }}
                    >
                      {o.label}
                    </Chip>
                  );
                })}
              </div>
              {mine ? <PickNote pick={mine} name={g.heading.toLowerCase()} onReject={() => cmp.reject(g.key)} /> : null}
              {cmp.on && g.field === "children" && cmp.picks.heardNotes.children && chosen.length === 0 ? (
                <p className="t-small mt-2 flex items-center gap-2 text-accent">
                  <Sparkle size={14} />
                  {cmp.picks.heardNotes.children}
                </p>
              ) : null}
            </section>
          );
        })}

        {offerArea ? (
          <section aria-label="Where you live" className="card rise-in flex flex-col gap-3 p-4">
            <p className="font-medium">You mentioned {live.name}. Is that where you are based?</p>
            <div>
              <button
                type="button"
                onClick={() => set({ areaNote: live.name, areaSlug: live.slug, zone: live.zone })}
                className="press min-h-11 rounded-[var(--radius-control)] border-[1.5px] border-ink px-4 font-semibold"
              >
                Yes, use {live.name}
              </button>
            </div>
          </section>
        ) : null}
      </div>
      <CompanionSwitch cmp={cmp} className="mt-8" />
    </>
  );
}
