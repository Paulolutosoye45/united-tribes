"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveCardAction, submitCardAction } from "@/app/(app)/lead/circle/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Segmented } from "@/components/ui/Choice";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { LIMITS, missingFields, storyForCard, valuesFromCard, type CardValues } from "@/lib/academy/card";
import { CARD_MISSING, CARD_STATUS, CIRCLE_TYPES, DAYS, clockLabel, timesFor, ZONES } from "@/lib/academy/options";
import type { MyCircle } from "@/lib/academy/types";
import type { LeaderCatalogue } from "@/lib/leaders/server";
import { CirclePreview } from "./CirclePreview";

type Save = "idle" | "saving" | "saved" | "error";

const LINE_FIELDS = [
  {
    key: "god",
    label: "Loving God",
    hint: "The faith habit your Tribe keeps together.",
    example: "Read the week’s passage and say the confession five days a week.",
  },
  {
    key: "others",
    label: "Loving Others",
    hint: "How your Tribe carries each other.",
    example: "Pray for our triad weekly; nobody misses twice without a call.",
  },
  {
    key: "life",
    label: "Loving Life",
    hint: "The goal outcome, made specific. Say who does what, and how many times.",
    example: "Each of us completes 10 of 12 weekly steps and has one leadership conversation with a manager.",
  },
] as const;

export function CircleBuilder({
  card,
  catalogue,
  applicationStory,
}: {
  card: MyCircle;
  catalogue: LeaderCatalogue;
  applicationStory: string | null;
}) {
  const router = useRouter();
  const editable = card.editable;
  const [values, setValues] = useState<CardValues>(() => valuesFromCard(card));
  const [save, setSave] = useState<Save>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const tribe = catalogue.tribes.find((t) => t.slug === values.tribe) ?? null;
  const track = catalogue.tracks.find((t) => t.slug === values.track) ?? null;
  const goal = tribe?.goals.find((g) => g.slug === values.goal) ?? null;
  const missing = useMemo(() => missingFields(values), [values]);
  const fixed = new Set(card.fixed);
  const times = timesFor(values.meeting_day);
  const status = CARD_STATUS[card.status];
  const canSend = editable && card.module_ok && missing.length === 0;

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
              Members can now find your Tribe. {card.certified ? "You are certified." : "Members are matched to you once you are certified."}
            </p>
          </section>
        ) : null}

        <Section title="Your Tribe" step="1">
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
              name="circle_type"
              label="Who the Tribe is for"
              value={values.circle_type}
              options={CIRCLE_TYPES.map((t) => ({ value: t.id, label: t.label }))}
              onChange={(v) => change({ circle_type: v }, true)}
            />
            <p className="t-small text-soft">{CIRCLE_TYPES.find((t) => t.id === values.circle_type)?.description}.</p>
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
          {fixed.size === 3 ? (
            <p className="t-small text-soft">These come from your approved application, because your Tribe is built on the goal you have lived.</p>
          ) : (
            <p className="t-small text-soft">Choose the tribe and Season Goal your Tribe is built on. Anything from your application is already filled in.</p>
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
          {fixed.has("tribe") ? (
            <Fixed label="Tribe" value={tribe?.name ?? card.tribe?.name ?? ""} />
          ) : (
            <Select label="Tribe" name="tribe" value={values.tribe} disabled={!editable} onChange={(e) => change({ tribe: e.target.value, goal: "" }, true)}>
              <option value="">Choose a tribe</option>
              {catalogue.tribes.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          {fixed.has("goal") ? (
            <Fixed label="Season Goal" value={goal?.title ?? card.goal?.title ?? ""} />
          ) : (
            <Select label="Season Goal" name="goal" value={values.goal} disabled={!editable || !tribe} onChange={(e) => change({ goal: e.target.value }, true)}>
              <option value="">{tribe ? "Choose a goal" : "Choose a tribe first"}</option>
              {tribe?.goals.map((g) => (
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
            One line for each value. In week 1 your Tribe will refine these and sign them as its Tribe Covenant. Make each line something the whole Tribe could see happen.
          </p>
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
            {!card.module_ok ? (
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
        <CirclePreview values={values} tribe={tribe?.name ?? card.tribe?.name ?? null} track={track?.name ?? card.track?.name ?? null} goal={goal?.title ?? card.goal?.title ?? null} leader={card.leader.name} />
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
