"use client";

import { useState } from "react";
import { Choice } from "@/components/ui/Choice";
import { Input, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { FAITH_JOURNEYS, STORY_EXAMPLES } from "@/lib/intake/options";
import { MicButton, ScaleInput, SkeletonChoice, StepHeading, SuggestionLabel } from "./ui";
import type { Catalogue, StepProps } from "./types";
import { useDictation } from "./useDictation";
import type { SuggestEntry } from "./useSuggestions";

const append = (current: string | undefined, add: string, max: number) =>
  `${current?.trim() ? `${current.trim()} ` : ""}${add}`.slice(0, max);

export function StoryStep({ answers, set, assistant }: StepProps & { assistant: "on" | "off" | "unavailable" }) {
  const dictation = useDictation((text) => set({ story: append(answers.story, text, 1500) }));
  const value = answers.story ?? "";

  const hint =
    assistant === "on"
      ? "A sentence or two, in your own words. We use it to suggest your tribe and goal, so you can tap instead of type. You can skip this."
      : assistant === "off"
        ? "A sentence or two helps your leader welcome you. Because you chose not to use the assistant, nobody but our team reads it. You can skip this."
        : "A sentence or two helps your leader welcome you. You can skip this.";

  return (
    <>
      <StepHeading title="Tell us about your season." hint={hint} />
      <div className="relative">
        <Textarea
          label="Your season, in your words"
          name="story"
          rows={5}
          maxLength={1500}
          placeholder="e.g. I just lost my job and I'm trusting God for the next door."
          value={value}
          onChange={(e) => set({ story: e.target.value })}
          className="min-h-44 pb-14 text-[1.05rem]"
          hint={dictation.error ?? (dictation.listening ? "Listening… speak now." : undefined)}
        />
        {dictation.supported ? <MicButton listening={dictation.listening} onClick={dictation.listening ? dictation.stop : dictation.start} /> : null}
      </div>

      <div className="mt-6">
        <p className="t-small mb-2 text-soft">Not sure what to write? Tap one and change it.</p>
        <div className="flex flex-wrap gap-2">
          {STORY_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => set({ story: ex })}
              className="press rounded-full border border-line bg-raised px-3.5 py-2 text-left text-[0.88rem] leading-snug text-soft hover:border-soft hover:text-ink"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

type SuggestProps = { entry: SuggestEntry | null; enabled: boolean };

export function TribeStep({
  answers,
  set,
  catalogue,
  suggestions,
  onPick,
}: StepProps & { catalogue: Catalogue; suggestions: SuggestProps; onPick: (slug: string) => void }) {
  const [other, setOther] = useState(Boolean(answers.tribeOther));
  const { entry, enabled } = suggestions;
  const suggestedIds = new Map((entry?.items ?? []).map((i) => [i.id, i.reason]));
  const suggested = catalogue.tribes.filter((t) => suggestedIds.has(t.slug));
  const rest = catalogue.tribes.filter((t) => !suggestedIds.has(t.slug));
  const loading = enabled && entry?.status === "loading";

  function pick(slug: string) {
    setOther(false);
    set({ tribe: slug, tribeOther: undefined, goal: answers.tribe === slug ? answers.goal : undefined });
    onPick(slug);
  }

  return (
    <>
      <StepHeading title="Which tribe feels like home right now?" hint="Your tribe is the group of people in a similar field or stage of life. Pick the closest one. You can describe your own below." />

      {loading || suggested.length > 0 ? (
        <section className="mb-8" aria-label="Suggested for you">
          <SuggestionLabel loading={loading}>{loading ? "Reading your story" : "Suggested for you"}</SuggestionLabel>
          <div role="radiogroup" aria-label="Suggested tribes" className="flex flex-col gap-3">
            {loading ? <SkeletonChoice /> : null}
            {suggested.map((t) => (
              <Choice
                key={t.slug}
                name="tribe"
                value={t.slug}
                checked={answers.tribe === t.slug}
                onChange={() => pick(t.slug)}
                title={t.name}
                description={t.description}
                suggested
                reason={suggestedIds.get(t.slug)}
                className="pop-in"
              />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label={suggested.length > 0 ? "More tribes" : "All tribes"}>
        {suggested.length > 0 ? <h2 className="t-heading mb-3">More tribes</h2> : null}
        <div role="radiogroup" aria-label="Tribes" className="flex flex-col gap-3">
          {rest.map((t) => (
            <Choice
              key={t.slug}
              name="tribe"
              value={t.slug}
              checked={answers.tribe === t.slug}
              onChange={() => pick(t.slug)}
              title={t.name}
              description={t.description}
            />
          ))}
          <Choice
            name="tribe"
            value="__other"
            checked={other}
            onChange={() => {
              setOther(true);
              set({ tribe: undefined, goal: undefined });
            }}
            title="None of these fit"
            description="Describe your own in a few words"
          />
        </div>
        {other ? (
          <div className="rise-in mt-4">
            <Input
              label="Describe your tribe"
              name="tribeOther"
              placeholder="e.g. Pastors’ wives, or Farmers"
              maxLength={120}
              value={answers.tribeOther ?? ""}
              onChange={(e) => set({ tribeOther: e.target.value })}
              autoFocus
            />
          </div>
        ) : null}
      </section>
    </>
  );
}

export function FaithStep({ answers, set }: StepProps) {
  return (
    <>
      <StepHeading title="Where are you on your walk with God?" hint="There is no wrong answer. It helps us place you with people at a similar pace." />
      <div role="radiogroup" aria-label="Your walk with God" className="stagger flex flex-col gap-3">
        {FAITH_JOURNEYS.map((f, i) => (
          <Choice
            key={f.id}
            name="faith"
            value={f.id}
            checked={answers.faith === f.id}
            onChange={() => set({ faith: f.id })}
            title={f.label}
            description={f.description}
            style={{ ["--i" as string]: i }}
          />
        ))}
      </div>
    </>
  );
}

export function GoalStep({
  answers,
  set,
  catalogue,
  suggestions,
  onPick,
}: StepProps & { catalogue: Catalogue; suggestions: SuggestProps; onPick: (slug: string) => void }) {
  const tribe = catalogue.tribes.find((t) => t.slug === answers.tribe);
  const [other, setOther] = useState(Boolean(answers.goalOther) || !tribe);
  const { entry, enabled } = suggestions;
  const goals = tribe?.goals ?? [];
  const suggestedIds = new Map((entry?.items ?? []).map((i) => [i.id, i.reason]));
  const suggested = goals.filter((g) => suggestedIds.has(g.slug));
  const rest = goals.filter((g) => !suggestedIds.has(g.slug));
  const loading = enabled && entry?.status === "loading";

  function pick(slug: string) {
    setOther(false);
    set({ goal: slug, goalOther: undefined });
    onPick(slug);
  }

  return (
    <>
      <StepHeading
        title="What do you want to move forward this season?"
        hint={tribe ? `These goals come from your tribe, ${tribe.name}. Your Tribe will work on one together for twelve weeks.` : "Describe it in a few words. Your Tribe will work on a shared goal together for twelve weeks."}
      />

      {tribe && (loading || suggested.length > 0) ? (
        <section className="mb-8" aria-label="Suggested for you">
          <SuggestionLabel loading={loading}>{loading ? "Reading your story" : "Suggested for you"}</SuggestionLabel>
          <div role="radiogroup" aria-label="Suggested goals" className="flex flex-col gap-3">
            {loading ? <SkeletonChoice /> : null}
            {suggested.map((g) => (
              <Choice
                key={g.slug}
                name="goal"
                value={g.slug}
                checked={answers.goal === g.slug}
                onChange={() => pick(g.slug)}
                title={g.title}
                suggested
                reason={suggestedIds.get(g.slug)}
                className="pop-in"
              />
            ))}
          </div>
        </section>
      ) : null}

      {tribe ? (
        <div role="radiogroup" aria-label="Goals" className="flex flex-col gap-3">
          {rest.map((g) => (
            <Choice key={g.slug} name="goal" value={g.slug} checked={answers.goal === g.slug} onChange={() => pick(g.slug)} title={g.title} />
          ))}
          <Choice
            name="goal"
            value="__other"
            checked={other}
            onChange={() => {
              setOther(true);
              set({ goal: undefined });
            }}
            title="Something else"
            description="Write your own goal"
          />
        </div>
      ) : null}

      {other ? (
        <div className={cn("rise-in", tribe && "mt-4")}>
          <Textarea
            label="Your goal"
            name="goalOther"
            rows={3}
            maxLength={160}
            placeholder="e.g. Start a ministry for young mothers"
            value={answers.goalOther ?? ""}
            onChange={(e) => set({ goalOther: e.target.value })}
            className="min-h-24"
          />
        </div>
      ) : null}
    </>
  );
}

export function SuccessStep({ answers, set, goalTitle }: StepProps & { goalTitle: string | null }) {
  const dictation = useDictation((text) => set({ successStatement: append(answers.successStatement, text, 240) }));
  return (
    <>
      <StepHeading
        title="In twelve weeks, what would you love to say?"
        hint={goalTitle ? `Picture the end of your season on “${goalTitle}”. Your Tribe will share this picture and cheer each other on.` : "Picture the end of your season. Your Tribe will share this picture and cheer each other on."}
      />
      <div className="flex flex-col gap-8">
        <div className="relative">
          <Textarea
            label="Your picture of success"
            name="successStatement"
            rows={3}
            maxLength={240}
            optional
            placeholder="e.g. I registered my business and paid my first staff."
            value={answers.successStatement ?? ""}
            onChange={(e) => set({ successStatement: e.target.value })}
            className="pb-14"
            hint={dictation.error ?? (dictation.listening ? "Listening… speak now." : undefined)}
          />
          {dictation.supported ? <MicButton listening={dictation.listening} onClick={dictation.listening ? dictation.stop : dictation.start} /> : null}
        </div>

        <section aria-labelledby="baseline-heading">
          <h2 id="baseline-heading" className="t-heading mb-3">
            Where are you on this goal today?
          </h2>
          <ScaleInput label="Where you are on this goal today" value={answers.baseline} onChange={(n) => set({ baseline: n })} />
          <p className="t-small mt-3 text-soft">We ask again at the end of the season, so you can see how far you have come.</p>
        </section>
      </div>
    </>
  );
}

