"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  adjustLeaderAction,
  applyLeadersAction,
  approveLeadersAction,
  cancelLeadersAction,
  goalOptionsAction,
  planLeadersAction,
  readSheetAction,
} from "@/app/(app)/god/appointments/bulk/actions";
import { ChooseRun, type ChooseContext } from "@/components/god/GoalChoice";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { GoalOption, LeaderItem, LeadersView } from "@/lib/placement/types";
import { MAX_ROWS, SHEET_HEADER, type SheetPerson, type SheetProblem } from "@/lib/placement/sheet";
import { BULK_PROMISES, count, pluralise } from "@/lib/placement/wording";

const STATUS_WORDS: Record<string, string> = {
  planned: "Waiting for you",
  approved: "Approved",
  applying: "Appointing",
  done: "Done",
  cancelled: "Cancelled",
};

const TEMPLATE_CSV = [SHEET_HEADER.join(","), "(example) ada@example.org,Young professional,teaching,Business and entrepreneurship,,,no"].join("\r\n");

/**
 * Appointing leaders in bulk. The approved leaders who have no tribe yet, and anyone on a list you give, are each paired with a goal
 * that needs a leader, by the same fit model the single appointment uses. You read the pairs, change any you like, and apply them.
 * It starts each Tribe Card. It never approves a card and never certifies anyone.
 */
export function BulkLeaders({ view, choose = null }: { view: LeadersView; choose?: ChooseContext | null }) {
  const run = view.run;
  const live = run && ["planned", "approved", "applying"].includes(run.status);
  return (
    <div className="flex flex-col gap-8" data-testid="bulk-leaders">
      {live ? null : <Start />}
      {run ? <Plan view={view} choose={choose} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Start() {
  const router = useRouter();
  const d = useDo();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [includeApproved, setIncludeApproved] = useState(true);
  const [people, setPeople] = useState<SheetPerson[] | null>(null);
  const [problems, setProblems] = useState<SheetProblem[]>([]);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function read() {
    setReading(true);
    setProblem(null);
    const form = new FormData();
    const file = fileRef.current?.files?.[0];
    if (file) form.set("file", file);
    else form.set("text", text);
    let r;
    try {
      r = await readSheetAction(form);
    } catch {
      setReading(false);
      return setProblem("We couldn’t read that. Check your connection and try again.");
    }
    setReading(false);
    if (!r.ok) {
      setPeople(null);
      setProblems([]);
      return setProblem(r.message);
    }
    setPeople(r.people);
    setProblems(r.problems);
  }

  async function plan() {
    const ok = await d.go("plan", async () => {
      const r = await planLeadersAction(people ?? [], includeApproved);
      return r.ok ? { ok: true as const } : r;
    });
    if (ok) router.refresh();
  }

  const canPlan = includeApproved || (people?.length ?? 0) > 0;

  return (
    <section aria-labelledby="start-heading" className="card flex flex-col gap-5 p-5 sm:p-6" data-testid="bulk-start">
      <div>
        <h2 id="start-heading" className="t-heading">
          1. Who
        </h2>
        <p className="t-small text-soft">Nothing is saved until you apply a plan you have read.</p>
      </div>
      <label className="t-small flex cursor-pointer items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={includeApproved} onChange={(e) => setIncludeApproved(e.target.checked)} />
        <span>
          <strong>Include approved leaders who have no tribe yet.</strong> Their answers on the application stand in for the short form.
        </span>
      </label>
      <div className="flex flex-col gap-3">
        <p className="font-semibold">Add people who have not applied (optional)</p>
        <p className="t-small text-soft">
          One row each, up to {MAX_ROWS}: {SHEET_HEADER.join(", ")}. Community, Goal, Relation and Cleared can be left empty. They need to have signed in once.{" "}
          <a className="underline underline-offset-4" download="leaders-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`}>
            Download a template
          </a>
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.95rem] font-medium">An Excel or CSV file</span>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="t-small" onChange={() => setPeople(null)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.95rem] font-medium">Or paste the rows, titles first</span>
          <textarea className="input min-h-28 py-3 font-mono text-sm" value={text} onChange={(e) => (setText(e.target.value), setPeople(null))} spellCheck={false} />
        </label>
        <div>
          <Button size="md" variant="quiet" loading={reading} onClick={() => void read()}>
            Read the list
          </Button>
        </div>
        {problem ? (
          <p role="alert" className="t-small text-danger">
            {problem}
          </p>
        ) : null}
        {people ? (
          <div className="flex flex-col gap-2" role="status" data-testid="sheet-read">
            <p className="font-semibold">{pluralise(people.length, "person", "people")} read from the list.</p>
            {problems.length > 0 ? (
              <details>
                <summary className="t-small cursor-pointer">{pluralise(problems.length, "row")} could not be used</summary>
                <ul className="t-small mt-2 flex flex-col gap-1 text-soft">
                  {problems.map((p) => (
                    <li key={`${p.line}-${p.text}`}>
                      Line {p.line}: {p.text}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
      <Notice error={d.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="md" variant="solid" loading={d.busy === "plan"} disabled={!canPlan} onClick={() => void plan()}>
          Make the plan
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Plan({ view, choose }: { view: LeadersView; choose: ChooseContext | null }) {
  const run = view.run!;
  const proposed = view.items.filter((i) => i.status === "proposed");
  const applied = view.items.filter((i) => i.status === "applied");
  const failed = view.items.filter((i) => i.status === "failed");
  return (
    <>
      <section aria-labelledby="plan-heading" className="flex flex-col gap-4" data-testid="bulk-plan">
        <div>
          <h2 id="plan-heading" className="t-heading">
            2. The plan
          </h2>
          <p className="t-small flex flex-wrap items-center gap-2 text-soft">
            <Badge tone={run.status === "planned" ? "gold" : "outline"}>{STATUS_WORDS[run.status] ?? run.status}</Badge>
            <span>
              {pluralise(proposed.length + applied.length, "leader")} paired with a goal that needs one.
            </span>
          </p>
        </div>
        <ItemList items={view.items} runId={run.id} editable={run.status === "planned"} />
        {view.openGoals.length > 0 ? (
          <details className="card p-4">
            <summary className="cursor-pointer font-semibold">{pluralise(view.openGoals.length, "goal")} still short of a leader</summary>
            <ul className="t-small mt-3 flex flex-col gap-1 text-soft">
              {view.openGoals.map((g) => (
                <li key={g.goal}>
                  {g.title} ({g.community}): {pluralise(g.tribesShort, "tribe")} short
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {view.leftOver.length > 0 ? (
          <details className="card p-4" data-testid="bulk-left-over">
            <summary className="cursor-pointer font-semibold">{pluralise(view.leftOver.length, "person", "people")} not in the plan</summary>
            <ul className="t-small mt-3 flex flex-col gap-1 text-soft">
              {view.leftOver.map((l, i) => (
                <li key={`${l.person ?? l.email ?? i}`}>
                  {l.name ?? l.email ?? "A row"}: {l.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      {run.status === "planned" ? <Approve runId={run.id} proposed={proposed.length} /> : null}
      {run.status === "approved" || run.status === "applying" ? <ApplyDriver runId={run.id} total={proposed.length + applied.length + failed.length} done={applied.length} /> : null}
      {run.status === "done" ? <Done applied={applied} failed={failed} runId={run.id} choose={choose} /> : null}
    </>
  );
}

function ItemList({ items, runId, editable }: { items: LeaderItem[]; runId: string; editable: boolean }) {
  if (items.length === 0) return <p className="card t-body p-5 text-soft">Nobody could be paired with a goal.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <Row key={i.person} item={i} runId={runId} editable={editable && i.status === "proposed"} />
      ))}
    </ul>
  );
}

function Row({ item, runId, editable }: { item: LeaderItem; runId: string; editable: boolean }) {
  const router = useRouter();
  const d = useDo();
  const [options, setOptions] = useState<GoalOption[] | null>(null);

  async function more() {
    const r = await goalOptionsAction(runId, item.person);
    if (r.ok) setOptions(r.options);
    else void d.go("options", async () => r);
  }
  const act = (key: string, fn: () => ReturnType<typeof adjustLeaderAction>) => d.go(key, fn, { after: () => (setOptions(null), router.refresh()) });

  return (
    <li className="card flex flex-col gap-3 p-4" data-testid={`bulk-item-${item.person}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            <Link href={`/god/people/${item.person}`} className="underline underline-offset-4">
              {item.name}
            </Link>{" "}
            <Badge tone="outline">{item.source === "sheet" ? "From your list" : "Approved leader"}</Badge>
          </p>
          <p className="t-small text-soft">
            {item.title} · {item.community} · {item.label} ({item.degree}%)
            {item.status === "applied" ? " · appointed" : ""}
            {item.status === "removed" ? " · taken out" : ""}
            {item.status === "failed" ? ` · not appointed: ${item.reason ?? "something went wrong"}` : ""}
          </p>
        </div>
        {item.tribe ? (
          <Link href={`/god/tribes/${item.tribe}`} className="t-small underline underline-offset-4">
            Their tribe
          </Link>
        ) : null}
        {editable ? (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="quiet" onClick={() => void (options ? setOptions(null) : more())}>
              {options ? "Close" : "Other goals"}
            </Button>
            <Button size="sm" variant="ghost" loading={d.busy === "remove"} onClick={() => void act("remove", () => adjustLeaderAction(runId, item.person, "remove", null))}>
              Take out
            </Button>
          </span>
        ) : null}
      </div>
      <Notice error={d.error} />
      {options ? (
        options.length === 0 ? (
          <p className="t-small text-soft">No other goal suits them.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {options.map((o) => (
              <li key={o.goal} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface-strong p-3">
                <span className="t-small">
                  <strong>{o.title}</strong> · {o.community} · {o.label} ({o.degree}%){o.gap > 0 ? ` · ${pluralise(o.gap, "member")} waiting` : ""}
                </span>
                <Button size="sm" variant="quiet" loading={d.busy === `move-${o.goal}`} onClick={() => void act(`move-${o.goal}`, () => adjustLeaderAction(runId, item.person, "move", o.goal))}>
                  Pair here
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

function Approve({ runId, proposed }: { runId: string; proposed: number }) {
  const router = useRouter();
  const d = useDo();
  const [asking, setAsking] = useState(false);
  return (
    <section aria-labelledby="bulk-approve" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="bulk-approve">
      <h2 id="bulk-approve" className="t-heading">
        3. Apply the plan
      </h2>
      <ul className="t-small flex list-disc flex-col gap-1 pl-5 text-soft">
        {BULK_PROMISES.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <Notice error={d.error} />
      {asking ? (
        <div role="alertdialog" aria-labelledby="bulk-sure" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/20 p-4">
          <p id="bulk-sure" className="font-semibold">
            Appoint {pluralise(proposed, "leader")} and email each of them?
          </p>
          <div className="flex gap-3">
            <Button size="md" variant="solid" loading={d.busy === "approve"} onClick={() => void d.go("approve", () => approveLeadersAction(runId, proposed), { after: () => router.refresh() })}>
              Yes, appoint
            </Button>
            <Button size="md" variant="ghost" onClick={() => setAsking(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button size="md" variant="solid" disabled={proposed === 0} onClick={() => setAsking(true)}>
            Appoint {proposed > 0 ? `(${count(proposed)})` : ""}
          </Button>
          <Button size="md" variant="ghost" loading={d.busy === "cancel"} onClick={() => void d.go("cancel", () => cancelLeadersAction(runId), { after: () => router.refresh() })}>
            Cancel this plan
          </Button>
        </div>
      )}
    </section>
  );
}

function ApplyDriver({ runId, total, done }: { runId: string; total: number; done: number }) {
  const router = useRouter();
  const [finished, setFinished] = useState(done);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    let stop = false;
    void (async () => {
      for (let guard = 0; guard < 1000 && !stop; guard++) {
        let r;
        try {
          r = await applyLeadersAction(runId);
        } catch {
          setError("We lost the connection. Reload the page and it carries on from where it stopped.");
          break;
        }
        if (!r.ok) {
          setError(r.message);
          break;
        }
        setFinished((n) => n + r.done);
        if (r.left === 0 || (r.status !== "approved" && r.status !== "applying")) {
          router.refresh();
          break;
        }
      }
      running.current = false;
    })();
    return () => {
      stop = true;
    };
  }, [runId, attempt, router]);

  return (
    <section className="card flex flex-col gap-3 p-5 sm:p-6" aria-live="polite" data-testid="bulk-apply">
      <h2 className="t-heading">Appointing</h2>
      <p className="t-body text-soft">{count(finished)} of {count(total)} appointed. Keep this page open until it says it is done.</p>
      {error ? (
        <>
          <p role="alert" className="t-small text-danger">{error}</p>
          <div>
            <Button size="md" variant="quiet" onClick={() => (setError(null), setAttempt((n) => n + 1))}>
              Try again
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Done({ applied, failed, runId, choose }: { applied: LeaderItem[]; failed: LeaderItem[]; runId: string; choose: ChooseContext | null }) {
  return (
    <>
    <section aria-labelledby="done-heading" className="card flex flex-col gap-3 p-5 sm:p-6" data-testid="bulk-done">
      <h2 id="done-heading" className="t-heading">
        Done
      </h2>
      <p className="t-body">
        {pluralise(applied.length, "leader")} appointed. Their Tribe Cards are started; a pastor reviews each one and the Academy certifies each leader before members see anything.
        {failed.length > 0 ? ` ${pluralise(failed.length, "person", "people")} could not be appointed and ${failed.length === 1 ? "is" : "are"} listed above with the reason.` : ""}
      </p>
    </section>
    {choose && applied.length > 0 ? <ChooseRun run={runId} ctx={choose} tribes={applied.flatMap((a) => (a.tribe ? [a.tribe] : []))} /> : null}
    </>
  );
}
