"use client";

import { Choice, Pair, Segmented } from "@/components/ui/Choice";
import { Input, Textarea } from "@/components/ui/Input";
import { normaliseWhatsapp } from "@/lib/intake/answers";
import { WHATSAPP_CONSENT } from "@/lib/intake/consent";
import {
  BASELINES,
  CIRCLE_MIXES,
  FAITH_JOURNEYS,
  GENDERS,
  MEETING_MODES,
  MEETING_TIMES,
  MONTHS,
  SERVING_OPTIONS,
  STYLE_PAIRS,
  ZONES,
} from "@/lib/intake/options";
import { SECTIONS, type StepId } from "@/lib/intake/steps";
import { Note, StepHeading } from "./ui";
import type { Catalogue, StepProps } from "./types";

export function RhythmStep({ answers, set }: StepProps) {
  const times = answers.times ?? [];
  const mode = MEETING_MODES.find((m) => m.id === answers.meetingMode);
  return (
    <>
      <StepHeading title="How and when could you meet?" hint="Pick every time that could work. More options means better matches." />
      <div className="flex flex-col gap-8">
        <section aria-labelledby="mode-heading">
          <h2 id="mode-heading" className="t-heading mb-3">
            How would you like to meet?
          </h2>
          <Segmented
            name="meetingMode"
            label="How you would like to meet"
            value={answers.meetingMode ?? null}
            options={MEETING_MODES.map((m) => ({ value: m.id, label: m.label }))}
            onChange={(v) => set({ meetingMode: v })}
          />
          {mode?.description ? <p className="t-small mt-2 text-soft">{mode.description}</p> : null}
        </section>

        <section aria-labelledby="times-heading">
          <h2 id="times-heading" className="t-heading mb-3">
            When could you meet?
          </h2>
          <div role="group" aria-labelledby="times-heading" className="grid gap-3 sm:grid-cols-2">
            {MEETING_TIMES.map((t) => (
              <Choice
                key={t.id}
                type="checkbox"
                name="times"
                value={t.id}
                checked={times.includes(t.id)}
                onChange={(e) => set({ times: e.target.checked ? [...times, t.id] : times.filter((x) => x !== t.id) })}
                title={t.label}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

export function StyleStep({ answers, set }: StepProps) {
  return (
    <>
      <StepHeading
        title="This or that?"
        hint="Six quick taps, no right answers. We use them to put you with people you will click with. Other members never see them."
      />
      <div className="stagger flex flex-col gap-3.5">
        {STYLE_PAIRS.map((pair, i) => (
          <div key={pair.key} style={{ ["--i" as string]: i }}>
            <Pair
              label={`${pair.left} or ${pair.right}`}
              left={pair.left}
              right={pair.right}
              value={(answers[pair.key] as -1 | 0 | 1 | undefined) ?? 0}
              onChange={(v) => set({ [pair.key]: v })}
            />
          </div>
        ))}
      </div>
      <p className="t-small mt-5 text-soft">Both sound like you? Leave it, or tap a choice again to clear it.</p>
    </>
  );
}

export function ExtrasStep({ answers, set, assistantNote }: StepProps & { assistantNote: boolean }) {
  const number = answers.whatsapp ?? "";
  const valid = !number.trim() || normaliseWhatsapp(number) !== null;
  return (
    <>
      <StepHeading title="Anything you would like us to know?" hint="Both of these are optional. You can finish without them." />
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Textarea
            label="Anything that would help us care for you well"
            name="supportNeeds"
            rows={4}
            maxLength={600}
            optional
            placeholder="e.g. I use a wheelchair, or I would prefer a quieter Tribe."
            value={answers.supportNeeds ?? ""}
            onChange={(e) => set({ supportNeeds: e.target.value })}
          />
          <p className="t-small text-soft">
            Only your leader and our care team will see this
            {assistantNote ? ", and it is never shared with the AI service" : ""}.
          </p>
        </div>

        <section aria-labelledby="serving-heading" className="flex flex-col gap-3">
          <h2 id="serving-heading" className="text-[0.95rem] font-medium">
            Would you like to help lead a Tribe one day?
          </h2>
          <Segmented
            name="openToServing"
            label="Open to leading a Tribe"
            value={answers.openToServing ?? null}
            options={SERVING_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(v) => set({ openToServing: v })}
          />
          <p className="t-small text-soft">No commitment. It only tells us who to invite to leader training.</p>
        </section>

        <div className="flex flex-col gap-3">
          <Input
            label="WhatsApp number"
            name="whatsapp"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            optional
            placeholder="0803 123 4567"
            value={number}
            onChange={(e) => set({ whatsapp: e.target.value })}
            error={valid ? null : "That doesn't look like a full number. Include your network code, like 0803 123 4567."}
            hint="For a reminder before each meeting. No groups, no spam."
          />
          {number.trim() && valid ? (
            <div className="rise-in">
              <Choice
                type="checkbox"
                name="whatsappOk"
                value="yes"
                checked={Boolean(answers.whatsappOk)}
                onChange={(e) => set({ whatsappOk: e.target.checked })}
                title={WHATSAPP_CONSENT}
              />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

type ReviewProps = StepProps & {
  catalogue: Catalogue;
  onEdit: (step: StepId) => void;
  error: string | null;
};

export function ReviewStep({ answers, catalogue, onEdit, error }: ReviewProps) {
  const age = catalogue.ageRanges.find((r) => r.slug === answers.ageRange);
  const tribe = catalogue.tribes.find((t) => t.slug === answers.tribe);
  const goal = tribe?.goals.find((g) => g.slug === answers.goal);
  const find = <T extends { id: string; label: string }>(list: readonly T[], id?: string) => list.find((o) => o.id === id)?.label;

  const birthday =
    answers.birthdayDay && answers.birthdayMonth ? `${answers.birthdayDay} ${MONTHS[answers.birthdayMonth - 1]}` : null;
  const first = answers.fullName?.trim().split(/\s+/)[0];
  const nameLine =
    answers.fullName?.trim()
      ? answers.preferredName && answers.preferredName.trim().toLowerCase() !== first?.toLowerCase()
        ? `${answers.fullName.trim()}, goes by ${answers.preferredName.trim()}`
        : answers.fullName.trim()
      : (answers.preferredName ?? null);
  const rows: Record<string, { step: StepId; label: string; value: string | null }[]> = {
    you: [
      { step: "age", label: "Age", value: [age?.label, birthday && `birthday ${birthday}`].filter(Boolean).join(", ") || null },
      { step: "name", label: "Name", value: nameLine },
      { step: "gender", label: "Gender", value: find(GENDERS, answers.gender) ?? null },
      { step: "gender", label: "Tribe mix", value: find(CIRCLE_MIXES, answers.circleMix) ?? null },
      { step: "where", label: "Based in", value: [find(ZONES, answers.zone), answers.areaNote].filter(Boolean).join(", ") },
    ],
    season: [
      { step: "story", label: "Your story", value: answers.story?.trim() || null },
      { step: "tribe", label: "Tribe", value: tribe?.name ?? answers.tribeOther ?? null },
      { step: "faith", label: "Walk with God", value: find(FAITH_JOURNEYS, answers.faith) ?? null },
    ],
    goal: [
      { step: "goal", label: "Goal", value: goal?.title ?? answers.goalOther ?? null },
      { step: "success", label: "In twelve weeks", value: answers.successStatement?.trim() || null },
      { step: "success", label: "Today", value: answers.baseline ? `${answers.baseline} of 5, ${BASELINES[answers.baseline - 1].label.toLowerCase()}` : null },
    ],
    rhythm: [
      { step: "rhythm", label: "Meeting", value: find(MEETING_MODES, answers.meetingMode) ?? null },
      { step: "rhythm", label: "Times that work", value: (answers.times ?? []).map((t) => find(MEETING_TIMES, t)).filter(Boolean).join(", ") || null },
      { step: "style", label: "This or that", value: STYLE_PAIRS.some((p) => answers[p.key]) ? `${STYLE_PAIRS.filter((p) => answers[p.key]).length} of 6 answered` : null },
      { step: "extras", label: "Leading a Tribe", value: SERVING_OPTIONS.find((o) => o.id === answers.openToServing)?.label ?? null },
      { step: "extras", label: "WhatsApp", value: answers.whatsapp?.trim() ? (normaliseWhatsapp(answers.whatsapp) ?? answers.whatsapp) : null },
    ],
  };

  return (
    <>
      <StepHeading title="Here is what we have." hint="Check it over. Tap Change on anything you would like to fix." />
      <div className="stagger flex flex-col gap-4">
        {SECTIONS.map((section, i) => (
          <section key={section.id} className="card overflow-hidden" style={{ ["--i" as string]: i }} aria-labelledby={`review-${section.id}`}>
            <h2 id={`review-${section.id}`} className="t-heading flex items-center gap-2.5 border-b border-line px-5 py-3.5">
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-[4px]"
                style={{ background: ["var(--crest-charcoal)", "var(--crest-flame)", "var(--crest-gold)", "var(--crest-amber)"][i] }}
              />
              {section.label}
            </h2>
            <dl className="divide-y divide-line">
              {rows[section.id].map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <dt className="t-small text-soft">{row.label}</dt>
                    <dd className="mt-0.5 break-words font-medium">{row.value || <span className="font-normal text-soft">Skipped</span>}</dd>
                  </div>
                  <button
                    type="button"
                    onClick={() => onEdit(row.step)}
                    className="press -mr-2 min-h-11 shrink-0 rounded-lg px-2 text-[0.9rem] font-semibold text-accent underline underline-offset-4"
                  >
                    Change<span className="sr-only"> {row.label}</span>
                  </button>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      {error ? (
        <div className="mt-5" role="alert">
          <Note tone="info">{error}</Note>
        </div>
      ) : null}
    </>
  );
}
