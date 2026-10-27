"use client";

import Link from "next/link";
import { useState } from "react";
import { detailsCloseAction, detailsFindAction, detailsPlanAction, detailsSendAction } from "@/app/(app)/god/details/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { lagosWhen, SUMMARY_WORDS } from "@/lib/features/wording";
import type { Found, Summary } from "@/lib/features/types";
import { AUDIENCES, FACT_KEYS, type AudienceKind, type CheckStatus, type CheckSummary, type FactKey, type LeftOutReason, type Plan } from "@/lib/profile/types";
import { AUDIENCE_WORDS, CHANNEL_WORDS, FACT_WORDS, LEFT_OUT_WORDS, STATUS_WORDS } from "@/lib/profile/wording";

/**
 * The Details check, for the owner: who to ask, what, and whether to rehearse. The counts come first (how many would be asked and why the
 * others are left out, never who), then the asking. Below are the runs, each with where every person stands. What a person answered is
 * never shown here.
 */
export function DetailsConsole({ runs, selected, summary, available }: { runs: CheckSummary[]; selected: CheckStatus | null; summary: Summary; available: boolean }) {
  return (
    <div className="flex flex-col gap-10" data-testid="details-console">
      <section aria-labelledby="dc-state" className="card flex flex-wrap items-center gap-3 p-5">
        <h2 id="dc-state" className="font-semibold">
          The Details check switch
        </h2>
        <Badge tone={summary === "off" ? "outline" : summary === "on" ? "charcoal" : "gold"}>{SUMMARY_WORDS[summary]}</Badge>
        <p className="t-small text-soft">
          {!available
            ? "It cannot be moved yet."
            : summary === "off"
              ? "It is Off, so nobody can be asked. Open Features to put it in Rehearsal or On."
              : summary === "rehearsal"
                ? "It is in Rehearsal: you can rehearse a run, which writes what would be sent and sends nothing."
                : "It is open: a live run sends one message to each person it reaches."}
        </p>
        <Link href="/god/features" className="press t-small ml-auto font-medium underline underline-offset-4">
          Open Features
        </Link>
      </section>
      <Ask />
      <Runs runs={runs} selectedId={selected?.id ?? null} />
      {selected ? <Run run={selected} /> : null}
    </div>
  );
}

const leftOutLines = (left: Partial<Record<LeftOutReason, number>>) =>
  (Object.entries(left) as [LeftOutReason, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${n === 1 ? "person" : "people"} ${LEFT_OUT_WORDS[k] ?? k}`);

function Ask() {
  const d = useDo();
  const [kind, setKind] = useState<AudienceKind>("appointed");
  const [tribe, setTribe] = useState<Found | null>(null);
  const [people, setPeople] = useState<Found[]>([]);
  const [facts, setFacts] = useState<FactKey[]>(["life_stage"]);
  const [mode, setMode] = useState<"rehearsal" | "live">("rehearsal");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [finding, setFinding] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sure, setSure] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const audience = kind === "tribe" ? (tribe ? { kind, tribe: tribe.id } : null) : kind === "list" ? (people.length > 0 ? { kind, people: people.map((p) => p.id) } : null) : { kind };
  const ready = audience !== null && facts.length >= 1;
  const edit = (fn: () => void) => {
    fn();
    setPlan(null);
    setSure(false);
    setDone(null);
  };
  async function look() {
    setFinding(true);
    try {
      const r = await detailsFindAction(kind === "tribe" ? "tribe" : "person", q);
      setFound(r.ok ? r.found : []);
    } catch {
      setFound([]);
    }
    setFinding(false);
  }

  return (
    <section aria-labelledby="ask-heading" className="flex flex-col gap-4" data-testid="details-ask">
      <div>
        <h2 id="ask-heading" className="t-heading">
          Ask people to check
        </h2>
        <p className="t-small text-soft">Choose who, and what to check, then see the numbers before anything is sent.</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[0.95rem] font-medium">Who</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {AUDIENCES.map((a) => (
            <button key={a} type="button" aria-pressed={kind === a} onClick={() => edit(() => setKind(a))} data-testid={`details-audience-${a}`} className={`press flex min-h-12 flex-col items-start rounded-[var(--radius-control)] border-[1.5px] px-3 py-2 text-left ${kind === a ? "border-ink bg-surface-strong" : "border-line hover:border-soft"}`}>
              <span className="font-semibold">{AUDIENCE_WORDS[a].name}</span>
              <span className="t-small text-soft">{AUDIENCE_WORDS[a].line}</span>
            </button>
          ))}
        </div>
        {kind === "tribe" || kind === "list" ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line p-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1">
                <Input label={kind === "tribe" ? "Find a tribe, or its leader" : "Find a person by name or email"} value={q} onChange={(e) => setQ(e.target.value)} className="h-11" />
              </div>
              <Button size="md" variant="quiet" loading={finding} disabled={q.trim().length < 2 || finding} onClick={() => void look()}>
                Find
              </Button>
            </div>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {found.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="press t-small min-h-10 rounded-md px-2 text-left hover:bg-surface"
                  onClick={() => edit(() => (kind === "tribe" ? setTribe(f) : setPeople((p) => (p.some((x) => x.id === f.id) ? p : [...p, f]))))}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {kind === "tribe" && tribe ? <p className="t-small font-semibold">Chosen: {tribe.label}</p> : null}
            {kind === "list" && people.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="People chosen">
                {people.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="press t-small rounded-full border border-line px-3 py-1" onClick={() => edit(() => setPeople((x) => x.filter((y) => y.id !== p.id)))} aria-label={`Remove ${p.label}`}>
                      {p.label} ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[0.95rem] font-medium">What to check (one to three)</legend>
        <div className="flex flex-wrap gap-2">
          {FACT_KEYS.map((k) => (
            <label key={k} className={`press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.92rem] font-medium ${facts.includes(k) ? "border-ink bg-surface-strong" : "border-line hover:border-soft"}`}>
              <input type="checkbox" className="sr-only" checked={facts.includes(k)} onChange={(e) => edit(() => setFacts(e.target.checked ? [...facts, k] : facts.filter((x) => x !== k)))} data-testid={`details-fact-${k}`} />
              {FACT_WORDS[k].label}
            </label>
          ))}
        </div>
        <p className="t-small text-soft">{facts.map((k) => FACT_WORDS[k].line).join(" ")}</p>
      </fieldset>

      <div role="group" aria-label="Rehearsal or live" className="grid grid-cols-2 gap-2">
        {(["rehearsal", "live"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => edit(() => setMode(m))} data-testid={`details-mode-${m}`} className={`press flex min-h-12 flex-col items-start rounded-[var(--radius-control)] border-[1.5px] px-3 py-2 text-left ${mode === m ? "border-ink bg-surface-strong" : "border-line hover:border-soft"}`}>
            <span className="font-semibold">{m === "rehearsal" ? "Rehearsal" : "Live"}</span>
            <span className="t-small text-soft">{m === "rehearsal" ? "Writes what would be sent. Sends nothing, and changes nobody’s record." : "Sends one message to each person, with a private link."}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="md"
          variant="quiet"
          loading={d.busy === "plan"}
          disabled={!ready || d.busy !== null}
          onClick={() =>
            void d.go("plan", async () => {
              const r = await detailsPlanAction(audience, facts, mode);
              if (r.ok) setPlan(r.plan);
              return r.ok ? { ok: true as const } : r;
            })
          }
          data-testid="details-plan"
        >
          See who would be asked
        </Button>
      </div>

      {plan ? (
        <div className="card flex flex-col gap-2 p-5" role="status" data-testid="details-plan-result">
          <p className="text-lg font-semibold">
            {plan.asked} {plan.asked === 1 ? "person" : "people"} would be asked.
          </p>
          {leftOutLines(plan.leftOut).length > 0 ? (
            <ul className="t-small list-disc pl-5 text-soft">
              {leftOutLines(plan.leftOut).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="t-small text-soft">Nobody is left out.</p>
          )}
          {plan.asked > 0 ? (
            <div className="flex flex-col gap-3 pt-2">
              {mode === "live" ? (
                <label className="flex cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="details-sure" />
                  <span className="t-small">I understand {plan.asked === 1 ? "this person" : `these ${plan.asked} people`} will get a message now.</span>
                </label>
              ) : null}
              <div>
                <Button
                  size="md"
                  variant="solid"
                  loading={d.busy === "send"}
                  disabled={d.busy !== null || (mode === "live" && !sure)}
                  onClick={() =>
                    void d.go(
                      "send",
                      async () => {
                        const r = await detailsSendAction(audience, facts, mode);
                        if (r.ok) {
                          setPlan(null);
                          setSure(false);
                          setDone(r.sent.mode === "live" ? `Asked ${r.sent.asked} ${r.sent.asked === 1 ? "person" : "people"}. They each have a message with a private link.` : `Rehearsed for ${r.sent.asked} ${r.sent.asked === 1 ? "person" : "people"}. Nothing was sent.`);
                        }
                        return r.ok ? { ok: true as const } : r;
                      },
                    )
                  }
                  data-testid="details-send"
                >
                  {mode === "live" ? "Ask them now" : "Rehearse"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {done ? (
        <p role="status" className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="details-done">
          {done}
        </p>
      ) : null}
      <Notice error={d.error} />
    </section>
  );
}

function Runs({ runs, selectedId }: { runs: CheckSummary[]; selectedId: string | null }) {
  const d = useDo();
  return (
    <section aria-labelledby="runs-heading" className="flex flex-col gap-3" data-testid="details-runs">
      <h2 id="runs-heading" className="t-heading">
        Runs
      </h2>
      {runs.length === 0 ? (
        <p className="t-small text-soft">Nothing has been asked yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {runs.map((r) => {
            const counts = Object.entries(r.counts).filter(([, n]) => (n ?? 0) > 0) as [keyof typeof STATUS_WORDS, number][];
            return (
              <li key={r.id} className={`card flex flex-col gap-2 p-4 ${r.id === selectedId ? "border-ink" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{lagosWhen(r.at)}</span>
                  <Badge tone={r.mode === "live" ? "charcoal" : "gold"}>{r.mode === "live" ? "Live" : "Rehearsal"}</Badge>
                  {r.closed ? <Badge tone="outline">Stopped</Badge> : null}
                  <span className="t-small text-soft">
                    {AUDIENCE_WORDS[r.audience]?.name ?? r.audience} · {r.facts.map((f) => FACT_WORDS[f].label).join(", ")} · {r.asked} asked
                  </span>
                </div>
                <p className="t-small text-soft">{counts.length > 0 ? counts.map(([s, n]) => `${n} ${STATUS_WORDS[s].toLowerCase()}`).join(" · ") : "No one in this run."}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/god/details?run=${r.id}`} className="press t-small font-medium underline underline-offset-4">
                    See who
                  </Link>
                  {r.mode === "live" && !r.closed ? (
                    <Button size="md" variant="ghost" disabled={d.busy !== null} loading={d.busy === r.id} onClick={() => void d.go(r.id, () => detailsCloseAction(r.id), { saved: "That run is stopped. Its links no longer open." })}>
                      Stop this run
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}

function Run({ run }: { run: CheckStatus }) {
  const left = leftOutLines(run.leftOut);
  return (
    <section aria-labelledby="run-heading" className="flex flex-col gap-3" data-testid="details-run">
      <div>
        <h2 id="run-heading" className="t-heading">
          {lagosWhen(run.at)}, {run.mode === "live" ? "live" : "rehearsal"}
        </h2>
        <p className="t-small text-soft">
          {run.asked} asked{run.corrected > 0 ? ` · ${run.corrected} corrected at once` : ""}. You see where each person stands, never what they answered.
        </p>
        {left.length > 0 ? <p className="t-small text-soft">Left out: {left.join("; ")}.</p> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="t-small w-full min-w-[34rem] text-left">
          <thead>
            <tr className="border-b border-line text-soft">
              <th className="py-2 pr-3 font-medium">Person</th>
              <th className="py-2 pr-3 font-medium">Where it stands</th>
              <th className="py-2 pr-3 font-medium">Message</th>
              <th className="py-2 font-medium">Link</th>
            </tr>
          </thead>
          <tbody>
            {run.people.map((p) => (
              <tr key={p.id} className="border-b border-line align-top">
                <td className="py-2 pr-3 font-medium">{p.name}</td>
                <td className="py-2 pr-3">{STATUS_WORDS[p.status]}{p.asked ? " · coach or director told" : ""}</td>
                <td className="py-2 pr-3 text-soft">{run.mode === "rehearsal" ? (p.wouldSend ?? "") : p.sent ? `Sent${p.channel ? ` by ${CHANNEL_WORDS[p.channel] ?? p.channel}` : ""}${p.reminded ? ", reminded" : ""}` : "Waiting to go out"}</td>
                <td className="py-2 text-soft">{run.mode === "rehearsal" ? "None made" : p.opened ? "Opened" : "Not opened"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
