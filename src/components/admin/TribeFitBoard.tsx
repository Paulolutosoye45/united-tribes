"use client";

import { useState } from "react";
import { approveFitModelAction, runQuietAction, saveFitModelAction } from "@/app/(app)/admin/leader-pipeline/fit-actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  BAR_KEYS,
  WEIGHT_HELP,
  WEIGHT_KEYS,
  WEIGHT_LABEL,
  changedWeights,
  checkProposal,
  proposalFrom,
  weightsLine,
  whatIsMissing,
  type FitModel,
  type FitStatus,
  type Proposal,
} from "@/lib/leaders/fit-admin";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }) : "");

/**
 * Tribe fit, on the Admin page for the leader pipeline: whether it can be switched on, the versions of the model, a way to propose a
 * new one, and the quiet run over the leaders we already have. Only the pastor approves a version, and nothing here is used until then.
 */
export function TribeFitBoard({ status, models, canApprove }: { status: FitStatus | null; models: FitModel[]; canApprove: boolean }) {
  const d = useDo();
  const latest = models.length > 0 ? models[models.length - 1] : null;
  const active = models.find((m) => m.active) ?? null;
  const [proposal, setProposal] = useState<Proposal>(() => proposalFrom(active ?? latest));
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);

  if (!status) {
    return (
      <section aria-labelledby="fit-heading" className="card flex flex-col gap-2 p-5" data-testid="fit-board">
        <h2 id="fit-heading" className="t-heading">
          Tribe fit
        </h2>
        <p className="t-body text-soft">We could not read where this stands. Try the page again in a moment.</p>
      </section>
    );
  }

  const missing = whatIsMissing(status);
  const check = checkProposal(proposal);
  const base = active ?? latest;
  const diff = check.ok && base ? changedWeights(base.weights, check.weights) : {};
  const nothingChanged = check.ok && Object.keys(diff).length === 0;

  async function save() {
    if (!check.ok) return;
    const ok = await d.go("save", async () => {
      const result = await saveFitModelAction(diff, note);
      if (result.ok) setSaid(`Saved as ${result.version ?? "a new version"}. It is not used until the pastor approves it.`);
      return result;
    });
    if (ok) setNote("");
  }

  async function approve(version: string) {
    await d.go(`approve-${version}`, async () => {
      const result = await approveFitModelAction(version);
      if (result.ok) setSaid(`${version} is now the model in use.`);
      return result;
    });
  }

  async function quiet() {
    await d.go("quiet", async () => {
      const result = await runQuietAction();
      if (result.ok) setSaid(result.note ?? "Done.");
      return result;
    });
  }

  return (
    <section aria-labelledby="fit-heading" className="flex flex-col gap-4" data-testid="fit-board">
      <div className="flex flex-col gap-1">
        <h2 id="fit-heading" className="t-heading">
          Tribe fit
        </h2>
        <p className="t-small measure text-soft">
          How a leader’s answers are compared with the tribe cards. The model is a set of weights. A new version is a record that is never edited, and nothing uses it until the pastor approves it.
        </p>
      </div>

      <Notice error={d.error} saved={said} />

      <div className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.on ? "gold" : "outline"}>{status.on ? "Switched on" : "Switched off"}</Badge>
          <Badge tone={status.ready ? "gold" : "flame"}>{status.ready ? "Ready" : "Not ready"}</Badge>
          <span className="t-small text-soft">
            {status.model ? `Model ${status.model.version} approved${status.model.approvedBy ? ` by ${status.model.approvedBy}` : ""}${status.model.approvedAt ? `, ${day(status.model.approvedAt)}` : ""}.` : "No model approved yet."}
          </span>
        </div>
        <p className="t-body" data-testid="fit-cards">
          {status.cardsSignedOff} of {status.cardsTotal} tribe cards are signed off.
        </p>
        {missing.length > 0 ? (
          <ul className="t-small flex flex-col gap-1 rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid="fit-missing">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="card flex flex-col gap-4 p-5">
        <h3 className="t-heading">Versions</h3>
        {models.length === 0 ? <p className="t-body text-soft">No version has been saved.</p> : null}
        <ul className="flex flex-col gap-3">
          {[...models].reverse().map((m) => (
            <li key={m.version} className="flex flex-col gap-1 border-b border-line pb-3 last:border-b-0 last:pb-0" data-testid={`model-${m.version}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.version}</span>
                {m.active ? <Badge tone="gold">In use</Badge> : m.approvedAt ? <Badge tone="outline">Used before</Badge> : <Badge tone="flame">Waiting for the pastor</Badge>}
                {m.parent ? <span className="t-small text-soft">from {m.parent}</span> : null}
                {canApprove && !m.active ? (
                  <Button variant="quiet" size="sm" loading={d.busy === `approve-${m.version}`} onClick={() => void approve(m.version)}>
                    {m.approvedAt ? `Use ${m.version} again` : `Approve ${m.version}`}
                  </Button>
                ) : null}
              </div>
              <p className="t-small text-soft">
                {weightsLine(m.weights)}. Care bar {m.weights.care_bar}. A match of {m.minDegree} or more counts as a good match.
              </p>
              {m.notes ? <p className="t-small">{m.notes}</p> : null}
            </li>
          ))}
        </ul>
        {!canApprove ? <p className="t-small text-soft">Only the pastor can approve a version.</p> : null}
      </div>

      <form
        className="card flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        aria-labelledby="fit-propose"
      >
        <div>
          <h3 id="fit-propose" className="t-heading">
            Propose a new version
          </h3>
          <p className="t-small text-soft">Starts from {base ? base.version : "nothing yet"}. The five parts must add up to 100.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[...WEIGHT_KEYS, ...BAR_KEYS].map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="t-small font-semibold">{WEIGHT_LABEL[k]}</span>
              <input
                className="input tabular-nums"
                inputMode="numeric"
                value={proposal[k]}
                onChange={(e) => {
                  setProposal((p) => ({ ...p, [k]: e.target.value }));
                  setSaid(null);
                  d.clear();
                }}
                aria-describedby={`fit-help-${k}`}
                data-testid={`fit-${k}`}
              />
              <span id={`fit-help-${k}`} className="t-small text-soft">
                {WEIGHT_HELP[k]}
              </span>
            </label>
          ))}
        </div>
        <p className="t-small" data-testid="fit-sum" role="status">
          {check.ok ? `The five parts add up to 100.` : check.total !== null ? check.message : check.message}
        </p>
        <label className="flex flex-col gap-1">
          <span className="t-small font-semibold">Why? (optional, kept with the version)</span>
          <input className="input" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder="For example: more weight on need for this season" />
        </label>
        <div>
          <Button type="submit" size="md" loading={d.busy === "save"} disabled={!check.ok || nothingChanged || !base}>
            Save as a new version
          </Button>
          {check.ok && nothingChanged ? <span className="t-small ml-3 text-soft">Nothing is different from {base?.version}.</span> : null}
        </div>
      </form>

      <div className="card flex flex-col gap-3 p-5">
        <h3 className="t-heading">The leaders we already have</h3>
        <p className="t-small text-soft">
          Looks at what each leader’s saved answers say and files which tribes could suit them next season. Nobody is told and nothing about them changes. It is done once for each model. {status.quietRun} of {status.leaders} {status.leaders === 1 ? "leader has" : "leaders have"} been looked at with the model in use.
        </p>
        <div>
          <Button variant="quiet" size="md" loading={d.busy === "quiet"} disabled={!status.model} onClick={() => void quiet()}>
            Look at the leaders now
          </Button>
          {!status.model ? <span className="t-small ml-3 text-soft">Needs an approved model first.</span> : null}
        </div>
      </div>
    </section>
  );
}
