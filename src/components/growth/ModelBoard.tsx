"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { activateModelAction, discardModelAction, retrainAction } from "@/app/(app)/growth/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { formatShortDate, plural } from "@/lib/dates";
import { MODEL_KEYS, type ModelRow, type RetrainPreview, type Weights } from "@/lib/growth/types";
import { MODEL_PARTS, correlation, liftText, weightChange } from "@/lib/growth/wording";

export function ModelBoard({
  models,
  preview,
  canChange,
  canPreview,
}: {
  models: ModelRow[];
  preview: RetrainPreview | null;
  canChange: boolean;
  canPreview: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      {canPreview ? <Suggestion preview={preview} canChange={canChange} /> : null}
      <section aria-labelledby="versions-heading" className="flex flex-col gap-3">
        <h2 id="versions-heading" className="t-heading">
          Versions
        </h2>
        {models.length === 0 ? (
          <p className="t-body text-soft">No model has been set up yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {models.map((m) => (
              <li key={m.version}>
                <Version model={m} canChange={canChange} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Suggestion({ preview, canChange }: { preview: RetrainPreview | null; canChange: boolean }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [allowSmall, setAllowSmall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!preview) {
    return (
      <section className="card p-5 sm:p-7">
        <h2 className="t-heading">What the results suggest</h2>
        <p className="t-body mt-2 text-soft">We couldn&rsquo;t read the results just now. Try again in a moment.</p>
      </section>
    );
  }

  const { sample } = preview;
  const status = !preview.enough
    ? `Not enough yet. ${plural(sample.n, "finished placement")} ${sample.n === 1 ? "has" : "have"} a result, ${sample.thriving} of them thriving. There need to be at least five thriving and five who were not before there is anything to learn from.`
    : !preview.ready
      ? `A rough guess. ${plural(sample.n, "placement")} so far, and the weights are normally retrained after ${preview.needed}.`
      : !preview.changed
        ? `${plural(sample.n, "placement")} from ${plural(sample.seasons, "season")}. The results don’t suggest changing the weights yet.`
        : `${plural(sample.n, "placement")} from ${plural(sample.seasons, "season")}: ${sample.thriving} thrived and ${sample.other} did not.`;

  const canMake = canChange && preview.enough && preview.changed;

  async function make() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await retrainAction(notes, allowSmall);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setNotes("");
    setAllowSmall(false);
    router.refresh();
  }

  return (
    <section aria-labelledby="suggest-heading" className="card flex flex-col gap-5 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="suggest-heading" className="t-heading">
          What the results suggest
        </h2>
        <p className="t-body text-soft" role="status">
          {status}
        </p>
        <p className="t-small text-soft">Based on version {preview.base}, the one in use. A member counts as thriving if they came to at least 8 of 12 meetings and felt they belonged.</p>
      </div>

      {preview.enough ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <thead>
                <tr className="t-small border-b border-line text-soft">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Part
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    In use
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Suggested
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Thriving scored higher by
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.components.map((c) => (
                  <tr key={c.key} className="border-b border-line/60">
                    <th scope="row" className="py-2.5 pr-3 font-medium">
                      {MODEL_PARTS[c.key].label}
                      {!c.varies ? <span className="t-small block font-normal text-soft">Everyone scores the same here, so it can&rsquo;t be learned from</span> : null}
                    </th>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.weight}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <span className="font-semibold">{c.proposed}</span>{" "}
                      <span className="t-small text-soft">({weightChange(c.weight, c.proposed)})</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.varies ? liftText(c.lift) : "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="t-small text-soft">
            A check on the same results: how well the weights in use line up with who thrived is {correlation(preview.backtest.now)}; the suggested weights,{" "}
            {correlation(preview.backtest.proposed)}. Higher is better. This is a sanity check on past results, not a promise about the future.
          </p>
        </>
      ) : null}

      {canMake ? (
        <form
          className="flex flex-col gap-4 border-t border-line pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void make();
          }}
        >
          <Textarea label="A note for the record" optional rows={2} maxLength={400} value={notes} onChange={(e) => setNotes(e.target.value)} hint="Why now, or what you noticed. Kept with the version." />
          {!preview.ready ? (
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={allowSmall} onChange={(e) => setAllowSmall(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--crest-flame)]" />
              <span className="t-body">I understand this is learned from a small number of placements, so it is a rougher guess.</span>
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
          <div>
            <Button type="submit" size="md" loading={busy} disabled={!preview.ready && !allowSmall}>
              Make a new version (switched off)
            </Button>
          </div>
        </form>
      ) : canChange && preview.enough ? null : !canChange ? (
        <p className="t-small text-soft">Only the admin and directors can make a new version.</p>
      ) : null}
    </section>
  );
}

function Version({ model, canChange }: { model: ModelRow; canChange: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"on" | "off" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const small = model.trained?.small === true;

  async function activate() {
    if (busy) return;
    setBusy("on");
    setError(null);
    const result = await activateModelAction(model.version, small);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  async function discard() {
    if (busy) return;
    setBusy("off");
    setError(null);
    const result = await discardModelAction(model.version);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <article className="card flex flex-col gap-4 p-5" aria-label={`Version ${model.version}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Version {model.version}</h3>
        {model.active ? <Badge tone="gold">In use</Badge> : null}
        {small ? <Badge tone="outline">Learned from a small sample</Badge> : null}
        {model.parent ? <span className="t-small text-soft">from {model.parent}</span> : null}
      </div>
      <WeightBar weights={model.weights} />
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
        <Fact label="Made" value={`${formatShortDate(model.created_at)}${model.created_by ? ` by ${model.created_by}` : ""}`} />
        <Fact label="Placements made with it" value={String(model.placements)} />
        <Fact label="Results so far" value={model.results.n === 0 ? "None yet" : `${model.results.thriving} of ${model.results.n} thriving`} />
      </dl>
      {model.notes ? <p className="t-small text-soft">{model.notes}</p> : null}

      {canChange && !model.active ? (
        <div className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
          {confirm ? (
            <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/20 p-4">
              <p className="t-body">
                From now on, members are matched with version {model.version}. Placements already made are not changed.
                {small ? " This version was learned from a small sample." : ""}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="sm" loading={busy === "on"} onClick={() => void activate()}>
                  Switch it on
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setConfirm(false)} disabled={busy !== null}>
                  Not yet
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button size="sm" variant="solid" onClick={() => setConfirm(true)} disabled={busy !== null}>
                Switch on
              </Button>
              {!model.used ? (
                <Button size="sm" variant="ghost" loading={busy === "off"} onClick={() => void discard()}>
                  Discard
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="t-small text-soft">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

const SHADES = ["bg-flame", "bg-gold", "bg-charcoal", "bg-ink/60", "bg-flame/60", "bg-gold/60", "bg-ink/30"];

/** The seven weights as one bar, with the numbers written out underneath so no colour has to be told apart. */
function WeightBar({ weights }: { weights: Weights }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-strong" role="img" aria-label={MODEL_KEYS.map((k) => `${MODEL_PARTS[k].label} ${weights[k]}`).join(", ")}>
        {MODEL_KEYS.map((k, i) => (
          <span key={k} className={SHADES[i]} style={{ width: `${weights[k]}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {MODEL_KEYS.map((k, i) => (
          <li key={k} className="t-small flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${SHADES[i]}`} />
            {MODEL_PARTS[k].label} <span className="font-semibold tabular-nums">{weights[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
