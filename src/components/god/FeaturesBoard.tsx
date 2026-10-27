"use client";

import { useState } from "react";
import { featureFindAction, featureRemoveAction, featureSetAction, masterAction } from "@/app/(app)/god/features/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { FeatureBoard, FeatureLogLine, FeatureRow, Found, Position, Scope } from "@/lib/features/types";
import { MASTER_LINE, POSITION_WORDS, ROLE_FILTERS, SCOPE_WORDS, STAGE_WORDS, SUMMARY_WORDS, describeLog, describeRule, lagosWhen, needs, roleName } from "@/lib/features/wording";

/**
 * The switchboard for Profiles and the Weekly Rhythm. It is part of the owner's console and the only place any switch of these functions
 * can be moved. The database refuses every one of these to anyone but the unlocked owner, so this page being hidden is never the only
 * protection. Everything starts Off; a function whose stage has not shipped can be read here but not moved.
 */
export function FeaturesBoard({ board, log }: { board: FeatureBoard; log: FeatureLogLine[] }) {
  const names = Object.fromEntries(board.features.map((f) => [f.key, f.name]));
  const stages = [...new Set(board.features.map((f) => f.stage))].sort((a, b) => a - b);
  return (
    <div className="flex flex-col gap-10" data-testid="features-board">
      <Summary board={board} />
      <Master board={board} />
      {stages.map((stage) => (
        <section key={stage} aria-labelledby={`stage-${stage}`} className="flex flex-col gap-3">
          <h2 id={`stage-${stage}`} className="t-heading">
            {STAGE_WORDS[stage] ?? `Stage ${stage}`}
          </h2>
          <div className="flex flex-col gap-3">
            {board.features
              .filter((f) => f.stage === stage)
              .map((f) => (
                <FeatureCard key={`${f.key}:${f.rules.map((r) => `${r.id}${r.position}${r.at}`).join("|")}:${board.paused}`} row={f} names={names} />
              ))}
          </div>
        </section>
      ))}
      <Changes log={log} />
    </div>
  );
}

function Summary({ board }: { board: FeatureBoard }) {
  const by = (s: string) => board.features.filter((f) => f.summary === s).length;
  const rows: [string, number][] = [
    ["On", by("on") + by("optional") + by("required")],
    ["Limited", by("limited")],
    ["In Rehearsal", by("rehearsal")],
    ["Off", by("off")],
  ];
  return (
    <section aria-labelledby="fsum-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="fsum-heading" className="t-heading">
          Where it stands
        </h2>
        <p className="t-small text-soft">{board.paused ? "Everything is paused: every new function acts as Off." : "Nothing is paused."} Every switch below starts Off.</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map(([k, v]) => (
          <div key={k} className="card flex flex-col gap-1 p-4">
            <dd className="text-2xl font-semibold tabular-nums">{v}</dd>
            <dt className="t-small text-soft">{k}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Master({ board }: { board: FeatureBoard }) {
  const d = useDo();
  const [note, setNote] = useState("");
  return (
    <section aria-labelledby="master-heading" className="flex flex-col gap-3" data-testid="features-master">
      <h2 id="master-heading" className="t-heading">
        The Master pause
      </h2>
      <div className={`card flex flex-col gap-3 p-5 ${board.paused ? "border-flame" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Pause every new function</h3>
          <Badge tone={board.paused ? "flame" : "outline"}>{board.paused ? "Paused" : "Not paused"}</Badge>
        </div>
        <p className="t-small text-soft">{MASTER_LINE}</p>
        {board.paused && board.pausedAt ? (
          <p className="t-small text-soft">
            Paused {lagosWhen(board.pausedAt)}
            {board.pausedReason ? `: “${board.pausedReason}”` : ""}.
          </p>
        ) : null}
        <Input label="A note for the log (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        <div>
          <Button
            size="md"
            variant={board.paused ? "solid" : "quiet"}
            loading={d.busy === "master"}
            disabled={d.busy !== null}
            onClick={() => void d.go("master", () => masterAction(!board.paused, note || undefined), { saved: board.paused ? "Everything is back as it was." : "Everything is paused." })}
            data-testid="master-toggle"
          >
            {board.paused ? "Resume every function" : "Pause every function"}
          </Button>
        </div>
        <Notice error={d.error} saved={d.saved} />
      </div>
    </section>
  );
}

function FeatureCard({ row, names }: { row: FeatureRow; names: Record<string, string> }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const need = needs(row, names);
  return (
    <article className="card flex flex-col gap-4 p-5" data-testid={`feature-${row.key}`} aria-labelledby={`feature-${row.key}-name`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`feature-${row.key}-name`} className="font-semibold">
              {row.name}
            </h3>
            <Badge tone={row.summary === "off" ? "outline" : row.summary === "on" || row.summary === "required" ? "charcoal" : "gold"}>{SUMMARY_WORDS[row.summary]}</Badge>
            {!row.available ? <Badge tone="outline">Arrives in stage {row.stage}</Badge> : null}
          </div>
          <p className="t-small text-soft">{row.blurb}</p>
          {need ? <p className="t-small text-soft">{need}</p> : null}
        </div>
      </header>

      {row.rules.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid={`feature-${row.key}-rules`}>
          {row.rules.map((r) => (
            <li key={r.id} className="t-small flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-2">
              <span>
                {describeRule(r)}
                {r.reason ? <span className="text-soft"> · “{r.reason}”</span> : null}
              </span>
              <Button size="md" variant="ghost" disabled={d.busy !== null} loading={d.busy === `rm:${r.id}`} onClick={() => void d.go(`rm:${r.id}`, () => featureRemoveAction(r.id), { saved: "That rule is taken away." })}>
                Take it away
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-small text-soft">No rule. It is {POSITION_WORDS[row.default].name}.</p>
      )}

      {row.available ? (
        <>
          <button type="button" className="press t-small w-fit font-medium text-soft hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)} data-testid={`feature-${row.key}-open`}>
            {open ? "Close the switch" : "Move the switch"}
          </button>
          {open ? <Editor row={row} d={d} /> : null}
        </>
      ) : null}
      <Notice error={d.error} saved={d.saved} />
    </article>
  );
}

type Doing = ReturnType<typeof useDo>;
const OPEN: Position[] = ["on", "optional", "required"];

function Editor({ row, d }: { row: FeatureRow; d: Doing }) {
  const [scope, setScope] = useState<Scope>("platform");
  const [picked, setPicked] = useState<Found | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [q, setQ] = useState("");
  const [finding, setFinding] = useState(false);
  const [position, setPosition] = useState<Position>(row.modes.includes("rehearsal") ? "rehearsal" : (row.modes.find((m) => m !== "off") ?? "off"));
  const [roles, setRoles] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [holdout, setHoldout] = useState(false);
  const [until, setUntil] = useState("");

  const opened = OPEN.includes(position);
  const needsReason = scope === "platform" && position === "on" && roles.length === 0;
  const canHold = (scope === "platform" || scope === "community") && opened;
  const scoped = scope === "platform" || picked !== null;
  const reasonOk = !needsReason || reason.trim().length >= 8;
  const holdOk = !holdout || /^\d{4}-\d{2}-\d{2}$/.test(until);

  async function look(s: Scope, text: string) {
    setFinding(true);
    try {
      const r = await featureFindAction(s, text);
      setFound(r.ok ? r.found : []);
    } catch {
      setFound([]);
    }
    setFinding(false);
  }
  function chooseScope(s: Scope) {
    setScope(s);
    setPicked(null);
    setFound([]);
    setQ("");
    if (s === "centre" || s === "community") void look(s, "");
  }

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-line p-4" data-testid={`feature-${row.key}-editor`}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[0.95rem] font-medium">Where</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SCOPE_WORDS) as Scope[]).map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => chooseScope(s)} className={`press inline-flex min-h-11 items-center rounded-full border-[1.5px] px-4 text-[0.92rem] font-medium ${scope === s ? "border-ink bg-surface-strong" : "border-line hover:border-soft"}`} data-testid={`feature-${row.key}-scope-${s}`}>
              {SCOPE_WORDS[s]}
            </button>
          ))}
        </div>
        {scope === "tribe" || scope === "person" ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Input label={scope === "tribe" ? "Find a tribe, or its leader" : "Find a person by name or email"} value={q} onChange={(e) => setQ(e.target.value)} className="h-11" />
            </div>
            <Button size="md" variant="quiet" loading={finding} disabled={q.trim().length < 2 || finding} onClick={() => void look(scope, q)}>
              Find
            </Button>
          </div>
        ) : null}
        {scope !== "platform" ? (
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto" role="radiogroup" aria-label="Choose one">
            {found.map((f) => (
              <label key={f.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-surface">
                <input type="radio" name={`${row.key}-where`} checked={picked?.id === f.id} onChange={() => setPicked(f)} />
                <span className="t-small">{f.label}</span>
              </label>
            ))}
            {found.length === 0 && !finding ? <p className="t-small text-soft">{scope === "tribe" || scope === "person" ? "Search, then choose one." : "None found."}</p> : null}
          </div>
        ) : null}
      </fieldset>

      <div role="group" aria-label={`${row.name} position`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {row.modes.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={position === p}
            onClick={() => setPosition(p)}
            data-testid={`feature-${row.key}-${p}`}
            className={`press flex min-h-12 flex-col items-start rounded-[var(--radius-control)] border-[1.5px] px-3 py-2 text-left ${position === p ? "border-ink bg-surface-strong" : "border-line hover:border-soft"}`}
          >
            <span className="font-semibold">{POSITION_WORDS[p].name}</span>
          </button>
        ))}
      </div>
      <p className="t-small text-soft">{POSITION_WORDS[position].line}</p>

      {position !== "off" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[0.95rem] font-medium">Only for these roles (leave empty for everyone it reaches)</legend>
          <div className="flex flex-wrap gap-2">
            {ROLE_FILTERS.map((r) => (
              <label key={r} className={`press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.92rem] font-medium ${roles.includes(r) ? "border-ink bg-surface-strong" : "border-line hover:border-soft"}`}>
                <input type="checkbox" className="sr-only" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
                {roleName(r)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {canHold ? (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-10 cursor-pointer items-center gap-3">
            <input type="checkbox" checked={holdout} onChange={(e) => setHoldout(e.target.checked)} />
            <span className="t-small">Hold back one tribe in ten, so you can compare (never a tribe of young people)</span>
          </label>
          {holdout ? <Input label="Hold them back until (a day)" type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="h-11" /> : null}
        </div>
      ) : null}

      <Input label={needsReason ? "Why open it for the whole church? (kept in the log)" : "A note for the log (optional)"} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} hint={needsReason ? "At least 8 characters." : undefined} />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="md"
          variant="solid"
          loading={d.busy === "save"}
          disabled={d.busy !== null || !scoped || !reasonOk || !holdOk}
          onClick={() =>
            void d.go("save", () => featureSetAction({ feature: row.key, scope, scopeId: scope === "platform" ? null : (picked?.id ?? null), position, roles, reason, holdoutUntil: holdout && canHold ? until : null }), {
              saved: `${row.name} is ${POSITION_WORDS[position].name}${scope === "platform" ? "" : ` for ${picked?.label ?? "that place"}`}.`,
            })
          }
          data-testid={`feature-${row.key}-save`}
        >
          Save {POSITION_WORDS[position].name}
        </Button>
      </div>
    </div>
  );
}

function Changes({ log }: { log: FeatureLogLine[] }) {
  return (
    <section aria-labelledby="flog-heading" className="flex flex-col gap-3" data-testid="features-log">
      <h2 id="flog-heading" className="t-heading">
        What has changed
      </h2>
      {log.length === 0 ? (
        <p className="t-small text-soft">Nothing yet. Every function is where it started.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {log.map((l) => (
            <li key={l.id} className="t-small rounded-[var(--radius-control)] border border-line px-4 py-2">
              <span className="text-soft">{lagosWhen(l.at)} · </span>
              {describeLog(l)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
