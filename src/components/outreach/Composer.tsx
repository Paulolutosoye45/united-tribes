"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  sampleAudienceAction, saveBroadcastAction, submitBroadcastAction, testBroadcastAction, type DraftFields,
} from "@/app/(app)/admin/announcements/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { announcementSpec, wordingProblem } from "@/lib/outreach/compose";
import { BUTTON_TARGETS, LEFT_OUT_REASONS, NAME_FIELDS, REACH_STARTERS, STARTERS, audienceLabel } from "@/lib/outreach/labels";
import type { AudiencePreview, AudienceSample, AudienceSpec, Broadcast, SavedAudience } from "@/lib/outreach/types";
import { AudiencePicker } from "./AudiencePicker";
import { EmailFrame } from "./EmailFrame";

type Props = {
  initial: Broadcast | null;
  saved: SavedAudience[];
  communities: { id: string; name: string }[];
  champion: boolean;
  site: string;
  church: { name: string; address: string };
  threshold: number;
  perMinute: number;
  hours: { from: number; to: number };
  /** Contact gaps is On: the “cannot be reached” audience and its three notes are offered. */
  reach?: boolean;
  /** Where to begin, from a link on the Contact gaps page. A draft that already exists wins. */
  start?: AudienceSpec | null;
};

const STEPS = ["Who", "Write", "When", "Send"] as const;
const input = "h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none";
const area = "min-h-[7rem] w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 py-3 text-base leading-relaxed focus:border-ink focus:outline-none";

const pad = (n: number) => String(n).padStart(2, "0");
/** Lagos has no daylight saving: its time is always UTC+1. */
const lagosIso = (date: string, hour: number) => `${date}T${pad(hour)}:00:00+01:00`;
const lagosTomorrow = () => {
  const d = new Date(Date.now() + 3600_000 + 86400_000);
  return d.toISOString().slice(0, 10);
};
const hourText = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "am" : "pm"}`;

export function Composer({ initial, saved, communities, champion, site, church, threshold, perMinute, hours, reach = false, start = null }: Props) {
  const router = useRouter();
  const d = useDo();
  const [step, setStep] = useState(0);
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [spec, setSpec] = useState<AudienceSpec>(initial?.audience ?? (!champion && reach && start ? start : champion ? { kind: "started", community: communities[0]?.id } : { kind: "started" }));
  const [label, setLabel] = useState(initial?.audience_label ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [paragraphs, setParagraphs] = useState<string[]>(initial?.paragraphs?.length ? initial.paragraphs : [""]);
  const [button, setButton] = useState<{ label: string; target: string } | null>(initial?.button_label && initial.button_target ? { label: initial.button_label, target: initial.button_target } : null);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [date, setDate] = useState(lagosTomorrow());
  const [hour, setHour] = useState(Math.min(Math.max(10, hours.from), hours.to - 1));
  const [sample, setSample] = useState<AudienceSample | null>(null);
  const [n, setN] = useState(0);
  const [testSent, setTestSent] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const focusRef = useRef<{ kind: "subject" } | { kind: "para"; index: number }>({ kind: "subject" });
  const paraRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  const resolvedLabel = label || audienceLabel(spec, communities);
  const fields = (): DraftFields => ({
    title: title.trim() || subject.trim().slice(0, 60) || "Untitled announcement",
    audience: spec,
    audience_label: resolvedLabel,
    subject: subject.trim(),
    paragraphs: paragraphs.map((p) => p.trim()).filter(Boolean),
    button_label: button?.label.trim() || null,
    button_target: button?.label.trim() ? button.target : null,
  });

  // One person's real values, so the preview shows real names and dates.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const done = await sampleAudienceAction(spec, n).catch(() => null);
      if (live && done?.ok) setSample(done.data);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [spec, n]);

  const vars = useMemo(
    () => (sample?.found && sample.vars ? sample.vars : { first_name: "Adaeze", tribe: "Builders Tribe", season_starts: "9 February 2027", my_page: "/home" }),
    [sample],
  );
  const design = useMemo(
    () => announcementSpec({ subject, paragraphs, button_label: button?.label ?? null, button_target: button?.target ?? null }, vars, site, church),
    [subject, paragraphs, button, vars, site, church],
  );

  const problems = [subject, ...paragraphs, button?.label ?? ""].map((t) => wordingProblem(t)).filter((p): p is string => Boolean(p));
  const written = subject.trim().length > 0 && paragraphs.some((p) => p.trim().length > 0);
  const checks = [
    { ok: /\{first_name\}/.test(subject + paragraphs.join(" ")), text: "Uses their name" },
    { ok: subject.length > 0 && subject.length <= 60, text: subject.length > 60 ? "Subject is long: it may be cut off on a phone" : "Subject fits on a phone" },
    { ok: !/[A-Z]{6,}/.test(subject), text: "No shouting in capitals" },
    { ok: paragraphs.filter((p) => p.trim()).length <= 4, text: "Short enough to read in a minute" },
    { ok: Boolean(button?.label.trim()) , text: "One clear button" },
  ];

  function insert(field: string) {
    const tag = `{${field}}`;
    const f = focusRef.current;
    if (f.kind === "subject") {
      const el = subjectRef.current;
      const at = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? at;
      setSubject(subject.slice(0, at) + tag + subject.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(at + tag.length, at + tag.length);
      });
    } else {
      const el = paraRefs.current[f.index];
      const text = paragraphs[f.index] ?? "";
      const at = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? at;
      setParagraphs(paragraphs.map((p, i) => (i === f.index ? text.slice(0, at) + tag + text.slice(end) : p)));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(at + tag.length, at + tag.length);
      });
    }
  }

  function startWith(starterId: string) {
    const s = [...STARTERS, ...REACH_STARTERS].find((x) => x.id === starterId);
    if (!s) return;
    setSubject(s.subject);
    setParagraphs([...s.paragraphs]);
    setButton(s.button_label && s.button_target ? { label: s.button_label, target: s.button_target } : null);
    if (!title.trim()) setTitle(s.title);
  }

  async function saveDraft(): Promise<string | null> {
    const done = await saveBroadcastAction(id, fields());
    if (!done.ok) {
      throw new Error(done.message);
    }
    setId(done.data);
    return done.data;
  }

  const saveStep = () =>
    d.go(
      "save",
      async () => {
        try {
          await saveDraft();
          return { ok: true };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : "We couldn’t save that." };
        }
      },
      { saved: "Draft saved." },
    );

  const count = preview?.will_send ?? 0;
  const needsApproval = preview?.needs_approval ?? false;
  const minutes = Math.max(1, Math.ceil(count / Math.max(perMinute, 1)));

  async function send() {
    await d.go(
      "send",
      async () => {
        try {
          const saved = await saveDraft();
          if (!saved) return { ok: false, message: "We couldn’t save that." };
          const at = when === "later" ? lagosIso(date, hour) : null;
          const done = await submitBroadcastAction(saved, at);
          if (!done.ok) return done;
          router.push(`/admin/announcements/${saved}?sent=${done.data.status}`);
          return { ok: true };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : "We couldn’t send that." };
        }
      },
      {},
    );
  }

  async function test() {
    await d.go(
      "test",
      async () => {
        try {
          const saved = await saveDraft();
          if (!saved) return { ok: false, message: "We couldn’t save that." };
          return await testBroadcastAction(saved);
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : "We couldn’t send the test." };
        }
      },
      { saved: "Sent to you. It arrives in a minute or so; check your inbox on your phone.", after: () => setTestSent(true) },
    );
  }

  return (
    <div className="flex flex-col gap-8" data-testid="composer">
      <ol className="flex gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              onClick={() => i <= step || (i === 1 && preview) || (i === 2 && written) || (i === 3 && written) ? setStep(i) : undefined}
              aria-current={i === step ? "step" : undefined}
              className={`press flex w-full flex-col gap-1.5 text-left`}
            >
              <span className={`h-1.5 rounded-full ${i <= step ? "bg-flame" : "bg-surface-strong"}`} />
              <span className={`t-small ${i === step ? "font-semibold" : "text-soft"}`}>
                {i + 1}. {s}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="flex flex-col gap-6">
          <AudiencePicker
            spec={spec}
            champion={champion}
            reach={reach}
            communities={communities}
            saved={saved}
            onChange={(s, l) => {
              setSpec(s);
              setLabel(l);
              setN(0);
            }}
            onPreview={setPreview}
          />
          <div className="flex justify-end">
            <Button size="lg" disabled={!preview || count === 0} onClick={() => setStep(1)}>
              Next: write it
            </Button>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="t-small font-medium">Start from a note (optional)</p>
              <div className="flex flex-wrap gap-2">
                {(reach && !champion ? [...STARTERS, ...REACH_STARTERS] : STARTERS).map((s) => (
                  <button key={s.id} type="button" onClick={() => startWith(s.id)} className="press t-small min-h-11 rounded-full border-[1.5px] border-line bg-raised px-4 font-medium hover:border-soft">
                    {s.title}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-2">
              <span className="t-small font-medium">A name for you to find it by (only you see this)</span>
              <input className={input} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Welcome back, March" />
            </label>

            <div className="flex flex-col gap-2">
              <p className="t-small font-medium">Add a name field</p>
              <div className="flex flex-wrap gap-2">
                {NAME_FIELDS.map((f) => (
                  <button key={f.key} type="button" onClick={() => insert(f.key)} className="press t-small min-h-11 rounded-full bg-gold/30 px-4 font-semibold">
                    + {f.label}
                  </button>
                ))}
              </div>
              <p className="t-small text-soft">Each person’s own name, tribe and dates are filled in when it is sent.</p>
            </div>

            <label className="flex flex-col gap-2">
              <span className="t-small font-medium">Subject</span>
              <input
                ref={subjectRef}
                className={input}
                value={subject}
                maxLength={160}
                onFocus={() => (focusRef.current = { kind: "subject" })}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Your tribe is waiting, {first_name}"
              />
              <span className={`t-small ${subject.length > 60 ? "text-flame-deep" : "text-soft"}`}>{subject.length} characters. Under 60 reads well on a phone.</span>
            </label>

            <div className="flex flex-col gap-3">
              <p className="t-small font-medium">The words</p>
              {paragraphs.map((p, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <textarea
                    ref={(el) => {
                      paraRefs.current[i] = el;
                    }}
                    className={area}
                    value={p}
                    maxLength={1200}
                    aria-label={`Paragraph ${i + 1}`}
                    onFocus={() => (focusRef.current = { kind: "para", index: i })}
                    onChange={(e) => setParagraphs(paragraphs.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={i === 0 ? "Say it the way you would to someone at church." : ""}
                  />
                  {paragraphs.length > 1 ? (
                    <button type="button" className="t-small self-end text-soft underline underline-offset-4" onClick={() => setParagraphs(paragraphs.filter((_, j) => j !== i))}>
                      Remove paragraph
                    </button>
                  ) : null}
                </div>
              ))}
              {paragraphs.length < 6 ? (
                <Button variant="ghost" size="sm" onClick={() => setParagraphs([...paragraphs, ""])}>
                  + Add a paragraph
                </Button>
              ) : null}
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" className="size-5 accent-[var(--flame)]" checked={Boolean(button)} onChange={(e) => setButton(e.target.checked ? { label: "Carry on", target: "/home" } : null)} />
                <span className="font-medium">Add a button</span>
              </label>
              {button ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="t-small text-soft">What it says</span>
                    <input className={input} value={button.label} maxLength={40} onFocus={() => undefined} onChange={(e) => setButton({ ...button, label: e.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="t-small text-soft">Where it takes them</span>
                    <select className={input} value={button.target} onChange={(e) => setButton({ ...button, target: e.target.value })}>
                      {BUTTON_TARGETS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="t-small text-soft sm:col-span-2">Buttons only open pages inside United Tribes. “Where they stopped” brings someone back to the exact step they were on.</p>
                </div>
              ) : null}
            </div>

            {problems.length > 0 ? (
              <ul role="alert" className="flex flex-col gap-1 rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
                {[...new Set(problems)].map((p) => (
                  <li key={p} className="t-small">
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}

            <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Checks">
              {checks.map((c) => (
                <li key={c.text} className={`t-small ${c.ok ? "text-success" : "text-soft"}`}>
                  {c.ok ? "✓" : "○"} {c.text}
                </li>
              ))}
            </ul>

            <Notice error={d.error} saved={d.saved} />
            <div className="flex flex-wrap justify-between gap-3">
              <Button variant="ghost" size="md" onClick={() => setStep(0)}>
                Back
              </Button>
              <div className="flex flex-wrap gap-3">
                <Button variant="quiet" size="md" loading={d.busy === "save"} disabled={!written || problems.length > 0} onClick={() => void saveStep()}>
                  Save draft
                </Button>
                <Button size="lg" disabled={!written || problems.length > 0} onClick={() => setStep(2)}>
                  Next: when
                </Button>
              </div>
            </div>
          </div>

          <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="t-small font-medium">
                As {vars.first_name} will read it{sample?.found && sample.of ? ` (${n + 1} of ${sample.of.toLocaleString("en")})` : ""}
              </p>
              <div className="flex gap-1">
                <button type="button" aria-label="Previous person" className="press min-h-11 min-w-11 rounded-full bg-surface font-semibold disabled:opacity-40" disabled={n === 0} onClick={() => setN(Math.max(0, n - 1))}>
                  ←
                </button>
                <button type="button" aria-label="Next person" className="press min-h-11 min-w-11 rounded-full bg-surface font-semibold disabled:opacity-40" disabled={!sample?.of || n + 1 >= sample.of} onClick={() => setN(n + 1)}>
                  →
                </button>
              </div>
            </div>
            <EmailFrame spec={design} />
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="t-heading mb-1">When should it go?</legend>
            <label className={`card flex cursor-pointer items-start gap-3 p-4 ${when === "now" ? "ring-2 ring-ink" : ""}`}>
              <input type="radio" name="when" className="mt-1 size-5 accent-[var(--flame)]" checked={when === "now"} onChange={() => setWhen("now")} />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">As soon as it can</span>
                <span className="t-small text-soft">
                  Emails go out between {hourText(hours.from)} and {hourText(hours.to)} Lagos time, about {perMinute} a minute, so {count.toLocaleString("en")} {count === 1 ? "person takes" : "people take"} about {minutes} minute{minutes === 1 ? "" : "s"}.
                  If it is later than that, it starts tomorrow morning.
                </span>
              </span>
            </label>
            <label className={`card flex cursor-pointer items-start gap-3 p-4 ${when === "later" ? "ring-2 ring-ink" : ""}`}>
              <input type="radio" name="when" className="mt-1 size-5 accent-[var(--flame)]" checked={when === "later"} onChange={() => setWhen("later")} />
              <span className="flex flex-col gap-3">
                <span className="font-semibold">Pick a time</span>
                {when === "later" ? (
                  <span className="flex flex-wrap gap-3">
                    <input type="date" className={`${input} w-auto`} value={date} min={lagosTomorrow()} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
                    <select className={`${input} w-auto`} value={hour} onChange={(e) => setHour(Number(e.target.value))} aria-label="Hour, Lagos time">
                      {Array.from({ length: hours.to - hours.from }, (_, i) => hours.from + i).map((h) => (
                        <option key={h} value={h}>
                          {hourText(h)}
                        </option>
                      ))}
                    </select>
                    <span className="t-small self-center text-soft">Lagos time</span>
                  </span>
                ) : null}
              </span>
            </label>
          </fieldset>

          <div className="card flex flex-col gap-3 p-5">
            <h3 className="font-semibold">See it in a real inbox first</h3>
            <p className="t-small text-soft">Sends this email to you and nobody else. Open it on your phone to check how it feels.</p>
            <div>
              <Button variant="quiet" size="md" loading={d.busy === "test"} onClick={() => void test()}>
                {testSent ? "Send another test to me" : "Send a test to me"}
              </Button>
            </div>
          </div>

          <div className="card flex items-center justify-between gap-3 p-5 opacity-60" aria-disabled="true">
            <div className="flex flex-col gap-0.5">
              <h3 className="font-semibold">WhatsApp</h3>
              <p className="t-small text-soft">Send to people’s WhatsApp as well.</p>
            </div>
            <span className="rounded-full bg-surface-strong px-3 py-1 text-[0.8rem] font-semibold">Not set up yet</span>
          </div>

          <Notice error={d.error} saved={d.saved} />
          <div className="flex justify-between gap-3">
            <Button variant="ghost" size="md" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button size="lg" onClick={() => setStep(3)}>
              Next: review
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-6">
          <h2 className="t-heading">Ready?</h2>
          <dl className="card grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <dt className="t-small text-soft">To</dt>
              <dd className="font-semibold">{resolvedLabel}</dd>
              <dd className="t-small text-soft">
                {count.toLocaleString("en")} {count === 1 ? "person" : "people"}
                {preview && preview.total > count
                  ? `, ${(preview.total - count).toLocaleString("en")} left out (${Object.entries(preview.skipped).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${(LEFT_OUT_REASONS[k] ?? k).toLowerCase()}`).join(", ")})`
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="t-small text-soft">Subject</dt>
              <dd className="font-semibold">{design.subject}</dd>
            </div>
            <div>
              <dt className="t-small text-soft">When</dt>
              <dd className="font-semibold">{when === "now" ? "As soon as it can" : `${new Date(`${date}T12:00:00+01:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}, ${hourText(hour)}`}</dd>
              <dd className="t-small text-soft">Lagos time, between {hourText(hours.from)} and {hourText(hours.to)}</dd>
            </div>
            <div>
              <dt className="t-small text-soft">Button</dt>
              <dd className="font-semibold">{button?.label.trim() ? button.label : "None"}</dd>
            </div>
          </dl>

          {needsApproval ? (
            <p role="note" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3">
              {champion
                ? "A community champion’s announcements always need another person’s approval. It will go to the office to read, and nothing is sent until they say yes."
                : `This goes to ${threshold} or more people, so someone other than you has to read it and say yes. Nothing is sent until they do. The list of people is fixed at the moment they approve.`}
            </p>
          ) : (
            <p className="t-small text-soft">The list of people is fixed when you press send. You can pause or cancel it afterwards, and anyone not yet sent to will be left out.</p>
          )}

          <Notice error={d.error} saved={d.saved} />
          <div className="flex flex-wrap justify-between gap-3">
            <Button variant="ghost" size="md" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button size="lg" loading={d.busy === "send"} disabled={!written || problems.length > 0 || count === 0} onClick={() => void send()}>
              {needsApproval ? "Send for approval" : when === "now" ? `Send to ${count.toLocaleString("en")}` : "Schedule it"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
