"use client";

import { useState } from "react";
import { setLeaderModeAction, setLeaderSettingsAction } from "@/app/(app)/admin/leader-quality/actions";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { SETTING_INFO, type LeaderAiOverview, type SettingKey } from "@/lib/leaders/quality/admin";
import { MODE_LABEL } from "@/lib/leaders/quality/wording";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

type Mode = "off" | "shadow" | "on";
export type Setup = { token: boolean; provider: string | null };

const MODES: { id: Mode; title: string; body: string }[] = [
  { id: "off", title: "Off", body: "Nothing runs. Applications work exactly as they did before the first check existed." },
  {
    id: "shadow",
    title: "Recording only",
    body: "Every new application is read and scored behind the scenes. Nobody is held up and applicants see nothing. Use this for a week or two to see how it behaves before it can hold anyone.",
  },
  {
    id: "on",
    title: "On",
    body: "Written answers are checked as people write them. An application that passes goes straight on. One that does not is sent back with a kind note, or held for a pastor. The AI never turns anyone down.",
  },
];

/** The switch, with what the recording-only run found and what must be in place first. */
export function ModeSwitch({ overview, setup }: { overview: LeaderAiOverview; setup: Setup }) {
  const d = useDo();
  const current = overview.settings.mode;
  const [mode, setMode] = useState<Mode>(current);
  const [confirming, setConfirming] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);
  const s = overview.shadow;

  // Things that stop it working at all (the switch refuses), and things worth knowing first (the switch still works).
  const problems: string[] = [];
  const cautions: string[] = [];
  if (mode !== "off") {
    if (!setup.token) problems.push("The sending service key (WORKER_TOKEN) is not set on this site, so checks cannot run. Set it first.");
    if (!setup.provider) problems.push("No AI service key is set, so only the plain checks can run and every application would be held for a person. Add a key first.");
    else if (setup.provider === "mock") cautions.push("The AI service is in test mode: the scores come from a simple word-matching stand-in, not a real model. That is fine for a rehearsal. Use a real key before real applicants.");
  }

  async function apply() {
    const ok = await d.go("mode", async () => {
      const result = await setLeaderModeAction(mode);
      if (result.ok) setQueued(result.queued ?? 0);
      return result;
    });
    if (ok) setConfirming(false);
  }

  return (
    <section aria-labelledby="mode-heading" className="card flex flex-col gap-5 p-5 sm:p-6" data-testid="mode-switch">
      <div className="flex flex-col gap-1">
        <h2 id="mode-heading" className="t-heading">
          The switch
        </h2>
        <p className="t-small text-soft">
          Now: <strong className="text-ink" data-testid="mode-now">{MODE_LABEL[current]}</strong>
          {overview.settings.activated_at ? ` · first switched on ${new Date(overview.settings.activated_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" })}` : ""}
        </p>
      </div>

      <div role="radiogroup" aria-label="First check" className="flex flex-col gap-3">
        {MODES.map((m) => (
          <Choice
            key={m.id}
            name="leader-mode"
            value={m.id}
            checked={mode === m.id}
            onChange={() => {
              setMode(m.id);
              setConfirming(false);
              setQueued(null);
              d.clear();
            }}
            title={m.id === current ? `${m.title} (now)` : m.title}
            description={m.body}
          />
        ))}
      </div>

      {s.applications > 0 ? (
        <div className="rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid="shadow-results">
          <p className="font-semibold">What the recording-only run found</p>
          <p className="t-small mt-1 text-soft">
            {s.applications} {s.applications === 1 ? "application" : "applications"} read. Judged by today’s thresholds, {s.would_clear} would pass, {s.would_strengthen} would be asked for more and {s.would_hold} would be held for a person.
            {s.instant_only > 0 ? ` ${s.instant_only} stopped at the plain checks.` : ""}
          </p>
        </div>
      ) : null}

      {problems.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="mode-problems">
          {problems.map((p) => (
            <li key={p} className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
              {p}
            </li>
          ))}
        </ul>
      ) : null}

      {cautions.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="mode-cautions">
          {cautions.map((p) => (
            <li key={p} className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3">
              {p}
            </li>
          ))}
        </ul>
      ) : null}

      {confirming ? (
        <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4">
          <p className="font-semibold">Switch the first check to “{MODE_LABEL[mode]}”?</p>
          <p className="t-small text-soft">
            {mode === "on"
              ? "Applications already sent that no reviewer has scored yet are taken in and read. Applicants who agreed to the earlier wording are asked to agree to one new sentence first. This is recorded with your name."
              : mode === "shadow"
                ? "Applications already sent that no reviewer has scored yet are read behind the scenes. Nobody is told and nobody is held up. This is recorded with your name."
                : "Applicants are no longer checked, and nobody is held. Applications already held stay as they are until a person reads them. This is recorded with your name."}
          </p>
          <div className="flex gap-3">
            <Button variant="solid" size="md" loading={d.busy === "mode"} disabled={problems.length > 0} onClick={() => void apply()}>
              Yes, switch it
            </Button>
            <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="md" disabled={mode === current} onClick={() => setConfirming(true)}>
            Switch to {MODE_LABEL[mode].toLowerCase()}
          </Button>
        </div>
      )}
      <Notice error={d.error} saved={queued !== null ? `Done.${queued > 0 ? ` ${queued} waiting ${queued === 1 ? "application" : "applications"} taken in.` : ""}` : d.saved} />
    </section>
  );
}

/** The thresholds. Pastors and the director edit these; the consent settings are the director's alone. */
export function Thresholds({ overview, isDirector }: { overview: LeaderAiOverview; isDirector: boolean }) {
  const d = useDo();
  const stored = overview.settings as unknown as Record<string, number>;
  const shown = (key: SettingKey, scale: number) => String(Math.round(Number(stored[key]) * scale * 100) / 100);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(SETTING_INFO.map((i) => [i.key, shown(i.key, i.scale)])));
  const [version, setVersion] = useState(overview.settings.consent_version);
  const [covers, setCovers] = useState(overview.settings.ai_consent_covers_old);
  const [problem, setProblem] = useState<string | null>(null);

  const changedNumbers = SETTING_INFO.filter((i) => values[i.key].trim() !== shown(i.key, i.scale));
  const versionChanged = isDirector && version.trim() !== overview.settings.consent_version;
  const coversChanged = isDirector && covers !== overview.settings.ai_consent_covers_old;
  const dirty = changedNumbers.length > 0 || versionChanged || coversChanged;

  function save() {
    const changes: Record<string, unknown> = {};
    for (const i of changedNumbers) {
      const typed = Number(values[i.key]);
      if (values[i.key].trim() === "" || !Number.isFinite(typed)) return setProblem(`${i.label}: type a number.`);
      if (typed < i.min - 1e-9 || typed > i.max + 1e-9) return setProblem(`${i.label}: choose a number from ${i.min} to ${i.max}.`);
      changes[i.key] = Math.round((typed / i.scale) * 1000) / 1000;
    }
    if (versionChanged) changes.consent_version = version.trim();
    if (coversChanged) changes.ai_consent_covers_old = covers;
    setProblem(null);
    void d.go("settings", () => setLeaderSettingsAction(changes), { saved: "Saved. It applies from the next application." });
  }

  return (
    <section aria-labelledby="thresholds-heading" className="flex flex-col gap-4" data-testid="thresholds">
      <div>
        <h2 id="thresholds-heading" className="t-heading">
          Thresholds
        </h2>
        <p className="t-small text-soft">What counts as passing, and how patient the check is. The usual settings suit most churches. Change one at a time and watch the held list.</p>
      </div>
      <form
        noValidate
        className="card flex flex-col divide-y divide-line p-0"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {SETTING_INFO.map((i) => (
          <div key={i.key} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <label htmlFor={`lq-${i.key}`} className="font-semibold">
                {i.label}
              </label>
              <p className="t-small text-soft">{i.help}</p>
              <p className="t-small text-soft">
                Usual setting {i.fallback} {i.unit === "%" || i.unit === "out of 5" ? (i.unit === "%" ? "%" : "out of 5") : i.unit}. Allowed from {i.min} to {i.max}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                id={`lq-${i.key}`}
                inputMode="decimal"
                value={values[i.key]}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [i.key]: e.target.value }));
                  setProblem(null);
                }}
                className="h-12 w-24 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-right text-base focus:border-ink focus:outline-none"
              />
              <span className="t-small w-16 text-soft">{i.unit}</span>
            </div>
          </div>
        ))}

        {isDirector ? (
          <div className="flex flex-col gap-4 px-5 py-4" data-testid="consent-settings">
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold">Consent wording (director only)</p>
              <p className="t-small text-soft">
                The version applicants must have agreed to before an AI service may read their answers. Change it only when the wording on the first screen changes in meaning, and have a lawyer check the wording first.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="lq-consent-version" className="t-small font-medium">
                Version
              </label>
              <input
                id="lq-consent-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                maxLength={24}
                className="h-12 w-40 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none"
              />
            </div>
            <Choice
              type="checkbox"
              name="covers-old"
              value="yes"
              checked={covers}
              onChange={(e) => setCovers(e.target.checked)}
              title="The earlier wording already covers an AI service reading the answers"
              description="Leave this off unless a lawyer has said so in writing. While it is off, applicants who agreed to the earlier wording are asked to agree to the new sentence before anything is sent to an AI service."
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-3 px-5 py-4">
          <Notice error={problem ?? d.error} saved={problem ? null : d.saved} />
          <div>
            <Button type="submit" size="md" loading={d.busy === "settings"} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
