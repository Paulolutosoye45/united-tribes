"use client";

import Link from "next/link";
import { useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { Choice, Pair, Segmented } from "@/components/ui/Choice";
import { Input, Textarea } from "@/components/ui/Input";
import { MicButton, Note, ScaleInput, StepHeading } from "@/components/intake/ui";
import { useDictation } from "@/components/intake/useDictation";
import { cn } from "@/lib/cn";
import { hasWords, normaliseWhatsapp } from "@/lib/intake/answers";
import { STYLE_PAIRS } from "@/lib/intake/options";
import { charsToGo, type LeaderAnswers, type RefereeInput } from "@/lib/leaders/answers";
import {
  ELIGIBILITY,
  GOAL_RELATIONS,
  LEAD_BEST,
  REFEREE_RELATIONSHIPS,
  WALK_LABELS,
} from "@/lib/leaders/options";
import { SCENARIOS, SCENARIO_IDS, shuffled, type OptionId, type ScenarioId } from "@/lib/leaders/scenarios";
import type { LeaderCatalogue } from "@/lib/leaders/server";
import { countWords } from "@/lib/leaders/quality/text";
import type { StepId } from "@/lib/leaders/steps";

export type Patch = <K extends keyof LeaderAnswers>(section: K, value: Partial<LeaderAnswers[K]>) => void;
type Base = { answers: LeaderAnswers; patch: Patch };

const append = (current: string | undefined, add: string, max: number) =>
  `${current?.trim() ? `${current.trim()} ` : ""}${add}`.slice(0, max);

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

const STAGES_AT_A_GLANCE = [
  { title: "This application", body: "Eight written answers and six situations. About fifteen minutes, and you can stop and come back." },
  { title: "Two referees", body: "Two people who have seen you serve answer four questions about you. One is a pastor or unit head." },
  { title: "Panel and interview", body: "Two reviewers read your answers. If you are invited, you have a 20-minute conversation." },
  { title: "A pastor decides", body: "You see the result here, with a short note. Training follows." },
];

export function LeaderWelcome({ agreed, onAgree, consentText }: { agreed: boolean; onAgree: (v: boolean) => void; consentText: string }) {
  return (
    <>
      <StepHeading
        title="Lead a tribe."
        hint="Leaders are chosen for character and reliability, not for title or talent. Here is how it works, and how we look after what you share."
      />
      <ol className="card rise-in mb-6 divide-y divide-line overflow-hidden">
        {STAGES_AT_A_GLANCE.map((p, i) => (
          <li key={p.title} className="flex gap-4 px-5 py-4">
            <span aria-hidden="true" className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-strong text-[0.8rem] font-bold">
              {i + 1}
            </span>
            <div>
              <h2 className="font-semibold">{p.title}</h2>
              <p className="t-small mt-0.5 text-soft">{p.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="t-small mb-6 rounded-[var(--radius-control)] bg-gold/20 px-4 py-3 text-ink">
        What it asks of you: 75 minutes a week for 12 weeks, plus about 10 hours of training before your tribe begins.
      </p>
      <fieldset className="flex flex-col gap-3">
        <legend className="t-heading mb-3">Your agreement</legend>
        <Choice
          type="checkbox"
          name="consent-leader"
          value="yes"
          checked={agreed}
          onChange={(e) => onAgree(e.target.checked)}
          title={consentText}
          description="Needed to continue"
        />
      </fieldset>
      <p className="t-small mt-4 text-soft">
        Only the review panel sees your application. You can delete it any time before you are approved. Read the full{" "}
        <Link href="/privacy" target="_blank" className="font-semibold text-ink underline underline-offset-4">
          privacy notice
        </Link>
        .
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Getting started
// ---------------------------------------------------------------------------

export function EligibilityStep({ answers, patch }: Base) {
  return (
    <>
      <StepHeading
        title="First, seven quick questions."
        hint="Every answer needs to be yes to lead. If one is not yet, we will point you to another way to serve."
      />
      <div className="stagger flex flex-col gap-3">
        {ELIGIBILITY.map((q, i) => (
          <fieldset key={q.id} style={{ ["--i" as string]: i }} className="card flex flex-col gap-3 p-4 sm:p-5">
            <legend className="sr-only">{q.label}</legend>
            <p className="font-medium leading-snug" aria-hidden="true">
              {q.label}
            </p>
            <Segmented
              name={`elig-${q.id}`}
              label={q.label}
              value={answers.eligibility[q.id] === undefined ? null : answers.eligibility[q.id] ? "yes" : "no"}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "Not yet" },
              ]}
              onChange={(v) => patch("eligibility", { [q.id]: v === "yes" })}
            />
          </fieldset>
        ))}
      </div>
    </>
  );
}

export function ContactStep({ answers, patch }: Base) {
  const number = answers.contact.whatsapp ?? "";
  const valid = !number.trim() || normaliseWhatsapp(number) !== null;
  return (
    <>
      <StepHeading title="How can the panel reach you?" hint="We will message you on WhatsApp about your interview and the result. Nothing else, and no groups." />
      <Input
        label="WhatsApp number"
        name="whatsapp"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0803 123 4567"
        value={number}
        onChange={(e) => patch("contact", { whatsapp: e.target.value })}
        error={valid ? null : "That doesn’t look like a full number. Include your network code, like 0803 123 4567."}
        hint="Only the review panel sees this."
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Your calling
// ---------------------------------------------------------------------------

export function TrackStep({ answers, patch, tracks }: Base & { tracks: LeaderCatalogue["tracks"] }) {
  return (
    <>
      <StepHeading title="Which stage of life are you in?" hint="You will lead people in your own stage, so you share the same questions." />
      <div role="radiogroup" aria-label="Stage of life" className="stagger flex flex-col gap-3">
        {tracks.map((t, i) => (
          <Choice
            key={t.slug}
            name="track"
            value={t.slug}
            checked={answers.calling.track === t.slug}
            onChange={() => patch("calling", { track: t.slug })}
            title={`${t.name}, ${t.ages}`}
            description={t.description}
            style={{ ["--i" as string]: i }}
          />
        ))}
      </div>
    </>
  );
}

export function CommunityStep({ answers, patch, communities }: Base & { communities: LeaderCatalogue["communities"] }) {
  return (
    <>
      <StepHeading title="Which community is home for you?" hint="Your community is the group of people in a similar field or season. Pick the closest one." />
      <div role="radiogroup" aria-label="Communities" className="flex flex-col gap-3">
        {communities.map((t) => (
          <Choice
            key={t.slug}
            name="community"
            value={t.slug}
            checked={answers.calling.community === t.slug}
            onChange={() =>
              patch("calling", { community: t.slug, goal: answers.calling.community === t.slug ? answers.calling.goal : undefined })
            }
            title={t.name}
            description={t.description}
          />
        ))}
      </div>
    </>
  );
}

export function GoalStep({ answers, patch, communities }: Base & { communities: LeaderCatalogue["communities"] }) {
  const community = communities.find((t) => t.slug === answers.calling.community);
  const [other, setOther] = useState(Boolean(answers.calling.goalOther) || !community);
  const goals = community?.goals ?? [];

  return (
    <>
      <StepHeading
        title="Which Season Goal could you lead a tribe toward?"
        hint="Your tribe will work on this goal together. Choose one you have lived: you have reached it, or you are honestly in it now."
      />
      <div role="radiogroup" aria-label="Season Goals" className="flex flex-col gap-3">
        {goals.map((g) => (
          <Choice
            key={g.slug}
            name="goal"
            value={g.slug}
            checked={!other && answers.calling.goal === g.slug}
            onChange={() => {
              setOther(false);
              patch("calling", { goal: g.slug, goalOther: undefined });
            }}
            title={g.title}
          />
        ))}
        <Choice
          name="goal"
          value="__other"
          checked={other}
          onChange={() => {
            setOther(true);
            patch("calling", { goal: undefined });
          }}
          title="Something else"
          description="Write the goal in your own words"
        />
      </div>
      {other ? (
        <div className="rise-in mt-4">
          <Textarea
            label="Your goal"
            name="goalOther"
            rows={3}
            maxLength={160}
            placeholder="e.g. Start a ministry for young mothers"
            value={answers.calling.goalOther ?? ""}
            onChange={(e) => patch("calling", { goalOther: e.target.value })}
            className="min-h-24"
            hint={hasWords(answers.calling.goalOther) ? undefined : "A few words are enough."}
          />
        </div>
      ) : null}

      <section aria-labelledby="relation-heading" className="mt-9">
        <h2 id="relation-heading" className="t-heading mb-3">
          Where are you with it?
        </h2>
        <div role="radiogroup" aria-label="Where you are with this goal" className="flex flex-col gap-3">
          {GOAL_RELATIONS.map((r) => (
            <Choice
              key={r.id}
              name="goalRelation"
              value={r.id}
              checked={answers.calling.goalRelation === r.id}
              onChange={() => patch("calling", { goalRelation: r.id })}
              title={r.label}
              description={r.description}
            />
          ))}
        </div>
      </section>
    </>
  );
}

/** What the quick check said about an answer, shown under it. Kind, specific, and never about scores. */
export type AnswerNote = { note: string; triesLeft: number };

export function AnswerFeedback({ note, triesLeft, again = "Change it and press Continue again." }: AnswerNote & { again?: string }) {
  return (
    <div role="alert" data-testid="answer-feedback" className="rise-in mt-4 rounded-[var(--radius-control)] border-[1.5px] border-gold bg-gold/20 px-4 py-3">
      <p className="font-semibold">Not quite yet</p>
      <p className="t-small mt-1 text-ink">{note}</p>
      <p className="t-small mt-1.5 text-soft">
        {again}
        {triesLeft === 1 ? " If it is still not right after that, it will go through and a person will read it." : ""}
      </p>
    </div>
  );
}

/** A written answer with a microphone for people who would rather speak. */
function Writing({
  label,
  name,
  value,
  onChange,
  max,
  placeholder,
  rows = 6,
  minWords,
  feedback,
}: {
  label: string;
  name: string;
  value: string | undefined;
  onChange: (text: string) => void;
  max: number;
  placeholder: string;
  rows?: number;
  /** When the first check is on, the answer needs this many words, and the counter says so in words. */
  minWords?: number;
  feedback?: AnswerNote | null;
}) {
  const dictation = useDictation((text) => onChange(append(value, text, max)));
  const togo = charsToGo(value);
  const wordsToGo = minWords ? Math.max(0, minWords - countWords(value ?? "")) : 0;
  const counter = minWords
    ? wordsToGo > 0
      ? `${wordsToGo} more ${wordsToGo === 1 ? "word" : "words"} to go`
      : "That’s enough. Add more if you like."
    : togo > 0
      ? `${togo} more ${togo === 1 ? "character" : "characters"} to go`
      : "That’s enough. Add more if you like.";
  const hint = dictation.error ?? (dictation.listening ? "Listening… speak now." : counter);
  return (
    <div>
      <div className="relative">
        <Textarea
          label={label}
          name={name}
          rows={rows}
          maxLength={max}
          placeholder={placeholder}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-48 pb-14 text-[1.05rem]"
          hint={hint}
        />
        {dictation.supported ? <MicButton listening={dictation.listening} onClick={dictation.listening ? dictation.stop : dictation.start} /> : null}
      </div>
      {feedback ? <AnswerFeedback {...feedback} /> : null}
    </div>
  );
}

const WRITTEN = {
  "goal-story": {
    title: "Tell us your story with this goal.",
    hint: "In about five sentences: where you started, what happened, and what you learned. Be specific.",
    label: "Your story",
    placeholder: "e.g. In 2021 I left my job to start a business. The first year was hard. I learned…",
    max: 1500,
    field: "goalStory",
  },
  why: {
    title: "Why do you want to lead a tribe?",
    hint: "Tell us what you hope for the people in it. There is no right answer, but we read for who it is about.",
    label: "Why you want to lead",
    placeholder: "e.g. When I was struggling, someone sat with me. I want to do that for others…",
    max: 1000,
    field: "why",
  },
  walked: {
    title: "Tell us about a time you walked with someone through a hard season.",
    hint: "What did you do? And what did you choose not to do?",
    label: "A time you walked with someone",
    placeholder: "e.g. A friend lost her job. I called every week, and I listened. I did not…",
    max: 1500,
    field: "walked",
  },
  obstacles: {
    title: "What could get in the way of leading well for twelve weeks?",
    hint: "Work, travel, family, your own energy. Naming it helps us plan with you, and it will not count against you.",
    label: "What could get in the way",
    placeholder: "e.g. I travel for work in November. I would ask my assistant to lead those weeks…",
    max: 1000,
    field: "obstacles",
  },
} as const;

export function WrittenStep({ step, answers, patch, goalTitle, minWords, feedback }: Base & { step: "goal-story" | "why" | "walked" | "obstacles"; goalTitle: string | null; minWords?: number; feedback?: AnswerNote | null }) {
  const cfg = WRITTEN[step];
  return (
    <>
      <StepHeading title={cfg.title} hint={cfg.hint} />
      {step === "goal-story" && goalTitle ? (
        <p className="t-small mb-4 inline-flex rounded-full bg-gold/25 px-3 py-1.5 font-medium">Your goal: {goalTitle}</p>
      ) : null}
      <Writing
        label={cfg.label}
        name={cfg.field}
        value={answers.calling[cfg.field]}
        onChange={(text) => patch("calling", { [cfg.field]: text })}
        max={cfg.max}
        placeholder={cfg.placeholder}
        minWords={minWords}
        feedback={feedback}
      />
    </>
  );
}

export function WalkStep({ answers, patch, minWords, feedback }: Base & { minWords?: number; feedback?: AnswerNote | null }) {
  return (
    <>
      <StepHeading
        title="How is your walk with God right now?"
        hint="Honest beats high. The panel is looking for honesty, not a perfect score."
      />
      <div className="flex flex-col gap-8">
        <ScaleInput
          name="walkRating"
          label="Your walk with God, from 1 to 5"
          value={answers.calling.walkRating}
          onChange={(n) => patch("calling", { walkRating: n })}
          labels={WALK_LABELS}
          ends="1 is dry and distant, 5 is close and thriving"
        />
        <Writing
          label="Say a little about why"
          name="walkNote"
          value={answers.calling.walkNote}
          onChange={(text) => patch("calling", { walkNote: text })}
          max={800}
          rows={4}
          placeholder="e.g. Steady, though I get tired in busy seasons and pray less than I want to."
          minWords={minWords}
          feedback={feedback}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Your judgement
// ---------------------------------------------------------------------------

export function ScenarioStep({ id, answers, patch, seed }: Base & { id: ScenarioId; seed: string }) {
  const scenario = SCENARIOS.find((s) => s.id === id)!;
  const options = shuffled(scenario.options, `${seed}:${id}`);
  const pick = answers.scenarios[id] ?? {};
  const n = SCENARIO_IDS.indexOf(id) + 1;

  function choose(kind: "best" | "worst", option: OptionId) {
    const other = kind === "best" ? "worst" : "best";
    const next = { ...pick, [kind]: pick[kind] === option ? undefined : option };
    if (next[other] === option) next[other] = undefined;
    patch("scenarios", { [id]: next });
  }

  return (
    <>
      <StepHeading title={scenario.title} hint={`Situation ${n} of ${SCENARIO_IDS.length}. Choose the one response that is best, and the one that is worst.`} />
      <p className="night rise-in mb-6 rounded-[var(--radius-card)] p-5 text-[1.05rem] leading-snug">{scenario.situation}</p>
      <ul className="stagger flex flex-col gap-3">
        {options.map((o, i) => {
          const isBest = pick.best === o.id;
          const isWorst = pick.worst === o.id;
          return (
            <li
              key={o.id}
              style={{ ["--i" as string]: i }}
              className={cn(
                "card flex flex-col gap-3 p-4 transition-[border-color,box-shadow] duration-300",
                isBest && "!border-ink shadow-[0_0_0_3px_color-mix(in_srgb,var(--crest-gold)_55%,transparent)]",
                isWorst && "!border-flame shadow-[0_0_0_3px_color-mix(in_srgb,var(--crest-flame)_35%,transparent)]",
              )}
            >
              <p className="leading-snug">{o.text}</p>
              <div role="group" aria-label={`Response: ${o.text}`} className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={isBest}
                  onClick={() => choose("best", o.id)}
                  className={cn(
                    "press flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border-[1.5px] px-3 text-[0.95rem] font-semibold transition-colors duration-200",
                    isBest ? "border-ink bg-gold text-on-flame" : "border-line bg-raised text-soft hover:border-soft hover:text-ink",
                  )}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                  Best
                </button>
                <button
                  type="button"
                  aria-pressed={isWorst}
                  onClick={() => choose("worst", o.id)}
                  className={cn(
                    "press flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border-[1.5px] px-3 text-[0.95rem] font-semibold transition-colors duration-200",
                    isWorst ? "border-ink bg-flame text-on-flame" : "border-line bg-raised text-soft hover:border-soft hover:text-ink",
                  )}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                  Worst
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="t-small mt-4 text-soft" aria-live="polite">
        {pick.best && pick.worst ? "Both chosen. Tap another to change." : pick.best ? "Now choose the worst." : pick.worst ? "Now choose the best." : "Tap Best on one and Worst on another."}
      </p>
    </>
  );
}

export function StyleStep({ answers, patch }: Base) {
  return (
    <>
      <StepHeading
        title="This or that?"
        hint="Six quick taps, no right answers. We use them to pair you with an assistant leader who balances you. They never count for or against you."
      />
      <div className="stagger flex flex-col gap-3.5">
        {STYLE_PAIRS.map((pair, i) => (
          <div key={pair.key} style={{ ["--i" as string]: i }}>
            <Pair
              label={`${pair.left} or ${pair.right}`}
              left={pair.left}
              right={pair.right}
              value={(answers.style[pair.key] as -1 | 0 | 1 | undefined) ?? 0}
              onChange={(v) => patch("style", { [pair.key]: v })}
            />
          </div>
        ))}
      </div>
      <p className="t-small mt-5 text-soft">Both sound like you? Leave it, or tap a choice again to clear it.</p>
    </>
  );
}

export function LeadBestStep({ answers, patch }: Base) {
  return (
    <>
      <StepHeading title="I lead best by…" hint="Pick the one that sounds most like you. Your assistant leader will be someone who is strong where you are not." />
      <div role="radiogroup" aria-label="How you lead best" className="stagger flex flex-col gap-3">
        {LEAD_BEST.map((o, i) => (
          <Choice
            key={o.id}
            name="leadBest"
            value={o.id}
            checked={answers.style.leadBest === o.id}
            onChange={() => patch("style", { leadBest: o.id })}
            title={o.label}
            description={o.description}
            style={{ ["--i" as string]: i }}
          />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// People who know you
// ---------------------------------------------------------------------------

export function RefereeStep({
  slot,
  value,
  onChange,
  headNeeded,
  error,
}: {
  slot: 1 | 2;
  value: RefereeInput;
  onChange: (next: RefereeInput) => void;
  /** True when the other referee is not a pastor or unit head. */
  headNeeded: boolean;
  error: string | null;
}) {
  return (
    <>
      <StepHeading
        title={slot === 1 ? "Who can speak for you?" : "And a second person."}
        hint={
          slot === 1
            ? "Choose someone who has seen you serve and will be honest. After you apply, you will get a private link to send them. They answer four short questions."
            : "Someone different, who knows you in another setting. One of your two referees must be a pastor or unit head."
        }
      />
      <div className="flex flex-col gap-5">
        <Input
          label="Their name"
          name={`referee-${slot}-name`}
          autoComplete="off"
          maxLength={80}
          placeholder="e.g. Pastor Ife Adeyemi"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
        <div className="flex flex-col gap-2">
          <Input
            label="How do you know them?"
            name={`referee-${slot}-relationship`}
            autoComplete="off"
            maxLength={80}
            placeholder="e.g. My unit head at church"
            value={value.relationship}
            onChange={(e) => onChange({ ...value, relationship: e.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            {REFEREE_RELATIONSHIPS.map((r) => (
              <Chip key={r} selected={value.relationship === r} onClick={() => onChange({ ...value, relationship: r, head: r === "Pastor" || r === "Unit head" ? true : value.head })}>
                {r}
              </Chip>
            ))}
          </div>
        </div>
        <Input
          label="Their phone number or email"
          name={`referee-${slot}-contact`}
          autoComplete="off"
          maxLength={120}
          placeholder="0803 123 4567 or name@email.com"
          value={value.contact}
          onChange={(e) => onChange({ ...value, contact: e.target.value })}
          hint="Only the review panel sees this, in case they need to follow up."
        />
        <Choice
          type="checkbox"
          name={`referee-${slot}-head`}
          value="yes"
          checked={value.head}
          onChange={(e) => onChange({ ...value, head: e.target.checked })}
          title="This person is a pastor or unit head"
        />
        {slot === 2 && headNeeded && !value.head ? (
          <Note tone="info">Neither referee is marked as a pastor or unit head yet. One of them must be.</Note>
        ) : null}
        {error ? (
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

function excerpt(text: string | undefined, max = 140) {
  const t = text?.trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

export function ReviewStep({
  answers,
  referees,
  catalogue,
  onEdit,
  error,
}: {
  answers: LeaderAnswers;
  referees: { 1?: RefereeInput; 2?: RefereeInput };
  catalogue: LeaderCatalogue;
  onEdit: (step: StepId) => void;
  error: string | null;
}) {
  const c = answers.calling;
  const track = catalogue.tracks.find((t) => t.slug === c.track);
  const community = catalogue.communities.find((t) => t.slug === c.community);
  const goal = community?.goals.find((g) => g.slug === c.goal)?.title ?? c.goalOther?.trim() ?? null;
  const relation = GOAL_RELATIONS.find((r) => r.id === c.goalRelation)?.label;
  const answered = SCENARIO_IDS.filter((id) => answers.scenarios[id]?.best && answers.scenarios[id]?.worst).length;
  const styled = STYLE_PAIRS.filter((p) => answers.style[p.key]).length;
  const refLine = (r?: RefereeInput) => (r ? [r.name.trim(), r.relationship.trim(), r.head ? "pastor or unit head" : null].filter(Boolean).join(", ") : null);

  const groups: { id: string; label: string; color: string; rows: { step: StepId; label: string; value: string | null }[] }[] = [
    {
      id: "start",
      label: "Getting started",
      color: "var(--crest-charcoal)",
      rows: [{ step: "contact", label: "WhatsApp", value: normaliseWhatsapp(answers.contact.whatsapp ?? "") }],
    },
    {
      id: "calling",
      label: "Your calling",
      color: "var(--crest-flame)",
      rows: [
        { step: "track", label: "Stage of life", value: track ? `${track.name}, ${track.ages}` : null },
        { step: "community", label: "Community", value: community?.name ?? null },
        { step: "goal", label: "Season Goal", value: goal ? `${goal}${relation ? ` (${relation.toLowerCase()})` : ""}` : null },
        { step: "goal-story", label: "Your story", value: excerpt(c.goalStory) },
        { step: "why", label: "Why you want to lead", value: excerpt(c.why) },
        { step: "walked", label: "Walking with someone", value: excerpt(c.walked) },
        { step: "walk", label: "Your walk with God", value: c.walkRating ? `${c.walkRating} of 5, ${WALK_LABELS[c.walkRating - 1].toLowerCase()}` : null },
        { step: "obstacles", label: "What could get in the way", value: excerpt(c.obstacles) },
      ],
    },
    {
      id: "judgement",
      label: "Your judgement",
      color: "var(--crest-gold)",
      rows: [
        { step: "s1", label: "Situations", value: `${answered} of ${SCENARIO_IDS.length} answered` },
        { step: "style", label: "This or that", value: `${styled} of ${STYLE_PAIRS.length} answered` },
        { step: "lead-best", label: "I lead best by", value: LEAD_BEST.find((o) => o.id === answers.style.leadBest)?.label ?? null },
      ],
    },
    {
      id: "people",
      label: "People who know you",
      color: "var(--crest-amber)",
      rows: [
        { step: "ref1", label: "First referee", value: refLine(referees[1]) },
        { step: "ref2", label: "Second referee", value: refLine(referees[2]) },
      ],
    },
  ];

  return (
    <>
      <StepHeading title="Here is your application." hint="Read it through. Tap Change on anything you would like to fix. After you send it, your answers are locked." />
      <div className="stagger flex flex-col gap-4">
        {groups.map((g, i) => (
          <section key={g.id} className="card overflow-hidden" style={{ ["--i" as string]: i }} aria-labelledby={`review-${g.id}`}>
            <h2 id={`review-${g.id}`} className="t-heading flex items-center gap-2.5 border-b border-line px-5 py-3.5">
              <span aria-hidden="true" className="h-3 w-3 rounded-[4px]" style={{ background: g.color }} />
              {g.label}
            </h2>
            <dl className="divide-y divide-line">
              {g.rows.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <dt className="t-small text-soft">{row.label}</dt>
                    <dd className="mt-0.5 break-words font-medium">{row.value || <span className="font-normal text-soft">Missing</span>}</dd>
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
      <p className="t-small mt-5 text-soft">
        After you send it, you will get a private link for each referee to share by WhatsApp. The panel reads your application while they answer. An interview invitation waits until both have.
      </p>
      {error ? (
        <div className="mt-5" role="alert">
          <Note tone="info">{error}</Note>
        </div>
      ) : null}
    </>
  );
}

/** Shown to someone who started before the first check existed: one new sentence to read and agree to. */
export function AiConsentStep({ text, agreed, onAgree }: { text: string; agreed: boolean; onAgree: (v: boolean) => void }) {
  return (
    <>
      <StepHeading
        title="We have changed one sentence."
        hint="Before you carry on, please read it. Your answers so far are saved, and nothing else about your application changes."
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Your agreement</legend>
        <Choice type="checkbox" name="consent-leader-ai" value="yes" checked={agreed} onChange={(e) => onAgree(e.target.checked)} title={text} description="Needed to continue" />
      </fieldset>
      <p className="t-small mt-4 text-soft">
        What the computer program sees: only your written answers, with phone numbers and email addresses removed and without your name. It never makes a decision, and a pastor reads anything it is unsure about.
      </p>
    </>
  );
}
