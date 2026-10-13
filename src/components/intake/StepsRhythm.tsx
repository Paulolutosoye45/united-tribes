"use client";

import { CompanionSwitch, PickNote, Tag } from "@/components/companion/Companion";
import { Choice, Pair, Segmented } from "@/components/ui/Choice";
import { Chip, Sparkle } from "@/components/ui/Chip";
import type { FieldKey } from "@/lib/companion";
import { enabledChannels } from "@/lib/intake/answers";
import { areaBySlug } from "@/lib/intake/areas";
import {
  BASELINES,
  CHANNELS,
  CHILDREN,
  TRIBE_MIXES,
  FAITH_JOURNEYS,
  GENDERS,
  GROUP_ROLES,
  MAX_GROUP_ROLES,
  MEETING_MODES,
  MEETING_TIMES,
  MONTHS,
  RELATIONSHIPS,
  SERVING_OPTIONS,
  STYLE_PAIRS,
  WORK_FIELDS,
  WORK_STATUSES,
  ZONES,
} from "@/lib/intake/options";
import { SECTIONS, type StepId } from "@/lib/intake/steps";
import { suggestTimes } from "@/lib/intake/times";
import { Note, StepHeading } from "./ui";
import type { Catalogue, StepProps } from "./types";
import type { Companion } from "./useCompanion";

export function RhythmStep({ answers, set, cmp }: StepProps & { cmp: Companion }) {
  const times = answers.times ?? [];
  const mode = MEETING_MODES.find((m) => m.id === answers.meetingMode);
  const kids = (answers.children ?? []).some((c) => c === "under_12" || c === "expecting");
  const suggestions = suggestTimes({ zone: answers.zone, mode: answers.meetingMode, work: answers.workStatus, kids });
  const reasons = new Map(suggestions.map((s) => [s.id, s.reason]));
  const modePick = cmp.on && cmp.picked("meetingMode") ? cmp.picks.mode : null;

  // Suggested times first, in the order we suggest them, then the rest.
  const ordered = [...MEETING_TIMES].sort((a, b) => Number(reasons.has(b.id)) - Number(reasons.has(a.id)) || 0);
  // With the Companion off nothing is ticked for them, but the suggested times are one tap away.
  const offer = !cmp.on && times.length === 0 && Boolean(answers.meetingMode) && suggestions.length > 0;

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
          {modePick && answers.meetingMode === modePick.id ? <PickNote pick={modePick} name="how you would like to meet" /> : null}
        </section>

        <section aria-labelledby="times-heading">
          <h2 id="times-heading" className="t-heading mb-1">
            When could you meet?
          </h2>
          <p className="t-small mb-3 text-soft">We suggest the times that avoid the worst of Lagos traffic for you. Tick any others that could work.</p>
          {cmp.on && cmp.picked("times") && times.length > 0 ? (
            <p className="t-small mb-3 flex flex-wrap items-center gap-2">
              <Tag />
              <span>I ticked the times that suit what you told me. Change any of them.</span>
            </p>
          ) : null}
          {offer ? (
            <button
              type="button"
              onClick={() => set({ times: suggestions.map((s) => s.id) })}
              className="press mb-3 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border-[1.5px] border-ink px-4 font-semibold"
            >
              <Sparkle size={14} />
              Tick the suggested times
            </button>
          ) : null}
          <div role="group" aria-labelledby="times-heading" className="grid gap-3 sm:grid-cols-2">
            {ordered.map((t) => (
              <Choice
                key={t.id}
                type="checkbox"
                name="times"
                value={t.id}
                checked={times.includes(t.id)}
                onChange={(e) => set({ times: e.target.checked ? [...times, t.id] : times.filter((x) => x !== t.id) })}
                title={t.label}
                suggested={reasons.has(t.id)}
                reason={reasons.get(t.id)}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

export function StyleStep({ answers, set, cmp }: StepProps & { cmp: Companion }) {
  const chosen = answers.groupRoles ?? [];
  const rolePicks = cmp.on ? cmp.picks.roles : [];
  const suggested = new Map(rolePicks.map((p) => [p.id, p]));
  const mine = cmp.picked("groupRoles") ? rolePicks.find((p) => (chosen as readonly string[]).includes(p.id)) : undefined;

  // The this-or-that pairs the Companion has a view on, and which of them are still unanswered.
  const leans = cmp.on ? cmp.picks.style : {};
  const open = STYLE_PAIRS.filter((p) => leans[p.key] && !answers[p.key]);

  function toggle(id: (typeof GROUP_ROLES)[number]["id"]) {
    if (chosen.includes(id)) set({ groupRoles: chosen.filter((r) => r !== id) });
    else set({ groupRoles: [...chosen, id].slice(-MAX_GROUP_ROLES) });
  }

  return (
    <>
      <StepHeading
        title="This or that?"
        hint="Six quick taps, no right answers. We use them to put you with people you will click with. Other members never see them."
      />
      {open.length > 0 ? (
        <div className="cmp-card rise-in mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="t-small flex min-w-0 flex-1 basis-56 items-start gap-2">
            <span className="mt-0.5 shrink-0">
              <Sparkle size={16} />
            </span>
            <span>
              From what you wrote, I have a guess for {open.length === 1 ? "one of these" : `${open.length} of these`}. Look for the ✦, and tap your own answer if I am wrong.
            </span>
          </p>
          <button
            type="button"
            onClick={() => set(Object.fromEntries(open.map((p) => [p.key, leans[p.key]!.lean])))}
            className="press min-h-11 rounded-[var(--radius-control)] border-[1.5px] border-ink px-4 font-semibold"
          >
            Use my suggested taps
          </button>
        </div>
      ) : null}
      <div className="stagger flex flex-col gap-3.5">
        {STYLE_PAIRS.map((pair, i) => {
          const lean = leans[pair.key];
          const value = (answers[pair.key] as -1 | 0 | 1 | undefined) ?? 0;
          return (
            <div key={pair.key} style={{ ["--i" as string]: i }}>
              <Pair
                label={`${pair.left} or ${pair.right}`}
                left={pair.left}
                right={pair.right}
                value={value}
                suggested={lean && value === 0 ? lean.lean : undefined}
                onChange={(v) => set({ [pair.key]: v })}
              />
              {lean?.reason && value === 0 ? <p className="t-small mt-1.5 px-1 text-accent">{lean.reason}</p> : null}
            </div>
          );
        })}
      </div>
      <p className="t-small mt-5 text-soft">Both sound like you? Leave it, or tap a choice again to clear it.</p>

      <section className="mt-10" aria-labelledby="roles-heading">
        <h2 id="roles-heading" className="t-heading flex items-baseline gap-2">
          In a group, you are usually the…
          <span className="t-small font-normal text-soft">Pick up to two</span>
        </h2>
        <p className="t-small mb-3 mt-1 text-soft">It helps us make sure every tribe has a good mix of gifts. Your leader sees your choices; other members do not.</p>
        <div role="group" aria-labelledby="roles-heading" className="flex flex-wrap gap-2.5">
          {GROUP_ROLES.map((r) => (
            <Chip key={r.id} selected={chosen.includes(r.id)} suggested={suggested.has(r.id)} onClick={() => toggle(r.id)} title={r.description}>
              {r.label}
            </Chip>
          ))}
        </div>
        {mine ? (
          <PickNote pick={mine} name="your gifts in a group" onReject={() => set({ groupRoles: [] })} />
        ) : chosen.map((id) => suggested.get(id)?.reason).find(Boolean) ? (
          <p className="t-small mt-2 text-accent">{chosen.map((id) => suggested.get(id)?.reason).find(Boolean)}</p>
        ) : null}
      </section>
      <CompanionSwitch cmp={cmp} className="mt-8" />
    </>
  );
}

type ReviewProps = StepProps & {
  catalogue: Catalogue;
  onEdit: (step: StepId) => void;
  error: string | null;
  /** The answers the Companion filled in and the person kept as they were. */
  kept?: ReadonlySet<FieldKey>;
};

export function ReviewStep({ answers, catalogue, onEdit, error, kept }: ReviewProps) {
  const age = catalogue.ageRanges.find((r) => r.slug === answers.ageRange);
  const community = catalogue.communities.find((t) => t.slug === answers.community);
  const goal = community?.goals.find((g) => g.slug === answers.goal);
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
  const secondCommunity = catalogue.communities.find((t) => t.slug === answers.secondCommunity);
  const labels = <T extends { id: string; label: string }>(list: readonly T[], picked?: readonly string[]) =>
    (picked ?? []).map((id) => list.find((o) => o.id === id)?.label).filter(Boolean).join(", ");
  const heard = [
    find(WORK_STATUSES, answers.workStatus),
    find(WORK_FIELDS, answers.workField),
    find(RELATIONSHIPS, answers.relationship),
    labels(CHILDREN, answers.children),
  ].filter(Boolean);
  const area = areaBySlug(answers.areaSlug);
  const channels = enabledChannels(answers).map((c) => CHANNELS.find((x) => x.id === c)?.label);
  const hasSupport = (answers.supportChips?.length ?? 0) > 0 || Boolean(answers.supportNote?.trim());

  const rows: Record<string, { step: StepId; label: string; value: string | null; marks?: FieldKey[] }[]> = {
    you: [
      {
        step: "age",
        label: "Age",
        value: [age?.label, birthday && `birthday ${birthday}`, answers.openToAdjacent && "open to the neighbouring age group"].filter(Boolean).join(", ") || null,
      },
      { step: "name", label: "Name", value: nameLine },
      { step: "gender", label: "Gender", value: find(GENDERS, answers.gender) ?? null },
      { step: "gender", label: "Tribe mix", value: find(TRIBE_MIXES, answers.tribeMix) ?? null },
      { step: "where", label: "Based in", value: [area?.name ?? answers.areaNote, find(ZONES, answers.zone)].filter(Boolean).join(", ") },
    ],
    season: [
      { step: "story", label: "Your story", value: answers.story?.trim() || null },
      { step: "heard", label: "About you", value: heard.length > 0 ? heard.join(" · ") : null, marks: ["workStatus", "workField", "relationship", "children"] },
      { step: "community", label: "Community", value: community?.name ?? answers.communityOther ?? null, marks: ["community"] },
      { step: "community", label: "Second choice", value: secondCommunity?.name ?? null, marks: ["secondCommunity"] },
      { step: "faith", label: "Walk with God", value: find(FAITH_JOURNEYS, answers.faith) ?? null },
    ],
    goal: [
      { step: "goal", label: "Goal", value: goal?.title ?? answers.goalOther ?? null, marks: ["goal"] },
      { step: "success", label: "In twelve weeks", value: answers.successStatement?.trim() || null },
      { step: "success", label: "Today", value: answers.baseline ? `${answers.baseline} of 5, ${BASELINES[answers.baseline - 1].label.toLowerCase()}` : null },
    ],
    rhythm: [
      { step: "rhythm", label: "Meeting", value: find(MEETING_MODES, answers.meetingMode) ?? null, marks: ["meetingMode"] },
      { step: "rhythm", label: "Times that work", value: labels(MEETING_TIMES, answers.times) || null, marks: ["times"] },
      { step: "style", label: "This or that", value: STYLE_PAIRS.some((p) => answers[p.key]) ? `${STYLE_PAIRS.filter((p) => answers[p.key]).length} of 6 answered` : null },
      { step: "style", label: "Your gifts in a group", value: labels(GROUP_ROLES, answers.groupRoles) || null, marks: ["groupRoles"] },
      { step: "care", label: "Care for you", value: hasSupport ? "Added. Only you can read it." : null },
      { step: "care", label: "Note for your leader", value: answers.leaderNote?.trim() ? "Added. Your leader will read it." : null },
      { step: "care", label: "Leading a tribe", value: SERVING_OPTIONS.find((o) => o.id === answers.openToServing)?.label ?? null },
      { step: "contact", label: "Reach me by", value: channels.length > 0 ? channels.join(", then ") : null },
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
                    <dd className="mt-0.5 break-words font-medium">
                      {row.value || <span className="font-normal text-soft">Skipped</span>}
                      {row.value && row.marks?.some((f) => kept?.has(f)) ? (
                        <span className="ml-2 whitespace-nowrap align-middle">
                          <Tag />
                        </span>
                      ) : null}
                    </dd>
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
