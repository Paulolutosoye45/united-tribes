"use client";

import { Hint } from "@/components/companion/Companion";
import { Chip } from "@/components/ui/Chip";
import { Segmented } from "@/components/ui/Choice";
import { Textarea } from "@/components/ui/Input";
import { SERVING_OPTIONS, SUPPORT_CHIPS } from "@/lib/intake/options";
import { StepHeading } from "./ui";
import type { StepProps } from "./types";
import type { Companion } from "./useCompanion";

/**
 * The only screen with private writing on it, so it says in plain words who reads each part. Nothing here is ever
 * suggested or read by the assistant, and the first two are sealed before they are saved.
 */
export function CareStep({ answers, set, assistantOn, cmp }: StepProps & { assistantOn: boolean; cmp: Companion }) {
  const chips = answers.supportChips ?? [];
  const offer = cmp.on ? cmp.picks.serving : null;
  const offered = offer ? SERVING_OPTIONS.find((o) => o.id === offer.id) : undefined;
  const never = assistantOn ? " It is never shared with the AI service." : "";

  return (
    <>
      <StepHeading title="Anything you would like us to know?" hint="Every part of this screen is optional. You can finish without it." />
      <div className="flex flex-col gap-9">
        <section aria-labelledby="care-heading" className="flex flex-col gap-3">
          <h2 id="care-heading" className="t-heading">
            Anything that would help a tribe care for you well?
          </h2>
          <p className="t-small text-soft">
            Only you can read what you choose here. A tribe only ever learns how many of its members have asked for extra care, so none is overloaded.{never}
          </p>
          <div role="group" aria-labelledby="care-heading" className="flex flex-wrap gap-2.5">
            {SUPPORT_CHIPS.map((c) => (
              <Chip
                key={c.id}
                selected={chips.includes(c.id)}
                onClick={() => set({ supportChips: chips.includes(c.id) ? chips.filter((x) => x !== c.id) : [...chips, c.id] })}
              >
                {c.label}
              </Chip>
            ))}
          </div>
          <Textarea
            label="Anything else you want us to keep in mind"
            name="supportNote"
            rows={3}
            maxLength={600}
            optional
            value={answers.supportNote ?? ""}
            onChange={(e) => set({ supportNote: e.target.value })}
          />
        </section>

        <section className="flex flex-col gap-2">
          <Textarea
            label="A note for your leader"
            name="leaderNote"
            rows={3}
            maxLength={600}
            optional
            placeholder="e.g. I'm shy at first, and Sunday afternoons are best for me."
            value={answers.leaderNote ?? ""}
            onChange={(e) => set({ leaderNote: e.target.value })}
          />
          <p className="t-small text-soft">Your leader and assistant leader will read this before they meet you. Nobody else will.{never}</p>
        </section>

        <section aria-labelledby="serving-heading" className="flex flex-col gap-3">
          <h2 id="serving-heading" className="text-[0.95rem] font-medium">
            Would you like to help lead a tribe one day?
          </h2>
          {offer && offered && answers.openToServing !== offered.id ? (
            <Hint actionLabel={`Use “${offered.label}”`} actionName="open to leading a tribe" onUse={() => set({ openToServing: offered.id })}>
              {offer.reason ? `${offer.reason}. ` : ""}Shall I put <strong className="font-semibold">{offered.label}</strong>? It is only ever your call.
            </Hint>
          ) : null}
          <Segmented
            name="openToServing"
            label="Open to leading a tribe"
            value={answers.openToServing ?? null}
            options={SERVING_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(v) => set({ openToServing: v })}
          />
          <p className="t-small text-soft">No commitment. It only tells us who to invite to leader training.</p>
        </section>
      </div>
    </>
  );
}
