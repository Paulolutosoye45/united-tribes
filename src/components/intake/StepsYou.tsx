"use client";

import { useState } from "react";
import { Choice } from "@/components/ui/Choice";
import { Input, Select } from "@/components/ui/Input";
import { DAYS_IN_MONTH, GENDERS, TRIBE_MIXES, MONTHS, ZONES } from "@/lib/intake/options";
import { TEENS } from "@/lib/intake/answers";
import { AreaInput } from "./AreaInput";
import { Note, StepHeading } from "./ui";
import type { Catalogue, StepProps } from "./types";

export function AgeStep({ answers, set, catalogue, teensOpen = false }: StepProps & { catalogue: Catalogue; teensOpen?: boolean }) {
  const [showBirthday, setShowBirthday] = useState(answers.birthdayDay !== undefined);
  const month = answers.birthdayMonth;
  const maxDay = month ? DAYS_IN_MONTH[month - 1] : 31;

  return (
    <>
      <StepHeading title="How old are you?" hint="A range is plenty. It helps us place you with people in a similar season of life." />
      <div role="radiogroup" aria-label="Age range" className="stagger grid grid-cols-2 gap-3">
        {catalogue.ageRanges.map((r, i) => (
          <Choice
            key={r.slug}
            name="age"
            value={r.slug}
            checked={answers.ageRange === r.slug}
            onChange={() => set({ ageRange: r.slug })}
            title={r.label}
            description={r.open ? undefined : "Opens soon"}
            className="min-h-[4.25rem]"
            style={{ ["--i" as string]: i }}
          />
        ))}
      </div>

      {answers.ageRange === TEENS && !teensOpen ? (
        <div className="pop-in mt-5">
          <Note tone="info">
            Tribes for teens open in a later release, with a parent or guardian&rsquo;s permission. Nothing you have entered
            here is kept. We&rsquo;d love to see you then.
          </Note>
        </div>
      ) : (
        <>
        {answers.ageRange === TEENS ? (
          <div className="pop-in mt-5">
            <Note tone="info">
              Because you are under 18, a parent or guardian will need to say yes before we show you tribes. When you finish the form, we will ask for their contact
              details and send them a private link. You will be placed in a tribe with young people your age, led by two adults.
            </Note>
          </div>
        ) : null}
        <div className="mt-6">
          {showBirthday ? (
            <div className="pop-in card flex flex-col gap-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Month"
                  value={answers.birthdayMonth ?? ""}
                  onChange={(e) => {
                    const m = e.target.value ? Number(e.target.value) : undefined;
                    const cap = m ? DAYS_IN_MONTH[m - 1] : 31;
                    set({
                      birthdayMonth: m,
                      birthdayDay: answers.birthdayDay && answers.birthdayDay > cap ? undefined : answers.birthdayDay,
                    });
                  }}
                >
                  <option value="">Month</option>
                  {MONTHS.map((name, i) => (
                    <option key={name} value={i + 1}>
                      {name}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Day"
                  value={answers.birthdayDay ?? ""}
                  onChange={(e) => set({ birthdayDay: e.target.value ? Number(e.target.value) : undefined })}
                >
                  <option value="">Day</option>
                  {Array.from({ length: maxDay }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="t-small text-soft">Day and month only, so we can celebrate you. We never show anyone your age.</p>
              <button
                type="button"
                className="press t-small w-fit font-semibold underline underline-offset-4"
                onClick={() => {
                  set({ birthdayDay: undefined, birthdayMonth: undefined });
                  setShowBirthday(false);
                }}
              >
                Remove birthday
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowBirthday(true)}
              className="press flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] border-[1.5px] border-dashed border-line px-4 text-left text-[0.95rem] text-soft hover:border-soft hover:text-ink"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h16M6 20v-7h12v7M12 13V9M12 9c-1 0-1.6-.8-1.6-1.6S12 5 12 5s1.6 1.6 1.6 2.4S13 9 12 9Z" />
              </svg>
              <span>
                Add your birthday <span className="text-soft">(optional, so we can celebrate you)</span>
              </span>
            </button>
          )}
        </div>
        </>
      )}

      {answers.ageRange && answers.ageRange !== TEENS ? (
        <div className="rise-in mt-6">
          <Choice
            type="checkbox"
            name="openToAdjacent"
            value="yes"
            checked={Boolean(answers.openToAdjacent)}
            onChange={(e) => set({ openToAdjacent: e.target.checked })}
            title="I’d also be happy in a tribe with the age group just before or after mine"
            description="More tribes to choose from. We’ll still show your own age group first."
          />
        </div>
      ) : null}
    </>
  );
}

export function NameStep({ answers, set }: StepProps) {
  return (
    <>
      <StepHeading title="What should we call you?" hint="Your leader and your tribe will use this name." />
      <div className="stagger flex flex-col gap-5">
        <div style={{ ["--i" as string]: 0 }}>
          <Input
            label="First name or what you go by"
            name="preferredName"
            autoComplete="given-name"
            placeholder="e.g. Tunde"
            maxLength={40}
            value={answers.preferredName ?? ""}
            onChange={(e) => set({ preferredName: e.target.value })}
          />
        </div>
        <div style={{ ["--i" as string]: 1 }}>
          <Input
            label="Full name"
            name="fullName"
            autoComplete="name"
            placeholder="So your leader can welcome you properly"
            maxLength={80}
            optional
            value={answers.fullName ?? ""}
            onChange={(e) => set({ fullName: e.target.value })}
          />
        </div>
      </div>
    </>
  );
}

export function GenderStep({ answers, set }: StepProps) {
  return (
    <>
      <StepHeading title="Which describes you?" hint="Some tribes are for men or women only, especially when the topics are personal." />
      <div role="radiogroup" aria-label="Gender" className="stagger flex flex-col gap-3">
        {GENDERS.map((g, i) => (
          <Choice
            key={g.id}
            name="gender"
            value={g.id}
            checked={answers.gender === g.id}
            onChange={() => set({ gender: g.id })}
            title={g.label}
            style={{ ["--i" as string]: i }}
          />
        ))}
      </div>

      {answers.gender ? (
        <section className="rise-in mt-9" aria-labelledby="mix-heading">
          <h2 id="mix-heading" className="t-heading mb-3">
            What kind of tribe would feel right?
          </h2>
          <div role="radiogroup" aria-labelledby="mix-heading" className="flex flex-col gap-3">
            {TRIBE_MIXES.map((m) => (
              <Choice
                key={m.id}
                name="tribeMix"
                value={m.id}
                checked={answers.tribeMix === m.id}
                onChange={() => set({ tribeMix: m.id })}
                title={m.label}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export function WhereStep({ answers, set }: StepProps) {
  const abroad = answers.zone === "abroad";
  return (
    <>
      <StepHeading title="Where are you based?" hint="Start typing your area. This helps us find a tribe near you, or one that meets at a time that suits your country." />
      <div className="mb-8">
        <AreaInput
          value={answers.areaNote ?? ""}
          slug={answers.areaSlug}
          abroad={abroad}
          onType={(text) => set({ areaNote: text, areaSlug: undefined })}
          onPick={(area) => set({ areaNote: area.name, areaSlug: area.slug, zone: area.zone })}
        />
      </div>
      <h2 id="zone-heading" className="t-heading mb-3">
        {answers.zone ? "Your part of the world" : "Or choose the nearest"}
      </h2>
      <div role="radiogroup" aria-labelledby="zone-heading" className="stagger flex flex-col gap-3">
        {ZONES.map((z, i) => (
          <Choice
            key={z.id}
            name="zone"
            value={z.id}
            checked={answers.zone === z.id}
            onChange={() => set({ zone: z.id })}
            title={z.label}
            description={z.description}
            style={{ ["--i" as string]: i }}
          />
        ))}
      </div>
    </>
  );
}
