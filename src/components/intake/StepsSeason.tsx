"use client";

import { useEffect, useRef, useState } from "react";
import { CompanionSwitch, Hint, Listening, PickNote, Starters, fitWord } from "@/components/companion/Companion";
import { Choice } from "@/components/ui/Choice";
import { Chip, Sparkle } from "@/components/ui/Chip";
import { Input, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { outcomeSentences, secondChoice } from "@/lib/companion";
import { FAITH_JOURNEYS, STORY_EXAMPLES } from "@/lib/intake/options";
import { MicButton, ScaleInput, SkeletonChoice, StepHeading, SuggestionLabel } from "./ui";
import type { Catalogue, StepProps } from "./types";
import { useDictation } from "./useDictation";
import type { Companion } from "./useCompanion";
import type { DraftState } from "./useSuggestions";
import { MAX_VOICE_SECONDS, useVoiceNote } from "./useVoiceNote";

const append = (current: string | undefined, add: string, max: number) =>
  `${current?.trim() ? `${current.trim()} ` : ""}${add}`.slice(0, max);

const clock = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;

export function StoryStep({
  answers,
  set,
  assistant,
  voice,
  cmp,
}: StepProps & { assistant: "on" | "off" | "unavailable"; voice: boolean; cmp: Companion }) {
  const dictation = useDictation((text) => set({ story: append(answers.story, text, 1500) }));
  const note = useVoiceNote({ enabled: voice && assistant === "on", onText: (text) => set({ story: append(answers.story, text, 1500) }) });
  const value = answers.story ?? "";
  const writing = value.trim().length >= 12;

  const hint =
    assistant === "on"
      ? "A sentence or two, in your own words, or a voice note of up to a minute. We use it to suggest your community and goal, so you can tap instead of type. You can skip this."
      : assistant === "off"
        ? "A sentence or two helps your leader welcome you. Because you chose not to use the assistant, nobody but our team reads it. You can skip this."
        : "A sentence or two helps your leader welcome you. You can skip this.";

  const status =
    note.state === "recording"
      ? `Recording… ${clock(note.seconds)} of ${clock(MAX_VOICE_SECONDS)}. Tap the microphone to stop.`
      : note.state === "working"
        ? "Turning your voice into words…"
        : (note.error ?? dictation.error ?? (dictation.listening ? "Listening… speak now." : undefined));

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
          hint={status}
        />
        {note.supported ? (
          <MicButton
            listening={note.state === "recording"}
            busy={note.state === "working"}
            onClick={note.state === "recording" ? note.stop : () => void note.start()}
            label="Record a voice note, up to one minute"
            stopLabel="Stop recording"
          />
        ) : dictation.supported ? (
          <MicButton listening={dictation.listening} onClick={dictation.listening ? dictation.stop : dictation.start} />
        ) : null}
      </div>
      {note.supported ? (
        <p className="t-small mt-2 text-soft">We turn your voice into words and delete the recording straight away. You can fix the words before you go on.</p>
      ) : null}

      {cmp.on && cmp.reads && writing ? <Listening cmp={cmp} /> : null}
      {!writing ? (
        <Starters
          items={cmp.on ? cmp.starters : STORY_EXAMPLES}
          onPick={(text) => set({ story: text })}
          heading={cmp.on ? "Not sure what to write? Here are some for people like you. Tap one and make it yours." : "Not sure what to write? Tap one and change it."}
        />
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        {cmp.on && cmp.reads ? (
          <p className="t-small text-soft">
            {assistant === "on"
              ? "I read as you type, on your phone. When you tap Continue, your words also go to the AI assistant you agreed to."
              : "I read as you type, on your phone. Your words do not go to any AI service."}
          </p>
        ) : null}
        <CompanionSwitch cmp={cmp} />
      </div>
    </>
  );
}

/** Up to three picks to show together: the real fits, and only when there are none, a few places to start. */
function offered<T extends { tier: string }>(picks: readonly T[]): T[] {
  const real = picks.filter((p) => p.tier !== "guess");
  return (real.length > 0 ? real : picks).slice(0, 3);
}

type Offer = { cmp: Companion; /** The AI service has been asked and has not yet answered. */ loading: boolean };

export function CommunityStep({ answers, set, catalogue, cmp, loading }: StepProps & { catalogue: Catalogue } & Offer) {
  const [other, setOther] = useState(Boolean(answers.communityOther));
  const top = cmp.on ? offered(cmp.picks.community) : [];
  const byId = new Map(top.map((p) => [p.id, p]));
  const suggested = top.flatMap((p) => catalogue.communities.filter((t) => t.slug === p.id));
  const rest = catalogue.communities.filter((t) => !byId.has(t.slug));
  const mine = cmp.picked("community") && answers.community ? byId.get(answers.community) : undefined;
  const second = cmp.on && answers.community ? secondChoice(cmp.picks.community, answers.community) : null;
  const wait = loading && cmp.on;

  function pick(slug: string) {
    setOther(false);
    set({
      community: slug,
      communityOther: undefined,
      ...(answers.community !== slug ? { goal: undefined } : {}),
      ...(answers.secondCommunity === slug ? { secondCommunity: undefined } : {}),
    });
    // A new first choice means the goal is chosen again, and the Companion may suggest a new second choice.
    if (answers.community !== slug) cmp.release("goal");
    if (answers.secondCommunity === slug) cmp.release("secondCommunity");
  }

  const heading = mine ? "Picked for you" : top[0]?.tier === "guess" ? "Where people like you often start" : "Suggested for you";

  return (
    <>
      <StepHeading title="Which community feels like home right now?" hint="Your community is the group of people in a similar field or stage of life. Pick the closest one. You can describe your own below." />

      {wait || suggested.length > 0 ? (
        <section className="mb-8" aria-label="Suggested for you">
          <SuggestionLabel loading={wait}>{wait && suggested.length === 0 ? "Reading your story" : heading}</SuggestionLabel>
          <div role="radiogroup" aria-label="Suggested communities" className="flex flex-col gap-3">
            {wait && suggested.length === 0 ? <SkeletonChoice /> : null}
            {suggested.map((t) => {
              const p = byId.get(t.slug)!;
              const isMine = mine?.id === t.slug;
              return (
                <div key={t.slug}>
                  <Choice
                    name="community"
                    value={t.slug}
                    checked={answers.community === t.slug}
                    onChange={() => pick(t.slug)}
                    title={t.name}
                    description={t.description}
                    suggested
                    badge={isMine ? undefined : fitWord(p)}
                    reason={isMine ? undefined : p.reason}
                    className="pop-in"
                  />
                  {isMine ? <PickNote pick={p} name={t.name} onReject={() => cmp.reject("community", t.slug)} /> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section aria-label={suggested.length > 0 ? "More communities" : "All communities"}>
        {suggested.length > 0 ? <h2 className="t-heading mb-3">More communities</h2> : null}
        <div role="radiogroup" aria-label="Communities" className="flex flex-col gap-3">
          {rest.map((t) => (
            <Choice
              key={t.slug}
              name="community"
              value={t.slug}
              checked={answers.community === t.slug}
              onChange={() => pick(t.slug)}
              title={t.name}
              description={t.description}
            />
          ))}
          <Choice
            name="community"
            value="__other"
            checked={other}
            onChange={() => {
              setOther(true);
              set({ community: undefined, goal: undefined, secondCommunity: undefined });
            }}
            title="None of these fit"
            description="Describe your own in a few words"
          />
        </div>
        {answers.community && !other ? (
          <section className="rise-in mt-8" aria-labelledby="second-heading">
            <h2 id="second-heading" className="t-heading flex items-baseline gap-2">
              A second choice?
              <span className="t-small font-normal text-soft">Optional</span>
            </h2>
            <p className="t-small mb-3 mt-1 text-soft">If your first choice has no room, we look at this one next.</p>
            <div role="group" aria-labelledby="second-heading" className="flex flex-wrap gap-2.5">
              {catalogue.communities
                .filter((t) => t.slug !== answers.community)
                .map((t) => (
                  <Chip
                    key={t.slug}
                    selected={answers.secondCommunity === t.slug}
                    suggested={second?.id === t.slug}
                    onClick={() => set({ secondCommunity: answers.secondCommunity === t.slug ? undefined : t.slug })}
                  >
                    {t.name}
                  </Chip>
                ))}
            </div>
            {second?.reason && answers.secondCommunity === second.id ? <p className="t-small mt-2 text-accent">{second.reason}</p> : null}
          </section>
        ) : null}

        {other ? (
          <div className="rise-in mt-4">
            <Input
              label="Describe your community"
              name="communityOther"
              placeholder="e.g. Pastors’ wives, or Farmers"
              maxLength={120}
              value={answers.communityOther ?? ""}
              onChange={(e) => set({ communityOther: e.target.value })}
              autoFocus
            />
          </div>
        ) : null}
      </section>
      <CompanionSwitch cmp={cmp} className="mt-8" />
    </>
  );
}

export function FaithStep({ answers, set, cmp }: StepProps & { cmp: Companion }) {
  const offer = cmp.on ? cmp.picks.faith : null;
  const option = offer ? FAITH_JOURNEYS.find((f) => f.id === offer.id) : undefined;
  return (
    <>
      <StepHeading title="Where are you on your walk with God?" hint="There is no wrong answer. It helps us place you with people at a similar pace." />
      {offer && option && answers.faith !== offer.id ? (
        <Hint actionLabel={`Use “${option.label}”`} actionName="where you are on your walk with God" onUse={() => set({ faith: option.id })}>
          {offer.reason ? `${offer.reason}. ` : ""}Does <strong className="font-semibold">{option.label}</strong> fit? It is only ever your call.
        </Hint>
      ) : null}
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

export function GoalStep({ answers, set, catalogue, cmp, loading }: StepProps & { catalogue: Catalogue } & Offer) {
  const community = catalogue.communities.find((t) => t.slug === answers.community);
  const [other, setOther] = useState(Boolean(answers.goalOther) || !community);
  const goals = community?.goals ?? [];
  const top = cmp.on ? offered(cmp.picks.goal) : [];
  const byId = new Map(top.map((p) => [p.id, p]));
  const suggested = top.flatMap((p) => goals.filter((g) => g.slug === p.id));
  const rest = goals.filter((g) => !byId.has(g.slug));
  const mine = cmp.picked("goal") && answers.goal ? byId.get(answers.goal) : undefined;
  const wait = loading && cmp.on;

  function pick(slug: string) {
    setOther(false);
    set({ goal: slug, goalOther: undefined });
  }

  const heading = mine ? "Picked for you" : top[0]?.tier === "guess" ? "Where people like you often start" : "Suggested for you";

  return (
    <>
      <StepHeading
        title="What do you want to move forward this season?"
        hint={community ? `These goals come from your community, ${community.name}. Your tribe will work on one together for twelve weeks.` : "Describe it in a few words. Your tribe will work on a shared goal together for twelve weeks."}
      />

      {community && (wait || suggested.length > 0) ? (
        <section className="mb-8" aria-label="Suggested for you">
          <SuggestionLabel loading={wait}>{wait && suggested.length === 0 ? "Reading your story" : heading}</SuggestionLabel>
          <div role="radiogroup" aria-label="Suggested goals" className="flex flex-col gap-3">
            {wait && suggested.length === 0 ? <SkeletonChoice /> : null}
            {suggested.map((g) => {
              const p = byId.get(g.slug)!;
              const isMine = mine?.id === g.slug;
              return (
                <div key={g.slug}>
                  <Choice
                    name="goal"
                    value={g.slug}
                    checked={answers.goal === g.slug}
                    onChange={() => pick(g.slug)}
                    title={g.title}
                    suggested
                    badge={isMine ? undefined : fitWord(p)}
                    reason={isMine ? undefined : p.reason}
                    className="pop-in"
                  />
                  {isMine ? <PickNote pick={p} name={g.title} onReject={() => cmp.reject("goal", g.slug)} /> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {community ? (
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
        <div className={cn("rise-in", community && "mt-4")}>
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

export function SuccessStep({
  answers,
  set,
  goalTitle,
  draft,
  cmp,
}: StepProps & { goalTitle: string | null; draft: DraftState; cmp: Companion }) {
  const dictation = useDictation((text) => set({ successStatement: append(answers.successStatement, text, 240) }));

  // Put the drafted sentence in the box, but only while the person has not made it their own.
  const lastDraft = useRef("");
  useEffect(() => {
    if (draft.status !== "ready" || !draft.text) return;
    const untouched = !answers.successStatement?.trim() || answers.successStatement === lastDraft.current;
    if (untouched && answers.successStatement !== draft.text) set({ successStatement: draft.text });
    lastDraft.current = draft.text;
    // Only when a new draft arrives: typing must never be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.status, draft.text]);

  const loading = draft.status === "loading";
  const changed = draft.status === "ready" && draft.text && answers.successStatement !== draft.text;
  const outcomes = cmp.on ? outcomeSentences(answers.goal).filter((text) => text !== answers.successStatement) : [];
  const level = cmp.on ? cmp.picks.baseline : null;
  const levelLabel = level ? Number(level.id) : null;

  return (
    <>
      <StepHeading
        title="In twelve weeks, what would you love to say?"
        hint={goalTitle ? `Picture the end of your season on “${goalTitle}”. Your tribe will share this picture and cheer each other on.` : "Picture the end of your season. Your tribe will share this picture and cheer each other on."}
      />
      <div className="flex flex-col gap-8">
        <div>
          {loading ? <SuggestionLabel loading>Drafting a sentence in your words</SuggestionLabel> : null}
          {draft.status === "ready" && draft.text ? (
            <p className="mb-3 flex items-center gap-2 text-[0.95rem] font-semibold">
              {draft.ai ? <Sparkle size={16} /> : null}
              <span>{draft.ai ? "Suggested for you. Change it to sound like you." : "A starting point. Change it to sound like you."}</span>
            </p>
          ) : null}
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
          {changed ? (
            <button
              type="button"
              onClick={() => set({ successStatement: draft.text })}
              className="press t-small mt-2 min-h-11 font-semibold underline underline-offset-4"
            >
              Use the suggestion again
            </button>
          ) : null}
          {outcomes.length > 0 ? (
            <div className="mt-4">
              <p className="t-small mb-2 text-soft">Or start from another picture. Tap one, then change it so it sounds like you.</p>
              <div className="flex flex-col gap-2">
                {outcomes.map((text) => (
                  <button key={text} type="button" onClick={() => set({ successStatement: text })} className="cmp-starter press">
                    {text}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <section aria-labelledby="baseline-heading">
          <h2 id="baseline-heading" className="t-heading mb-3">
            Where are you on this goal today?
          </h2>
          {level && levelLabel && answers.baseline !== levelLabel ? (
            <Hint actionLabel={`Use ${levelLabel}`} actionName="where you are on this goal today" onUse={() => set({ baseline: levelLabel as 1 | 2 | 3 | 4 | 5 })}>
              {level.reason ? `${level.reason}. ` : ""}That sounds like a {levelLabel} out of 5.
            </Hint>
          ) : null}
          <ScaleInput label="Where you are on this goal today" value={answers.baseline} onChange={(n) => set({ baseline: n })} />
          <p className="t-small mt-3 text-soft">We ask again at the end of the season, so you can see how far you have come.</p>
        </section>
      </div>
    </>
  );
}
