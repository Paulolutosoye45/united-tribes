"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveCardAction, submitCardAction, prefillFromReadyMadeAction } from "@/app/(app)/lead/tribe/actions";
import { goalHintsAction } from "@/app/(app)/lead/tribe/choice-actions";
import { GoalPicker } from "@/components/academy/GoalPicker";
import type { GoalHints } from "@/lib/academy/goal-choice";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Segmented } from "@/components/ui/Choice";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { LIMITS, missingFields, storyForCard, valuesFromCard, type CardValues } from "@/lib/academy/card";
import { CARD_MISSING, CARD_STATUS, TRIBE_TYPES, DAYS, clockLabel, timesFor, ZONES } from "@/lib/academy/options";
import type { MyTribe } from "@/lib/academy/types";
import { prefillLines, type ReadyMade } from "@/lib/cards/templates";
import type { LeaderCatalogue } from "@/lib/leaders/server";
import { TribePreview } from "./TribePreview";

type Save = "idle" | "saving" | "saved" | "error";

const LINE_FIELDS = [
  {
    key: "god",
    label: "Loving God",
    hint: "The faith habit your tribe keeps together.",
    example: "Read the week’s passage and say the confession five days a week.",
  },
  {
    key: "others",
    label: "Loving Others",
    hint: "How your tribe carries each other.",
    example: "Pray for our triad weekly; nobody misses twice without a call.",
  },
  {
    key: "life",
    label: "Loving Life",
    hint: "The goal outcome, made specific. Say who does what, and how many times.",
    example: "Each of us completes 10 of 12 weekly steps and has one leadership conversation with a manager.",
  },
] as const;

export function TribeBuilder({
  card,
  catalogue,
  applicationStory,
  readyMade = null,
  goalHints = null,
}: {
  card: MyTribe;
  catalogue: LeaderCatalogue;
  applicationStory: string | null;
  /** The signed-off ready-made card for this tribe's goal, the public fields only. Null when there is none. */
  readyMade?: ReadyMade | null;
  /** The goals this leader may choose from, when the church has let them choose. Null for every other leader, whose card is as it always was. */
  goalHints?: GoalHints | null;
}) {
  const router = useRouter();
  const editable = card.editable;
  const [values, setValues] = useState<CardValues>(() => valuesFromCard(card));
  const [save, setSave] = useState<Save>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hints, setHints] = useState<GoalHints | null>(goalHints);
  const [choosing, setChoosing] = useState<string | null>(null);

  const pending = useRef<Partial<CardValues>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const batch = pending.current;
    if (Object.keys(batch).length === 0) return chain.current;
    pending.current = {};
    chain.current = chain.current.then(async () => {
      setSave("saving");
      try {
        const result = await saveCardAction(card.id, batch);
        if (result.ok) {
          setSave("saved");
          setProblem(null);
        } else {
          setSave("error");
          setProblem(result.message);
        }
      } catch {
        setSave("error");
        setProblem("We couldn’t save that. Check your connection and try again.");
      }
    });
    return chain.current;
  }, [card.id]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // Anything typed in the last moment is sent as the page closes.
      if (Object.keys(pending.current).length > 0) void saveCardAction(card.id, pending.current);
    };
  }, [card.id]);

  function change(patch: Partial<CardValues>, now = false) {
    if (!editable) return;
    setValues((v) => ({ ...v, ...patch }));
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    if (now) void flush();
    else timer.current = setTimeout(() => void flush(), 800);
  }

  function setDay(day: number) {
    const times = timesFor(day);
    const keep = times.includes(values.meeting_time) ? values.meeting_time : "";
    change({ meeting_day: day, meeting_time: keep }, true);
  }

  const community = catalogue.communities.find((t) => t.slug === values.community) ?? null;
  const track = catalogue.tracks.find((t) => t.slug === values.track) ?? null;
  const goal = community?.goals.find((g) => g.slug === values.goal) ?? null;
  const missing = useMemo(() => missingFields(values), [values]);
  const fixed = new Set(card.fixed);
  const times = timesFor(values.meeting_day);
  const status = CARD_STATUS[card.status];
  // The Success Picture module comes first only when the Academy is required. A missing answer counts as required.
  const moduleBlocks = card.module_needed !== false && !card.module_ok;
  const canSend = editable && !moduleBlocks && missing.length === 0;

  // "Start from the ready-made card". What is typed is saved first, then the database fills only the lines that are still empty.
  const [starting, setStarting] = useState(false);
  const linesLeft = readyMade !== null && (!values.god.trim() || !values.others.trim() || !values.life.trim());
  async function startFromReadyMade() {
    if (!readyMade) return;
    setStarting(true);
    setProblem(null);
    await flush();
    const result = await prefillFromReadyMadeAction(card.id);
    setStarting(false);
    if (!result.ok) return setProblem(result.message);
    setValues((v) => ({ ...v, ...prefillLines(v, readyMade) }));
    setSave("saved");
  }

  // A leader the church has let choose picks a goal from the list. What is typed is saved first. The database then refills the Success
  // Picture lines the leader has not written, and may rename a tribe that still has its appointment name, so the card is read back.
  async function chooseGoal(slug: string) {
    if (!hints || !editable || choosing || slug === values.goal) return;
    const item = hints.goals.find((g) => g.slug === slug);
    if (!item) return;
    setChoosing(slug);
    setProblem(null);
    await flush();
    setSave("saving");
    let result;
    try {
      result = await saveCardAction(card.id, hints.communityToo ? { community: item.community, goal: item.slug } : { goal: item.slug });
    } catch {
      result = { ok: false as const, message: "We couldn’t save that. Check your connection and try again." };
    }
    if (!result.ok) {
      setChoosing(null);
      setSave("error");
      return setProblem(result.message);
    }
    const fresh = await goalHintsAction(card.id).catch(() => null);
    if (fresh?.ok && fresh.hints) {
      const h = fresh.hints;
      setHints(h);
      setValues((v) => ({ ...v, community: h.community ?? v.community, goal: h.goal ?? v.goal, name: h.name, god: h.lines.god, others: h.lines.others, life: h.lines.life }));
    } else {
      setValues((v) => ({ ...v, community: hints.communityToo ? item.community : v.community, goal: item.slug }));
    }
    setChoosing(null);
    setSave("saved");
    router.refresh();
  }

  async function send() {
    setSubmitting(true);
    setProblem(null);
    await flush();
    const result = await submitCardAction(card.id);
    setSubmitting(false);
    if (!result.ok) return setProblem(result.message);
    router.refresh();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-start">
      <div className="flex flex-col gap-6">
        {card.status === "changes_requested" && card.review_note ? (
          <section aria-labelledby="changes-heading" className="rounded-[var(--radius-card)] border-[1.5px] border-flame bg-flame/10 p-5">
            <h2 id="changes-heading" className="font-semibold">
              The pastorate asked for changes
            </h2>
            <p className="t-body mt-1 whitespace-pre-line">{card.review_note}</p>
          </section>
        ) : null}
        {card.status === "submitted" ? (
          <section className="card flex flex-col gap-1 p-5">
            <h2 className="font-semibold">With the pastorate</h2>
            <p className="t-body text-soft">Your card is being read. It is locked while they do, and you will see the answer here.</p>
          </section>
        ) : null}
        {card.status === "approved" ? (
          <section className="card flex flex-col gap-1 p-5">
            <h2 className="font-semibold">Published</h2>
            <p className="t-body text-soft">
              Members can now find your tribe. {card.certified ? "You are certified." : "Members are matched to you once you are certified."}
            </p>
          </section>
        ) : null}

        <Section title="Your tribe" step="1">
          <Input
            label="Tribe name"
            name="name"
            value={values.name}
            maxLength={LIMITS.name.max}
            disabled={!editable}
            hint="Members see this first. Make it warm and clear."
            onChange={(e) => change({ name: e.target.value })}
            onBlur={() => void flush()}
          />
          <div className="flex flex-col gap-2">
            <p className="text-[0.95rem] font-medium">Who it is for</p>
            <Segmented
              name="tribe_type"
              label="Who the tribe is for"
              value={values.tribe_type}
              options={TRIBE_TYPES.map((t) => ({ value: t.id, label: t.label }))}
              onChange={(v) => change({ tribe_type: v }, true)}
            />
            <p className="t-small text-soft">{TRIBE_TYPES.find((t) => t.id === values.tribe_type)?.description}.</p>
          </div>
          <Select label="Seats" name="capacity" value={values.capacity} disabled={!editable} onChange={(e) => change({ capacity: Number(e.target.value) }, true)}>
            {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
              <option key={n} value={n}>
                {n} members{n === 12 ? " (the most)" : ""}
              </option>
            ))}
          </Select>
        </Section>

        <Section title="What it is built on" step="2">
          {hints ? null : fixed.size === 3 ? (
            <p className="t-small text-soft">These come from your approved application, because your tribe is built on the goal you have lived.</p>
          ) : (
            <p className="t-small text-soft">Choose the community and Season Goal your tribe is built on. Anything from your application is already filled in.</p>
          )}
          {fixed.has("track") ? (
            <Fixed label="Life-stage track" value={track?.name ?? card.track?.name ?? ""} />
          ) : (
            <Select label="Life-stage track" name="track" value={values.track} disabled={!editable} onChange={(e) => change({ track: e.target.value }, true)}>
              <option value="">Choose a track</option>
              {catalogue.tracks.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name} · {t.ages}
                </option>
              ))}
            </Select>
          )}
          {fixed.has("community") || hints?.communityToo ? (
            <Fixed label="Community" value={community?.name ?? card.community?.name ?? ""} />
          ) : (
            <Select label="Community" name="community" value={values.community} disabled={!editable} onChange={(e) => change({ community: e.target.value, goal: "" }, true)}>
              <option value="">Choose a community</option>
              {catalogue.communities.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          {hints ? (
            <GoalPicker hints={hints} selected={values.goal} busy={choosing} disabled={!editable} onPick={(slug) => void chooseGoal(slug)} />
          ) : fixed.has("goal") ? (
            <Fixed label="Season Goal" value={goal?.title ?? card.goal?.title ?? ""} />
          ) : (
            <Select label="Season Goal" name="goal" value={values.goal} disabled={!editable || !community} onChange={(e) => change({ goal: e.target.value }, true)}>
              <option value="">{community ? "Choose a goal" : "Choose a community first"}</option>
              {community?.goals.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.title}
                </option>
              ))}
            </Select>
          )}
        </Section>

        <Section title="Your story with this goal" step="3">
          <Textarea
            label="In a couple of sentences"
            name="story"
            value={values.story}
            maxLength={LIMITS.story.max}
            disabled={!editable}
            rows={5}
            hint={`Members read this when they choose. ${values.story.trim().length} of ${LIMITS.story.max} characters.`}
            onChange={(e) => change({ story: e.target.value })}
            onBlur={() => void flush()}
          />
          {editable && applicationStory && values.story.trim().length === 0 ? (
            <div>
              <Button type="button" variant="quiet" size="sm" onClick={() => change({ story: storyForCard(applicationStory) }, true)}>
                Start from my application story
              </Button>
            </div>
          ) : null}
        </Section>

        <Section title="When and where" step="4">
          <div className="flex flex-col gap-2">
            <p id="day-label" className="text-[0.95rem] font-medium">
              Day
            </p>
            <div role="group" aria-labelledby="day-label" className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <Chip key={d.value} selected={values.meeting_day === d.value} disabled={!editable} onClick={() => setDay(d.value)} aria-label={d.long}>
                  {d.short}
                </Chip>
              ))}
            </div>
          </div>
          <Select
            label="Start time"
            name="meeting_time"
            value={values.meeting_time}
            disabled={!editable || times.length === 0}
            onChange={(e) => change({ meeting_time: e.target.value }, true)}
          >
            <option value="">{values.meeting_day === null ? "Choose a day first" : "Choose a time"}</option>
            {times.map((t) => (
              <option key={t} value={t}>
                {clockLabel(t)}
              </option>
            ))}
          </Select>
          <p className="t-small -mt-2 text-soft">
            Times avoid rush hour: weeknights from 7:30 pm, Saturday mornings, Sunday afternoons and evenings. A meeting is {card.duration_minutes} minutes.
          </p>
          <div className="flex flex-col gap-2">
            <p className="text-[0.95rem] font-medium">Format</p>
            <Segmented
              name="mode"
              label="Format"
              value={values.mode || null}
              options={[
                { value: "online", label: "Online" },
                { value: "in_person", label: "In person" },
              ]}
              onChange={(v) => change({ mode: v }, true)}
            />
          </div>
          <Select label="Zone" name="zone" value={values.zone} disabled={!editable} onChange={(e) => change({ zone: e.target.value }, true)}>
            <option value="">Choose a zone</option>
            {ZONES.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </Select>
          <Input
            label="Area, in general terms"
            name="place_note"
            value={values.place_note}
            maxLength={LIMITS.place.max}
            optional
            disabled={!editable}
            hint="For example, “Yaba side, mostly online”. Never your home address."
            onChange={(e) => change({ place_note: e.target.value })}
            onBlur={() => void flush()}
          />
        </Section>

        <Section title="Your draft Success Picture" step="5">
          <p className="t-small text-soft">
            One line for each value. In week 1 your tribe will refine these and sign them as its Tribe Covenant. Make each line something the whole tribe could see happen.
          </p>
          {readyMade ? <ReadyMadePanel r={readyMade} canUse={editable && linesLeft} loading={starting} onUse={() => void startFromReadyMade()} /> : null}
          {LINE_FIELDS.map((f) => (
            <Textarea
              key={f.key}
              label={f.label}
              name={f.key}
              value={values[f.key]}
              maxLength={LIMITS.line.max}
              disabled={!editable}
              rows={3}
              placeholder={f.example}
              hint={f.hint}
              onChange={(e) => change({ [f.key]: e.target.value } as Partial<CardValues>)}
              onBlur={() => void flush()}
            />
          ))}
        </Section>

        {editable ? (
          <section aria-labelledby="send-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="send-heading" className="t-heading">
                Send to the pastorate
              </h2>
              <SaveNote state={save} />
            </div>
            {moduleBlocks ? (
              <p className="t-body text-soft">
                Pass the module on the Success Picture first, then send your card.{" "}
                <Link href="/lead/academy/the-success-picture" className="font-semibold underline underline-offset-4">
                  Open the module
                </Link>
              </p>
            ) : null}
            {missing.length > 0 ? (
              <div>
                <p className="t-small font-semibold">Still to do</p>
                <ul className="t-small mt-1 flex flex-col gap-0.5 text-soft">
                  {missing.map((m) => (
                    <li key={m}>{CARD_MISSING[m] ?? m}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="t-body text-soft">Everything is filled in. Read the preview once more, then send.</p>
            )}
            {problem ? (
              <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
                {problem}
              </p>
            ) : null}
            <div>
              <Button size="lg" loading={submitting} disabled={!canSend} onClick={() => void send()} className="sm:px-10">
                Send my Tribe Card
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-24" aria-label="Preview">
        <div className="flex items-center justify-between gap-3">
          <h2 className="t-heading">How members will see it</h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <TribePreview values={values} community={community?.name ?? card.community?.name ?? null} track={track?.name ?? card.track?.name ?? null} goal={goal?.title ?? card.goal?.title ?? null} leader={card.leader.name} />
        {card.assistant || card.coach ? (
          <dl className="card grid grid-cols-2 gap-x-4 gap-y-1.5 p-5 text-[0.92rem]">
            <dt className="text-soft">Assistant leader</dt>
            <dd className="font-medium">{card.assistant?.name ?? "Not paired yet"}</dd>
            <dt className="text-soft">Coach</dt>
            <dd className="font-medium">{card.coach?.name ?? "Not assigned yet"}</dd>
          </dl>
        ) : null}
      </aside>
    </div>
  );
}

/** The reviewed card for this goal: a place to start, and a button that puts its lines in the empty boxes. Nothing is overwritten. */
function ReadyMadePanel({ r, canUse, loading, onUse }: { r: ReadyMade; canUse: boolean; loading: boolean; onUse: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4" data-testid="ready-made">
      <div>
        <p className="font-semibold">A ready-made card for this goal</p>
        <p className="t-small text-soft">Written and signed off by the pastorate. Use it as it is, change it, or write your own.</p>
      </div>
      <dl className="t-small flex flex-col gap-1.5">
        {r.whoFor ? (
          <div>
            <dt className="font-semibold">Who it is for</dt>
            <dd className="text-soft">{r.whoFor}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-semibold">Loving God</dt>
          <dd className="text-soft">{r.lovingGod}</dd>
        </div>
        <div>
          <dt className="font-semibold">Loving Others</dt>
          <dd className="text-soft">{r.lovingOthers}</dd>
        </div>
        <div>
          <dt className="font-semibold">Loving Life</dt>
          <dd className="text-soft">{r.lovingLife}</dd>
        </div>
        {r.week12 ? (
          <div>
            <dt className="font-semibold">By week 12</dt>
            <dd className="text-soft">{r.week12}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-semibold">Ideas for the weeks</dt>
          <dd className="text-soft">
            <ol className="list-decimal pl-5">
              {r.arc.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>
          </dd>
        </div>
        {r.guardrail ? (
          <div>
            <dt className="font-semibold">Keep in mind</dt>
            <dd className="text-soft">{r.guardrail}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        {canUse ? (
          <Button type="button" variant="quiet" size="sm" loading={loading} onClick={onUse}>
            Start from the ready-made card
          </Button>
        ) : (
          <p className="t-small text-soft">Your three lines are already written, so nothing is changed.</p>
        )}
      </div>
    </div>
  );
}

function Section({ title, step, children }: { title: string; step: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`sec-${step}`} className="card flex flex-col gap-5 p-5 sm:p-7">
      <h2 id={`sec-${step}`} className="t-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fixed({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[0.95rem] font-medium">{label}</p>
      <p className="flex min-h-14 items-center rounded-[var(--radius-control)] border-[1.5px] border-line bg-surface px-4 font-medium">{value}</p>
    </div>
  );
}

function SaveNote({ state }: { state: Save }) {
  return (
    <p className="t-small text-soft" role="status" aria-live="polite">
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved." : state === "error" ? "Not saved" : "Saves as you type."}
    </p>
  );
}
