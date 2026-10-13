"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import type { CareLevel, CelebrationKind, LogExtras, LogExtrasInput } from "@/lib/rhythm/types";
import { CARE_LEVELS, CELEBRATION_KINDS, ENERGY_LABELS } from "@/lib/rhythm/wording";

export type ExtrasMember = { person_id: string; name: string };

/** Everything the leader can add to the log beyond who came, as the form holds it while they type. */
export type ExtrasState = {
  energy: number | null;
  prayers: { id?: string; body: string }[];
  prayerDraft: string;
  care: Record<string, { level: CareLevel; note: string }>;
  needCoach: boolean;
  needCoachNote: string;
  celebrations: { kind: Exclude<CelebrationKind, "answered_prayer">; person: string; note: string }[];
};

/** Starts the form from what is already saved for the week. */
export function initialExtras(saved: LogExtras | null): ExtrasState {
  const care: ExtrasState["care"] = {};
  for (const t of saved?.care ?? []) if (t.person_id && t.status === "open") care[t.person_id] = { level: t.level, note: t.note ?? "" };
  return {
    energy: saved?.energy ?? null,
    prayers: (saved?.prayers_this_week ?? []).map((p) => ({ id: p.id, body: p.body })),
    prayerDraft: "",
    care,
    needCoach: saved?.need_coach ?? false,
    needCoachNote: saved?.need_coach_note ?? "",
    celebrations: (saved?.celebrations ?? [])
      .filter((c) => c.kind !== "answered_prayer")
      .map((c) => ({ kind: c.kind as Exclude<CelebrationKind, "answered_prayer">, person: c.person_id ?? "", note: c.note ?? "" })),
  };
}

/** What gets sent to the database. A prayer typed but not yet added is added for them. */
export function extrasToInput(x: ExtrasState, held: boolean): LogExtrasInput {
  const draft = x.prayerDraft.trim();
  const prayers = draft.length >= 3 ? [...x.prayers, { body: draft }] : x.prayers;
  return {
    energy: held ? x.energy : null,
    prayers,
    care: Object.entries(x.care)
      .filter(([, v]) => v.level !== "none")
      .map(([person, v]) => ({ person, level: v.level, note: v.note })),
    needCoach: x.needCoach,
    needCoachNote: x.needCoach ? x.needCoachNote : "",
    celebrations: x.celebrations.filter((c) => c.kind).map((c) => ({ kind: c.kind, person: c.person || null, note: c.note })),
  };
}

export function ExtrasFields({
  state,
  onChange,
  members,
  held,
  hasCoach,
}: {
  state: ExtrasState;
  onChange: (next: ExtrasState) => void;
  members: ExtrasMember[];
  held: boolean;
  hasCoach: boolean;
}) {
  const set = (patch: Partial<ExtrasState>) => onChange({ ...state, ...patch });
  const base = useId();

  function addPrayer() {
    const body = state.prayerDraft.trim();
    if (body.length < 3 || state.prayers.length >= 10) return;
    set({ prayers: [...state.prayers, { body }], prayerDraft: "" });
  }

  return (
    <div className="flex flex-col gap-7 border-t border-line pt-6">
      {held ? (
        <fieldset className="flex flex-col gap-2.5">
          <legend className="font-semibold">How did the meeting feel?</legend>
          <p className="t-small text-soft">Your coach sees this over the weeks, so they can tell when a tribe is running low.</p>
          <div role="radiogroup" aria-label="Energy of the meeting" className="grid grid-cols-5 gap-1.5">
            {ENERGY_LABELS.map((label, i) => {
              const value = i + 1;
              const on = state.energy === value;
              return (
                <label
                  key={label}
                  className={cn(
                    "press grid min-h-14 cursor-pointer place-items-center rounded-xl border-[1.5px] px-1 text-center text-[0.85rem] leading-tight transition-colors",
                    on ? "border-ink bg-gold font-semibold" : "border-line bg-raised text-soft hover:border-soft",
                  )}
                >
                  <input
                    type="radio"
                    name={`${base}-energy`}
                    value={value}
                    checked={on}
                    onChange={() => set({ energy: value })}
                    className="sr-only"
                  />
                  <span className="block text-base font-bold">{value}</span>
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <section aria-labelledby={`${base}-prayer`} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 id={`${base}-prayer`} className="font-semibold">
            Prayer requests
          </h3>
          <p className="t-small text-soft">Kept on your tribe’s private prayer list. Only you, your assistant and your coach can read it. Leave out names and details people did not agree to share.</p>
        </div>
        {state.prayers.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Prayer requests for this week">
            {state.prayers.map((p, i) => (
              <li key={p.id ?? `new-${i}`} className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-line px-3.5 py-2.5">
                <span className="t-body min-w-0 break-words">{p.body}</span>
                <button
                  type="button"
                  className="press shrink-0 rounded-lg px-2 py-1 text-[0.85rem] font-medium text-soft hover:text-ink"
                  onClick={() => set({ prayers: state.prayers.filter((_, j) => j !== i) })}
                  aria-label={`Remove: ${p.body}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {state.prayers.length < 10 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Input
                label="Add a request"
                name="prayer"
                maxLength={200}
                value={state.prayerDraft}
                onChange={(e) => set({ prayerDraft: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPrayer();
                  }
                }}
                placeholder="A job interview on Tuesday"
              />
            </div>
            <Button type="button" variant="quiet" size="md" onClick={addPrayer} disabled={state.prayerDraft.trim().length < 3}>
              Add
            </Button>
          </div>
        ) : (
          <p className="t-small text-soft">That is ten for this week.</p>
        )}
      </section>

      {members.length > 0 ? (
        <section aria-labelledby={`${base}-care`} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 id={`${base}-care`} className="font-semibold">
              Does anyone need care?
            </h3>
            <p className="t-small text-soft">Flag a person and it becomes a task with a seven-day deadline. Urgent alerts the Care Lead straight away by email and text.</p>
          </div>
          <ul className="flex flex-col gap-2.5">
            {members.map((m) => {
              const cur = state.care[m.person_id] ?? { level: "none" as CareLevel, note: "" };
              const hint = CARE_LEVELS.find((l) => l.value === cur.level)?.hint;
              return (
                <li key={m.person_id} className="flex flex-col gap-2.5 rounded-[var(--radius-control)] border border-line p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="font-semibold leading-snug">{m.name}</p>
                    <div role="radiogroup" aria-label={`Care for ${m.name}`} className="grid shrink-0 grid-cols-4 gap-1.5">
                      {CARE_LEVELS.map((l) => (
                        <label
                          key={l.value}
                          className={cn(
                            "press grid h-10 cursor-pointer place-items-center rounded-xl border-[1.5px] px-2 text-[0.82rem] font-medium transition-colors",
                            cur.level === l.value
                              ? l.value === "urgent"
                                ? "border-ink bg-flame font-semibold text-on-flame"
                                : l.value === "none"
                                  ? "border-ink bg-surface-strong font-semibold"
                                  : "border-ink bg-gold font-semibold"
                              : "border-line bg-raised text-soft hover:border-soft",
                          )}
                        >
                          <input
                            type="radio"
                            name={`${base}-care-${m.person_id}`}
                            value={l.value}
                            checked={cur.level === l.value}
                            onChange={() => set({ care: { ...state.care, [m.person_id]: { ...cur, level: l.value } } })}
                            className="sr-only"
                          />
                          {l.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  {cur.level !== "none" ? (
                    <>
                      <p className="t-small text-soft">{hint}</p>
                      <Input
                        label={`What does ${m.name.split(" ")[0]} need?`}
                        name={`care-note-${m.person_id}`}
                        optional
                        maxLength={300}
                        value={cur.note}
                        onChange={(e) => set({ care: { ...state.care, [m.person_id]: { ...cur, note: e.target.value } } })}
                      />
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby={`${base}-celebrate`} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 id={`${base}-celebrate`} className="font-semibold">
            Anything to celebrate?
          </h3>
          <p className="t-small text-soft">A new baby, an anniversary, a promotion. You and your assistant get a reminder to say something in the group.</p>
        </div>
        {state.celebrations.map((c, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-line p-3">
            <div role="group" aria-label="What are we celebrating" className="flex flex-wrap gap-2">
              {CELEBRATION_KINDS.map((k) => (
                <Chip
                  key={k.value}
                  selected={c.kind === k.value}
                  onClick={() => set({ celebrations: state.celebrations.map((x, j) => (j === i ? { ...x, kind: k.value } : x)) })}
                >
                  {k.label}
                </Chip>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Who? (optional)"
                value={c.person}
                onChange={(e) => set({ celebrations: state.celebrations.map((x, j) => (j === i ? { ...x, person: e.target.value } : x)) })}
              >
                <option value="">The whole tribe</option>
                {members.map((m) => (
                  <option key={m.person_id} value={m.person_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
              <Input
                label="A few words"
                name={`celebration-${i}`}
                optional
                maxLength={140}
                value={c.note}
                onChange={(e) => set({ celebrations: state.celebrations.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })}
                placeholder={CELEBRATION_KINDS.find((k) => k.value === c.kind)?.placeholder}
              />
            </div>
            <div>
              <button
                type="button"
                className="press rounded-lg px-1 py-1 text-[0.85rem] font-medium text-soft hover:text-ink"
                onClick={() => set({ celebrations: state.celebrations.filter((_, j) => j !== i) })}
              >
                Remove this one
              </button>
            </div>
          </div>
        ))}
        {state.celebrations.length < 5 ? (
          <div>
            <Button
              type="button"
              variant="quiet"
              size="md"
              onClick={() => set({ celebrations: [...state.celebrations, { kind: "other", person: "", note: "" }] })}
            >
              Add something to celebrate
            </Button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby={`${base}-coach`} className="flex flex-col gap-3">
        <h3 id={`${base}-coach`} className="font-semibold">
          Do you need your coach?
        </h3>
        <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-line p-3.5 has-[:checked]:border-ink has-[:checked]:bg-gold/20">
          <input
            type="checkbox"
            name="need-coach"
            checked={state.needCoach}
            onChange={(e) => set({ needCoach: e.target.checked })}
            className="mt-1 h-5 w-5 accent-[var(--crest-flame)]"
          />
          <span>
            <span className="block font-semibold">I need my coach this week</span>
            <span className="t-small block text-soft">
              {hasCoach ? "Your coach is asked to call you within the week." : "You do not have a coach yet, so the Care Lead will be asked to call you."}
            </span>
          </span>
        </label>
        {state.needCoach ? (
          <Textarea
            label="What would help?"
            name="need-coach-note"
            optional
            rows={2}
            maxLength={300}
            value={state.needCoachNote}
            onChange={(e) => set({ needCoachNote: e.target.value })}
            hint="Your coach reads this before they call. Leave out private details about members."
            className="!min-h-20"
          />
        ) : null}
      </section>
    </div>
  );
}
