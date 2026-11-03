"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  adjustAction,
  approveRunAction,
  cancelRunAction,
  itemsAction,
  openAllAction,
  openNowAction,
  optionsAction,
  placeRunAction,
  resolveSmallAction,
  stepRunAction,
  undoRunAction,
} from "@/app/(app)/god/placement/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatLagosDay, formatLagosTime, formatShortDate } from "@/lib/dates";
import type { RunItem, RunView, Team, TribeOption } from "@/lib/placement/types";
import { HEARTBEAT_HINT, PHASE_TEXT, PLAN_PROMISES, RUN_STATUS_TEXT, STATUS_TEXT, TEAM_STATE_TEXT, ZONE_TEXT, count, hourText, pluralise, reasonText } from "@/lib/placement/wording";
import { useRouter } from "next/navigation";

const FIT_ORDER = ["excellent", "strong", "good"] as const;
const fitName = (k: string) => (k === "excellent" ? "Excellent fit" : k === "strong" ? "Strong fit" : k === "good" ? "Good fit" : k);

const MESSAGE_TEXT: Record<string, string> = {
  queued: "waiting for their hour",
  sending: "sending",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  skipped: "not sent",
};

/**
 * One run. While it is being planned the page works through it in batches. Once it is ready you read it, deal with any tribe that would
 * be too small, change anyone you want to, and approve it. After that the page places members in batches (the heartbeat finishes the
 * job if you close the page) and shows what happened.
 */
export function RunBoard({ view }: { view: RunView }) {
  const { run } = view;
  return (
    <div className="flex flex-col gap-8" data-testid="run-board">
      <Header view={view} />
      {run.status === "planning" ? <PlanDriver view={view} /> : null}
      {run.status === "planned" ? <Plan view={view} /> : null}
      {run.status === "approved" || run.status === "placing" ? <PlaceDriver view={view} /> : null}
      {["placing", "placed", "closed", "undone"].includes(run.status) ? <Results view={view} /> : null}
      {run.status === "cancelled" ? <p className="card t-body p-5 text-soft">This run was cancelled. Nobody was placed.</p> : null}
    </div>
  );
}

function Header({ view }: { view: RunView }) {
  const { run } = view;
  const scope = [run.scopeCommunity, run.scopeZone ? (ZONE_TEXT[run.scopeZone] ?? run.scopeZone) : null].filter(Boolean).join(" · ");
  return (
    <header className="flex flex-col gap-2">
      <Link href="/god/placement" className="t-small inline-flex min-h-10 w-fit items-center text-soft hover:text-ink">
        <span aria-hidden="true">← </span>Placement
      </Link>
      <h1 className="t-title">Run {run.seq}</h1>
      <p className="t-small flex flex-wrap items-center gap-x-3 gap-y-1 text-soft">
        <Badge tone={run.status === "planned" ? "gold" : "outline"}>{RUN_STATUS_TEXT[run.status] ?? run.status}</Badge>
        {run.rehearsal ? <Badge tone="charcoal">Rehearsal: nobody is seated, nothing is sent</Badge> : null}
        {run.season ? <span>{run.season}</span> : null}
        <span>{scope || "Everyone"}</span>
        <span>
          {count(run.pacePerHour)} emails an hour, {hourText(run.sendFrom)} to {hourText(run.sendUntil)}
        </span>
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function PlanDriver({ view }: { view: RunView }) {
  const router = useRouter();
  const [phase, setPhase] = useState(view.run.phase);
  const [scored, setScored] = useState(0);
  const [assigned, setAssigned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    let stop = false;
    void (async () => {
      for (let guard = 0; guard < 10_000 && !stop; guard++) {
        let r;
        try {
          r = await stepRunAction(view.run.id);
        } catch {
          setError("We lost the connection. Try again; the plan carries on from where it stopped.");
          break;
        }
        if (!r.ok) {
          setError(r.message);
          break;
        }
        setPhase(r.phase);
        setScored(r.scored);
        setAssigned(r.assigned);
        if (r.status !== "planning") {
          router.refresh();
          break;
        }
      }
      running.current = false;
    })();
    return () => {
      stop = true;
    };
  }, [view.run.id, attempt, router]);

  return (
    <section className="card flex flex-col gap-3 p-5 sm:p-6" aria-live="polite" data-testid="plan-driver">
      <h2 className="t-heading">Making the plan</h2>
      <p className="t-body text-soft">
        {PHASE_TEXT[phase] ?? "Working"}. {pluralise(view.run.pool, "member")} in the pool; {count(scored)} counted, {count(assigned)} given a tribe. Keep this page open. If it closes, open the run again and it carries on.
      </p>
      {error ? (
        <>
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
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

// ---------------------------------------------------------------------------
// Reading and approving the plan
// ---------------------------------------------------------------------------

function Plan({ view }: { view: RunView }) {
  const proposed = view.counts.proposed ?? 0;
  const small = view.teams.filter((t) => t.small);
  const open = small.filter((t) => t.decision === null);
  return (
    <>
      <Numbers view={view} />
      {small.length > 0 ? <Small teams={small} runId={view.run.id} /> : null}
      <Teams teams={view.teams} />
      <People view={view} editable />
      <Approve view={view} proposed={proposed} blocked={open.length} />
    </>
  );
}

function Numbers({ view }: { view: RunView }) {
  const proposed = view.counts.proposed ?? 0;
  const left = view.reasons.filter((r) => r.status !== "proposed");
  const fit = FIT_ORDER.filter((k) => view.fit[k]);
  return (
    <section aria-labelledby="numbers-heading" className="flex flex-col gap-4" data-testid="plan-numbers">
      <h2 id="numbers-heading" className="t-heading">
        What the plan does
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card flex flex-col gap-1 p-4">
          <dd className="text-2xl font-semibold tabular-nums" data-testid="plan-proposed">{count(proposed)}</dd>
          <dt className="t-small text-soft">Members to be placed</dt>
        </div>
        <div className="card flex flex-col gap-1 p-4">
          <dd className="text-2xl font-semibold tabular-nums">{count(view.run.pool)}</dd>
          <dt className="t-small text-soft">Members looked at</dt>
        </div>
        <div className="card flex flex-col gap-1 p-4">
          <dd className="text-2xl font-semibold tabular-nums">{count(view.teams.filter((t) => t.proposed > 0).length)}</dd>
          <dt className="t-small text-soft">Tribes that receive members</dt>
        </div>
        <div className="card flex flex-col gap-1 p-4">
          <dd className="text-2xl font-semibold tabular-nums">{view.days <= 1 ? "1 day" : `${count(view.days)} days`}</dd>
          <dt className="t-small text-soft">To tell them all, at {count(view.run.pacePerHour)} an hour</dt>
        </div>
      </dl>
      {fit.length > 0 ? (
        <p className="t-body">
          {fit.map((k, i) => (
            <span key={k}>
              {i > 0 ? " · " : ""}
              <strong>{count(view.fit[k])}</strong> {fitName(k).toLowerCase()}
            </span>
          ))}
        </p>
      ) : null}
      {left.length > 0 ? (
        <details className="card p-4" data-testid="plan-left-out">
          <summary className="cursor-pointer font-semibold">Why {count(left.reduce((a, r) => a + r.n, 0))} were left out</summary>
          <ul className="t-small mt-3 flex flex-col gap-1">
            {left.map((r) => (
              <li key={`${r.status}-${r.reason}`} className="flex justify-between gap-4">
                <span>{reasonText(r.reason)}</span>
                <span className="tabular-nums text-soft">{count(r.n)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Small({ teams, runId }: { teams: Team[]; runId: string }) {
  const d = useDo();
  const choose = (t: Team, action: "keep" | "hold" | "retry", saved: string) => d.go(`small-${t.tribe}-${action}`, () => resolveSmallAction(runId, t.tribe, action), { saved });
  return (
    <section aria-labelledby="small-heading" className="flex flex-col gap-3" data-testid="small-tribes">
      <div>
        <h2 id="small-heading" className="t-heading">
          Tribes that would start too small
        </h2>
        <p className="t-small text-soft">Decide each one before you can approve. Keep it, hold its members back from this run, or let the plan try their next-best tribes.</p>
      </div>
      <Notice error={d.error} saved={d.saved} />
      <ul className="flex flex-col gap-3">
        {teams.map((t) => (
          <li key={t.tribe} className="card flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold">
                <Link href={`/god/tribes/${t.tribe}`} className="underline underline-offset-4">
                  {t.name}
                </Link>{" "}
                <span className="t-small font-normal text-soft">
                  · {t.leaderFirst} · {pluralise(t.activeBefore + t.proposed, "member")} of {t.capacity} seats
                </span>
              </p>
              {t.decision ? <Badge tone="gold">{t.decision === "keep" ? "Kept" : t.decision === "hold" ? "Held back" : "Trying next-best"}</Badge> : <Badge tone="flame">Needs a decision</Badge>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={t.decision === "keep" ? "solid" : "quiet"} loading={d.busy === `small-${t.tribe}-keep`} onClick={() => void choose(t, "keep", `${t.name} is kept.`)}>
                Keep it
              </Button>
              <Button size="sm" variant="quiet" loading={d.busy === `small-${t.tribe}-hold`} onClick={() => void choose(t, "hold", `${t.name}’s members are held back.`)}>
                Hold its members back
              </Button>
              <Button size="sm" variant="quiet" loading={d.busy === `small-${t.tribe}-retry`} onClick={() => void choose(t, "retry", `Their next-best tribes were tried.`)}>
                Try their next-best
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A tribe whose leader has not yet been given the team, and whose members have all been placed: the ones "Open now" can act on. */
const OPENABLE: ReadonlySet<Team["state"]> = new Set(["waiting", "holding", "none_sent", "due"]);

const dayAndTime = (iso: string) => `${formatLagosDay(iso)}, ${formatLagosTime(iso)}`;

function Teams({ teams, live = null }: { teams: Team[]; live?: { runId: string } | null }) {
  const router = useRouter();
  const d = useDo();
  const [asking, setAsking] = useState<string | "all" | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const rows = teams.filter((t) => t.proposed > 0 || t.placed > 0);
  if (rows.length === 0) return null;
  const openable = live ? rows.filter((t) => OPENABLE.has(t.state)) : [];
  const target = asking && asking !== "all" ? rows.find((t) => t.tribe === asking) : null;
  const unansweredAll = openable.reduce((n, t) => n + t.unanswered, 0);

  async function openOne(t: Team) {
    if (!live) return;
    const ok = await d.go(`open-${t.tribe}`, async () => {
      const r = await openNowAction(live.runId, t.tribe);
      if (r.ok) setSaid(r.already ? `${t.name} had already been opened.` : `${t.name} is open. ${t.leaderFirst || "The leader"} has been given ${pluralise(r.shared, "member")}’s details and is emailed their team.`);
      return r.ok ? { ok: true as const } : r;
    });
    if (ok) {
      setAsking(null);
      router.refresh();
    }
  }

  async function openEvery() {
    if (!live) return;
    const ok = await d.go("open-all", async () => {
      const r = await openAllAction(live.runId);
      if (r.ok) setSaid(`${pluralise(r.tribes, "tribe")} opened. ${pluralise(r.shared, "member")}’s details were given to their leaders.`);
      return r.ok ? { ok: true as const } : r;
    });
    if (ok) {
      setAsking(null);
      router.refresh();
    }
  }

  return (
    <section aria-labelledby="teams-heading" className="flex flex-col gap-3" data-testid="plan-teams">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="teams-heading" className="t-heading">
          Tribe by tribe
        </h2>
        {live && openable.length > 0 ? (
          <Button size="sm" variant="quiet" onClick={() => setAsking("all")} data-testid="open-all">
            Open all
          </Button>
        ) : null}
      </div>
      <Notice error={d.error} saved={said} />
      <div className="overflow-x-auto rounded-[var(--radius-control)] border border-line">
        <table className={`t-small w-full text-left ${live ? "min-w-[52rem]" : "min-w-[34rem]"}`}>
          <caption className="sr-only">Each tribe with the members the plan gives it</caption>
          <thead className="bg-surface-strong">
            <tr>
              <th scope="col" className="p-3">Tribe</th>
              <th scope="col" className="p-3">Leader</th>
              <th scope="col" className="p-3 text-right">Seats</th>
              <th scope="col" className="p-3 text-right">New</th>
              <th scope="col" className="p-3">Fit</th>
              {live ? <th scope="col" className="p-3">Member emails</th> : null}
              {live ? <th scope="col" className="p-3">Where it stands</th> : null}
              {live ? <th scope="col" className="p-3"><span className="sr-only">Open now</span></th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((t) => {
              const st = TEAM_STATE_TEXT[t.state] ?? TEAM_STATE_TEXT.due;
              return (
                <tr key={t.tribe} data-testid="team-row" data-state={t.state}>
                  <th scope="row" className="p-3 font-semibold">
                    <Link href={`/god/tribes/${t.tribe}`} className="underline underline-offset-4">
                      {t.name}
                    </Link>
                  </th>
                  <td className="p-3">{t.leaderFirst}</td>
                  <td className="p-3 text-right tabular-nums">
                    {count(t.activeBefore + t.proposed)} / {count(t.capacity)}
                  </td>
                  <td className="p-3 text-right tabular-nums">{count(t.proposed || t.placed)}</td>
                  <td className="p-3 text-soft">
                    {FIT_ORDER.filter((k) => t.fit[k]).map((k) => `${count(t.fit[k])} ${k}`).join(", ") || "-"}
                    {t.small ? " · too small" : ""}
                  </td>
                  {live ? (
                    <td className="p-3 text-soft tabular-nums" data-testid="team-emails">
                      {count(t.sent)} sent · {count(t.waiting)} waiting · {count(t.failed)} failed
                    </td>
                  ) : null}
                  {live ? (
                    <td className="p-3">
                      <span className="font-semibold" data-testid="team-state">{st.label}</span>
                      <span className="block text-soft">
                        {t.state === "holding" && t.opensAt ? `Leader emailed from ${dayAndTime(t.opensAt)}` : st.line}
                        {t.unanswered > 0 && OPENABLE.has(t.state) ? ` ${pluralise(t.unanswered, "member")} yet to say yes.` : ""}
                      </span>
                    </td>
                  ) : null}
                  {live ? (
                    <td className="p-3 text-right">
                      {OPENABLE.has(t.state) ? (
                        <Button size="sm" variant="quiet" loading={d.busy === `open-${t.tribe}`} onClick={() => setAsking(t.tribe)} data-testid="open-now">
                          Open now
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {live && asking === "all" ? (
        <div role="alertdialog" aria-labelledby="open-all-sure" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/20 p-4" data-testid="open-all-confirm">
          <p id="open-all-sure" className="font-semibold">
            Open {pluralise(openable.length, "tribe")} now?
          </p>
          <p className="t-small">
            {unansweredAll === 0
              ? "Every member in these tribes has said yes, so this only emails each leader their team now."
              : `${pluralise(unansweredAll, "member")} ${unansweredAll === 1 ? "has" : "have"} not said yes. Opening overrides that: their email and WhatsApp number will be given to their leader anyway.`}{" "}
            Members who said “don’t share my details” stay withheld. Each leader is emailed their team, and these tribes can no longer be undone.
          </p>
          <div className="flex gap-3">
            <Button size="md" variant="solid" loading={d.busy === "open-all"} onClick={() => void openEvery()}>
              Yes, open them
            </Button>
            <Button size="md" variant="ghost" onClick={() => setAsking(null)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : null}
      {live && target ? (
        <div role="alertdialog" aria-labelledby="open-now-sure" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/20 p-4" data-testid="open-now-confirm">
          <p id="open-now-sure" className="font-semibold">
            Open {target.name} now?
          </p>
          <p className="t-small">
            {target.unanswered === 0
              ? `Everyone in ${target.name} has said yes, so this only emails ${target.leaderFirst || "the leader"} their team now.`
              : `${pluralise(target.unanswered, "member")} ${target.unanswered === 1 ? "has" : "have"} not said yes. Opening overrides that: their email and WhatsApp number will be given to ${target.leaderFirst || "the leader"} anyway.`}{" "}
            Members who said “don’t share my details” stay withheld. {target.leaderFirst || "The leader"} is emailed their team, and this tribe can no longer be undone.
          </p>
          <div className="flex gap-3">
            <Button size="md" variant="solid" loading={d.busy === `open-${target.tribe}`} onClick={() => void openOne(target)}>
              Yes, open it
            </Button>
            <Button size="md" variant="ghost" onClick={() => setAsking(null)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const FILTERS: { status: string; label: string }[] = [
  { status: "proposed", label: "In the plan" },
  { status: "unplaced", label: "Not placed" },
  { status: "skipped", label: "Left out" },
  { status: "held", label: "On hold" },
  { status: "placed", label: "Placed" },
  { status: "rehearsed", label: "Rehearsed" },
  { status: "removed", label: "Taken out" },
];

function People({ view, editable = false }: { view: RunView; editable?: boolean }) {
  const filters = FILTERS.filter((f) => (view.counts[f.status] ?? 0) > 0);
  // Open on the list people came to see: the plan while it is being read, who was placed (or would have been) afterwards
  const first = view.run.status === "planned" ? "proposed" : view.run.rehearsal ? "rehearsed" : "placed";
  const [status, setStatus] = useState<string>(filters.find((f) => f.status === first)?.status ?? filters[0]?.status ?? "proposed");
  const [version, setVersion] = useState(0);
  const [more, setMore] = useState(false);
  const key = `${view.run.id}:${status}:${version}`;
  const [data, setData] = useState<{ key: string; items: RunItem[]; total: number; error: string | null }>({ key: "", items: [], total: 0, error: null });
  const runId = view.run.id;

  // The list belongs to the filter it was loaded with, and is read again after any change
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: { key: string; items: RunItem[]; total: number; error: string | null };
      try {
        const r = await itemsAction(runId, status, 0);
        next = r.ok ? { key, items: r.items, total: r.total, error: null } : { key, items: [], total: 0, error: r.message };
      } catch {
        next = { key, items: [], total: 0, error: "We couldn’t load that. Check your connection and try again." };
      }
      if (!cancelled) setData(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, status, key]);

  async function showMore() {
    setMore(true);
    try {
      const r = await itemsAction(runId, status, data.items.length);
      if (r.ok) setData((d) => ({ ...d, items: [...d.items, ...r.items], total: r.total }));
      else setData((d) => ({ ...d, error: r.message }));
    } catch {
      setData((d) => ({ ...d, error: "We couldn’t load that. Check your connection and try again." }));
    }
    setMore(false);
  }
  const { items, total, error } = data;

  if (filters.length === 0) return null;
  return (
    <section aria-labelledby="people-heading" className="flex flex-col gap-3" data-testid="plan-people">
      <h2 id="people-heading" className="t-heading">
        The people
      </h2>
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.status}
            type="button"
            aria-pressed={status === f.status}
            onClick={() => setStatus(f.status)}
            className={`press rounded-full px-4 py-2 text-[0.92rem] font-medium ${status === f.status ? "bg-ink text-page" : "border border-line text-soft hover:text-ink"}`}
          >
            {f.label} · {count(view.counts[f.status] ?? 0)}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-control)] border border-line">
        {(data.key === key ? items : []).map((i) => (
          <Person key={i.person} item={i} runId={view.run.id} editable={editable && i.status === "proposed"} onChanged={() => setVersion((n) => n + 1)} />
        ))}
        {data.key === key && items.length === 0 ? <li className="p-4 text-soft">Nobody here.</li> : null}
        {data.key !== key ? <li className="p-4 text-soft" aria-live="polite">Loading…</li> : null}
      </ul>
      {items.length < total ? (
        <div>
          <Button size="sm" variant="quiet" loading={more} onClick={() => void showMore()}>
            Show more ({count(total - items.length)} left)
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Person({ item, runId, editable, onChanged }: { item: RunItem; runId: string; editable: boolean; onChanged: () => void }) {
  const router = useRouter();
  const d = useDo();
  const [options, setOptions] = useState<TribeOption[] | null>(null);

  async function more() {
    const r = await optionsAction(runId, item.person);
    if (r.ok) setOptions(r.options);
    else d.go("options", async () => r);
  }
  const act = (key: string, fn: () => ReturnType<typeof adjustAction>) =>
    d.go(key, fn, { after: () => (setOptions(null), onChanged(), router.refresh()) });

  return (
    <li className="flex flex-col gap-2 p-3" data-testid={`person-${item.person}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0">
          <Link href={`/god/people/${item.person}`} className="font-semibold underline underline-offset-4">
            {item.name}
          </Link>
          <span className="t-small block text-soft">
            {item.tribeName ? `${item.tribeName}${item.fit ? ` · ${fitName(item.fit)}` : ""}${item.moved ? " · moved by you" : ""}` : STATUS_TEXT[item.status] ?? item.status}
            {item.reason ? ` · ${reasonText(item.reason)}` : ""}
            {item.message ? ` · email ${MESSAGE_TEXT[item.message] ?? item.message}` : ""}
            {item.confirmed ? " · said yes" : ""}
            {item.withheld ? " · details withheld" : ""}
            {item.seat === "released" ? " · gave up the seat" : ""}
          </span>
        </span>
        {editable ? (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="quiet" onClick={() => void (options ? setOptions(null) : more())}>
              {options ? "Close" : "Other tribes"}
            </Button>
            <Button size="sm" variant="ghost" loading={d.busy === "remove"} onClick={() => void act("remove", () => adjustAction(runId, item.person, "remove", null))}>
              Take out
            </Button>
            <Button size="sm" variant="ghost" loading={d.busy === "hold"} onClick={() => void act("hold", () => adjustAction(runId, item.person, "hold", null))}>
              Set aside
            </Button>
          </span>
        ) : null}
      </div>
      <Notice error={d.error} />
      {options ? (
        options.length === 0 ? (
          <p className="t-small text-soft">No other tribe fits their stage, time and format with room to spare.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {options.map((o) => (
              <li key={o.tribe} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface-strong p-3">
                <span className="t-small">
                  <strong>{o.name}</strong> · {o.leader} · {fitName(o.label)} ({o.degree}%) · {pluralise(o.seats, "seat")} left
                  {o.belowFloor ? <Badge tone="flame" className="ml-2">Below the bar</Badge> : null}
                </span>
                <Button size="sm" variant="quiet" loading={d.busy === `move-${o.tribe}`} onClick={() => void act(`move-${o.tribe}`, () => adjustAction(runId, item.person, "move", o.tribe))}>
                  Move here
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

function Approve({ view, proposed, blocked }: { view: RunView; proposed: number; blocked: number }) {
  const router = useRouter();
  const d = useDo();
  const [asking, setAsking] = useState(false);
  const rehearsal = view.run.rehearsal;

  async function approve() {
    const ok = await d.go("approve", () => approveRunAction(view.run.id, proposed));
    if (ok) router.refresh();
  }

  return (
    <section aria-labelledby="approve-heading" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="approve">
      <h2 id="approve-heading" className="t-heading">
        {rehearsal ? "Walk through this plan" : "Approve this plan"}
      </h2>
      {rehearsal ? (
        <p className="t-body text-soft">This is a rehearsal. Nobody is seated and nothing is sent. What each leader would have been told is kept in the message log, with first names only.</p>
      ) : (
        <ul className="t-small flex list-disc flex-col gap-1 pl-5 text-soft">
          {PLAN_PROMISES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {blocked > 0 ? <p role="status" className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3">Decide about the {blocked === 1 ? "tribe" : `${blocked} tribes`} that would start too small first.</p> : null}
      <Notice error={d.error} />
      {asking ? (
        <div role="alertdialog" aria-labelledby="sure-heading" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/20 p-4">
          <p id="sure-heading" className="font-semibold">
            {rehearsal ? `Walk through the placement of ${pluralise(proposed, "member")}?` : `Place ${pluralise(proposed, "member")} and start telling them?`}
          </p>
          <div className="flex gap-3">
            <Button size="md" variant="solid" loading={d.busy === "approve"} onClick={() => void approve()}>
              {rehearsal ? "Yes, walk through it" : "Yes, approve"}
            </Button>
            <Button size="md" variant="ghost" onClick={() => setAsking(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button size="md" variant="solid" disabled={blocked > 0 || proposed === 0} onClick={() => setAsking(true)}>
            {rehearsal ? "Walk through" : "Approve"} {proposed > 0 ? `(${count(proposed)})` : ""}
          </Button>
          <CancelRun runId={view.run.id} />
        </div>
      )}
    </section>
  );
}

function CancelRun({ runId }: { runId: string }) {
  const router = useRouter();
  const d = useDo();
  return (
    <>
      <Button size="md" variant="ghost" loading={d.busy === "cancel"} onClick={() => void d.go("cancel", () => cancelRunAction(runId), { after: () => router.refresh() })}>
        Cancel this run
      </Button>
      <Notice error={d.error} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Placing
// ---------------------------------------------------------------------------

function PlaceDriver({ view }: { view: RunView }) {
  const router = useRouter();
  const [done, setDone] = useState(view.counts.placed ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const total = (view.counts.proposed ?? 0) + (view.counts.placed ?? 0) + (view.counts.rehearsed ?? 0) + (view.counts.skipped ?? 0);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    let stop = false;
    void (async () => {
      for (let guard = 0; guard < 10_000 && !stop; guard++) {
        let r;
        try {
          r = await placeRunAction(view.run.id);
        } catch {
          setError("We lost the connection. The work carries on in the background; reload to see where it has got to.");
          break;
        }
        if (!r.ok) {
          setError(r.message);
          break;
        }
        setDone((n) => n + r.done);
        if (r.left === 0 || (r.status !== "approved" && r.status !== "placing")) {
          router.refresh();
          break;
        }
      }
      running.current = false;
    })();
    return () => {
      stop = true;
    };
  }, [view.run.id, attempt, router]);

  return (
    <section className="card flex flex-col gap-3 p-5 sm:p-6" aria-live="polite" data-testid="place-driver">
      <h2 className="t-heading">{view.run.rehearsal ? "Walking through the plan" : "Placing members"}</h2>
      <p className="t-body text-soft">
        {count(done)} of {count(total)} done. The emails then go out through the day, {count(view.run.pacePerHour)} an hour. You can close this page: the rest carries on by itself.
      </p>
      {error ? (
        <>
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
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

// ---------------------------------------------------------------------------
// After
// ---------------------------------------------------------------------------

function Results({ view }: { view: RunView }) {
  const { results: r, run } = view;
  const canUndo = !run.rehearsal && (run.status === "placing" || run.status === "placed") && r.leadersWaiting > 0;
  return (
    <>
      <section aria-labelledby="results-heading" className="flex flex-col gap-4" data-testid="run-results">
        <h2 id="results-heading" className="t-heading">
          {run.status === "undone" ? "What is left of this run" : run.rehearsal ? "What the rehearsal showed" : "How it is going"}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={run.rehearsal ? "Would have been placed" : "Placed"} value={count(run.rehearsal ? (view.counts.rehearsed ?? 0) : r.placed)} />
          <Stat label="Said yes" value={count(r.confirmed)} />
          <Stat label="Chose to look elsewhere" value={count(r.changed)} />
          <Stat label="Kept their details private" value={count(r.withheld)} />
        </dl>
        {Object.keys(r.messages).length > 0 ? (
          <p className="t-body text-soft">
            Member emails:{" "}
            {Object.entries(r.messages).map(([k, n], i) => (
              <span key={k}>
                {i > 0 ? ", " : ""}
                {count(n)} {MESSAGE_TEXT[k] ?? k}
              </span>
            ))}
            .
          </p>
        ) : null}
        {!run.rehearsal ? (
          <p className="t-body text-soft">
            Leaders told: {count(r.leadersTold)}. Still to be told: {count(r.leadersWaiting)}. A leader sees everyone placed in their tribe by name from the moment they are placed. Each member’s email and WhatsApp number open {run.holdHours} hours after that member’s email went, or at once when they say yes.
          </p>
        ) : null}
        {!run.rehearsal ? <Heartbeat at={view.heartbeatAt} mode={view.mode} /> : null}
      </section>
      <Teams teams={view.teams} live={run.rehearsal ? null : { runId: run.id }} />
      <People view={view} />
      {canUndo ? <Undo runId={run.id} waiting={r.leadersWaiting} /> : null}
      {run.status === "undone" ? <p className="card t-body p-5 text-soft">This run was undone{run.undoneAt ? ` on ${formatShortDate(run.undoneAt)}` : ""}. Members who had not answered were released. Members who said yes, and tribes whose leader had already been told, stayed as they were.</p> : null}
    </>
  );
}

/** When the heartbeat last ran. It sends the waiting emails and tells leaders; if it stops, nothing moves on its own. */
function Heartbeat({ at, mode }: { at: string | null; mode: RunView["mode"] }) {
  return (
    <p className="t-small text-soft" data-testid="heartbeat">
      Heartbeat last ran: {at ? `${formatLagosDay(at)}, ${formatLagosTime(at)}` : "never"}. {mode === "on" ? "" : `The switch is ${mode === "off" ? "Off" : "Rehearsal"}: the heartbeat still finishes telling leaders for people already placed, and starts nothing new. `}
      {HEARTBEAT_HINT}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      <dt className="t-small text-soft">{label}</dt>
    </div>
  );
}

function Undo({ runId, waiting }: { runId: string; waiting: number }) {
  const router = useRouter();
  const d = useDo();
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  async function undo() {
    const ok = await d.go("undo", async () => {
      const r = await undoRunAction(runId);
      if (r.ok) setSaid(`Undone. ${pluralise(r.released, "member")} released; ${r.keptConfirmed} who said yes and ${r.keptTold} in tribes already told stayed.`);
      return r.ok ? { ok: true as const } : r;
    });
    if (ok) {
      setAsking(false);
      router.refresh();
    }
  }

  return (
    <section aria-labelledby="undo-heading" className="card flex flex-col gap-3 p-5 sm:p-6" data-testid="undo">
      <h2 id="undo-heading" className="t-heading">
        Undo this run
      </h2>
      <p className="t-small text-soft">
        You can undo a tribe until its leader has been told, whether by the heartbeat or by Open now. {pluralise(waiting, "tribe")} {waiting === 1 ? "has" : "have"} not been. Members who have not answered are released and their emails stop. Members who said yes stay, and a tribe whose leader has been told stays as it is.
      </p>
      <Notice error={d.error} saved={said} />
      {asking ? (
        <div role="alertdialog" aria-labelledby="undo-sure" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/20 p-4">
          <p id="undo-sure" className="font-semibold">
            Undo run, and stop the rest?
          </p>
          <div className="flex gap-3">
            <Button size="md" variant="solid" loading={d.busy === "undo"} onClick={() => void undo()}>
              Yes, undo
            </Button>
            <Button size="md" variant="ghost" onClick={() => setAsking(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="md" variant="quiet" onClick={() => setAsking(true)}>
            Undo this run
          </Button>
        </div>
      )}
    </section>
  );
}
