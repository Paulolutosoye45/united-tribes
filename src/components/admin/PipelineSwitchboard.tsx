"use client";

import { useState } from "react";
import { applyPresetAction, setPipelineAction } from "@/app/(app)/admin/leader-pipeline/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { NO_TRAINING_WARNING, PRESET_INFO, PRESET_NAME, SWITCHES, SWITCH_BY_ID, SWITCH_GROUPS, positionWord, type SwitchInfo } from "@/lib/admin/wording";
import { SWITCH_IDS, changedSwitches, isWired, settingValue, type Pipeline, type PipelineLogRow, type SwitchId } from "@/lib/leaders/pipeline";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

type Draft = Partial<Record<SwitchId, string>>;

const when = (iso: string) => new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

/** Applies a draft to the positions, so the warning can look at what the page would end up as. */
function withDraft(p: Pipeline, draft: Draft): Pipeline {
  const next: Pipeline = { ...p, eligibility: { ...p.eligibility } };
  for (const id of SWITCH_IDS) {
    const v = draft[id];
    if (v === undefined) continue;
    if (id.startsWith("elig_")) next.eligibility[id.slice(5) as keyof Pipeline["eligibility"]] = v as never;
    else if (id === "references_mode") next.references = v as never;
    else if (id === "interview_mode") next.interview = v as never;
    else if (id === "tribe_fit") next.tribeFit = v === "on";
    else if (id === "academy_mode") next.academy = v as never;
    else next.declaration = v as never;
  }
  return next;
}

/** The switchboard: every step of becoming a leader, where it stands, and (for the office) how to move it. */
export function PipelineSwitchboard({ pipeline, canEdit, log }: { pipeline: Pipeline; canEdit: boolean; log: PipelineLogRow[] }) {
  const d = useDo();
  const [draft, setDraft] = useState<Draft>({});
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [preset, setPreset] = useState<"full" | "open_door" | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const changes = changedSwitches(pipeline, draft);
  const changedIds = Object.keys(changes) as SwitchId[];
  const after = withDraft(pipeline, changes);
  const noTraining = after.academy === "off" && after.declaration === "off" && (changes.academy_mode !== undefined || changes.declaration_mode !== undefined);

  function choose(id: SwitchId, value: string) {
    setDraft((cur) => ({ ...cur, [id]: value }));
    setReviewing(false);
    setUnderstood(false);
    setSaid(null);
    d.clear();
  }

  async function save() {
    const ok = await d.go("save", async () => {
      const result = await setPipelineAction(changes, reason);
      if (result.ok) setSaid(result.changed === 1 ? "Saved. One switch changed." : `Saved. ${result.changed} switches changed.`);
      return result;
    });
    if (ok) {
      setDraft({});
      setReason("");
      setReviewing(false);
      setUnderstood(false);
    }
  }

  async function pressPreset(name: "full" | "open_door") {
    const ok = await d.go("preset", async () => {
      const result = await applyPresetAction(name);
      if (result.ok) setSaid(`${PRESET_NAME[name]} is set.${result.note ? ` ${result.note}` : ""}`);
      return result;
    });
    if (ok) {
      setPreset(null);
      setDraft({});
      setReviewing(false);
    }
  }

  return (
    <div className="flex flex-col gap-8" data-testid="pipeline-switchboard">
      {!canEdit ? (
        <p className="card t-small p-4 text-soft" data-testid="pipeline-readonly">
          You can read this page. Only the office can change it.
        </p>
      ) : null}

      <section aria-labelledby="preset-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 id="preset-heading" className="t-heading">
            Start from a preset
          </h2>
          <p className="t-small text-soft">
            Now: <strong className="text-ink" data-testid="preset-now">{PRESET_NAME[pipeline.preset]}</strong>
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["full", "open_door"] as const).map((name) => (
            <div key={name} className="rounded-[var(--radius-control)] bg-surface px-4 py-4" data-testid={`preset-${name}`}>
              <p className="font-semibold">{PRESET_INFO[name].title}</p>
              <p className="t-small mt-1 text-soft">{PRESET_INFO[name].body}</p>
              {canEdit ? (
                preset === name ? (
                  <div className="pop-in mt-3 flex flex-col gap-3">
                    <p className="t-small">{PRESET_INFO[name].confirm}</p>
                    <div className="flex gap-3">
                      <Button variant="solid" size="md" loading={d.busy === "preset"} onClick={() => void pressPreset(name)}>
                        Yes, set it
                      </Button>
                      <Button variant="ghost" size="md" onClick={() => setPreset(null)}>
                        Not yet
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3">
                    <Button variant="quiet" size="md" onClick={() => setPreset(name)} disabled={pipeline.preset === name}>
                      {pipeline.preset === name ? "In use" : `Use ${PRESET_INFO[name].title.toLowerCase()}`}
                    </Button>
                  </div>
                )
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {SWITCH_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`} className="flex flex-col gap-4" data-testid={`group-${group.id}`}>
          <div className="flex flex-col gap-1">
            <h2 id={`group-${group.id}`} className="t-heading">
              {group.title}
            </h2>
            <p className="t-small measure text-soft">{group.intro}</p>
          </div>
          <div className="flex flex-col gap-4">
            {SWITCHES.filter((s) => s.group === group.id).map((info) => (
              <SwitchCard key={info.id} info={info} now={settingValue(pipeline, info.id)} wanted={draft[info.id]} editable={canEdit && isWired(info.id)} onChoose={(v) => choose(info.id, v)} />
            ))}
          </div>
        </section>
      ))}

      {canEdit && changedIds.length > 0 ? (
        <section aria-labelledby="save-heading" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="pipeline-save">
          <h2 id="save-heading" className="t-heading">
            {changedIds.length === 1 ? "One change to save" : `${changedIds.length} changes to save`}
          </h2>
          <ul className="flex flex-col gap-1">
            {changedIds.map((id) => (
              <li key={id} className="t-small" data-testid={`change-${id}`}>
                <strong>{SWITCH_BY_ID[id].title}:</strong> {positionWord(settingValue(pipeline, id))} → {positionWord(changes[id] ?? "")}
              </li>
            ))}
          </ul>
          <label className="flex flex-col gap-1">
            <span className="t-small font-semibold">Why? (optional, kept in the log)</span>
            <input
              className="input"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: the pastorate agreed this at the October meeting"
              data-testid="pipeline-reason"
            />
          </label>
          {noTraining ? (
            <div className="rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="no-training-warning">
              <p className="t-small">{NO_TRAINING_WARNING}</p>
              <label className="mt-2 flex items-center gap-2 t-small font-semibold">
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} data-testid="no-training-confirm" />I understand this, and the church has decided it.
              </label>
            </div>
          ) : null}
          {reviewing ? (
            <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4">
              <p className="font-semibold">Save these changes?</p>
              <p className="t-small text-soft">The change takes effect straight away for new applicants. Applications already sent keep the steps they were sent with, unless the new position is kinder to them. This is recorded with your name.</p>
              {changes.academy_mode !== undefined || changes.declaration_mode !== undefined ? (
                <p className="t-small text-soft" data-testid="training-change-note">
                  The Academy and the declaration apply to every leader at once, those already in training included. Anyone who becomes certified because of a change stays certified, even if the switch is moved back. Nobody’s certificate is ever withdrawn.
                </p>
              ) : null}
              <div className="flex gap-3">
                <Button variant="solid" size="md" loading={d.busy === "save"} disabled={noTraining && !understood} onClick={() => void save()}>
                  Yes, save
                </Button>
                <Button variant="ghost" size="md" onClick={() => setReviewing(false)}>
                  Not yet
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button size="md" onClick={() => setReviewing(true)} disabled={noTraining && !understood} data-testid="pipeline-review">
                Review and save
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setDraft({});
                  setUnderstood(false);
                  d.clear();
                }}
              >
                Discard
              </Button>
            </div>
          )}
        </section>
      ) : null}

      <Notice error={d.error} saved={said ?? d.saved} />

      <section aria-labelledby="log-heading" className="flex flex-col gap-3" data-testid="pipeline-log">
        <h2 id="log-heading" className="t-heading">
          What has been changed
        </h2>
        {log.length === 0 ? (
          <p className="t-small text-soft">Nothing has been changed yet. Every switch is where the process started.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {log.map((row, i) => (
              <li key={`${row.batch}-${row.setting}-${i}`} className="card t-small p-4">
                <p>
                  <strong>{row.label}:</strong> {positionWord(row.oldValue)} → {positionWord(row.newValue)}
                </p>
                <p className="mt-1 text-soft">
                  {when(row.at)} · by {row.shownAs}
                  {row.preset !== "empty" ? ` · ${PRESET_NAME[row.preset]} preset` : ""}
                </p>
                {row.reason ? <p className="mt-1">“{row.reason}”</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SwitchCard({ info, now, wanted, editable, onChoose }: { info: SwitchInfo; now: string; wanted: string | undefined; editable: boolean; onChoose: (value: string) => void }) {
  const chosen = wanted ?? now;
  return (
    <div className="card flex flex-col gap-3 p-5" data-testid={`switch-${info.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{info.title}</h3>
        <div className="flex items-center gap-2">
          {!isWired(info.id) ? (
            <Badge tone="outline">
              <span data-testid={`not-connected-${info.id}`}>Not connected yet</span>
            </Badge>
          ) : null}
          <Badge tone={now === "off" ? "outline" : "neutral"}>
            <span data-testid={`now-${info.id}`}>{positionWord(now)}</span>
          </Badge>
        </div>
      </div>
      {info.ask ? <p className="t-small text-soft">“{info.ask}”</p> : null}
      {editable ? (
        <div role="radiogroup" aria-label={info.title} className="flex flex-col gap-2">
          {info.options.map((option) => (
            <Choice
              key={option}
              name={`switch-${info.id}`}
              value={option}
              checked={chosen === option}
              onChange={() => onChoose(option)}
              title={option === now ? `${positionWord(option)} (now)` : positionWord(option)}
              description={info.means[option]}
            />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {info.options.map((option) => (
            <li key={option} className={option === now ? "t-small" : "t-small text-soft"}>
              <strong>{positionWord(option)}{option === now ? " (now)" : ""}.</strong> {info.means[option]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
