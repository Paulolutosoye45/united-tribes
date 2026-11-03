"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { holdClearAction, newRunAction, saveSettingsAction } from "@/app/(app)/god/placement/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { OfficeRequests } from "@/components/placement/OfficeRequests";
import { Select } from "@/components/ui/Input";
import { formatLagosDay, formatLagosTime, formatShortDate } from "@/lib/dates";
import { MODES, type Hold, type OfficeCounts, type OfficeRequest, type Overview, type PlacementMode, type Settings } from "@/lib/placement/types";
import { HEARTBEAT_HINT, IN_SEASON_PROMISES, MODE_WORDS, PLAN_PROMISES, RUN_STATUS_TEXT, ZONE_TEXT, count, hourText, pluralise, windowLine } from "@/lib/placement/wording";

type Community = { id: string; name: string };

/**
 * The Placement overview: the switch, who there is to place and room to place them, the plan in progress or a new one, the church's
 * choices, and the members set aside. Nothing here places anyone. A run is read and approved on its own page.
 */
export function PlacementHome({ overview, communities, holds, counts, requests }: { overview: Overview; communities: Community[]; holds: Hold[]; counts: OfficeCounts | null; requests: OfficeRequest[] }) {
  const { settings: s, supply } = overview;
  return (
    <div className="flex flex-col gap-8" data-testid="placement-home">
      <Switch mode={s.mode} lastTickAt={s.lastTickAt} />
      <Supply overview={overview} />
      {overview.openRun ? <OpenRun run={overview.openRun} /> : <NewRun settings={s} communities={communities} window={overview.window} />}
      <PlaceOnePointer />
      <Office counts={counts} requests={requests} />
      <Choices settings={s} />
      <Holds holds={holds} onHold={supply.onHold} />
      <Past runs={overview.runs} />
    </div>
  );
}

function Switch({ mode, lastTickAt }: { mode: PlacementMode; lastTickAt: string | null }) {
  const d = useDo();
  const [asking, setAsking] = useState(false);

  async function choose(next: PlacementMode) {
    if (next === mode) return;
    if (next === "on" && !asking) return setAsking(true);
    setAsking(false);
    await d.go(`mode-${next}`, () => saveSettingsAction({ mode: next }), { saved: `Placement is ${MODE_WORDS[next].name}.` });
  }

  return (
    <section aria-labelledby="switch-heading" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="placement-switch">
      <div>
        <h2 id="switch-heading" className="t-heading">
          The switch
        </h2>
        <p className="t-small text-soft">It starts Off. Rehearsal lets you plan and walk through a run without seating anyone or sending anything.</p>
      </div>
      <div role="group" aria-label="Placement switch" className="grid gap-3 sm:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            disabled={d.busy !== null}
            onClick={() => void choose(m)}
            data-testid={`mode-${m}`}
            className={`press flex flex-col items-start gap-1 rounded-[var(--radius-control)] border-[1.5px] p-4 text-left ${mode === m ? "border-ink bg-surface-strong" : "border-line hover:border-soft"}`}
          >
            <span className="font-semibold">
              {MODE_WORDS[m].name}
              {mode === m ? <span className="t-small font-normal text-soft"> · now</span> : null}
            </span>
            <span className="t-small text-soft">{MODE_WORDS[m].line}</span>
          </button>
        ))}
      </div>
      {asking ? (
        <div role="alertdialog" aria-labelledby="on-heading" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-gold/20 p-4" data-testid="switch-on-confirm">
          <p id="on-heading" className="font-semibold">
            Switch Placement On?
          </p>
          <ul className="t-small flex list-disc flex-col gap-1 pl-5">
            {PLAN_PROMISES.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="flex gap-3">
            <Button size="md" variant="solid" loading={d.busy === "mode-on"} onClick={() => void choose("on")}>
              Yes, switch it On
            </Button>
            <Button size="md" variant="ghost" onClick={() => setAsking(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : null}
      <p className="t-small text-soft" data-testid="heartbeat">
        Heartbeat last ran: {lastTickAt ? `${formatLagosDay(lastTickAt)}, ${formatLagosTime(lastTickAt)}` : "never"}. {HEARTBEAT_HINT}
      </p>
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}

function Supply({ overview }: { overview: Overview }) {
  const { supply, season, settings } = overview;
  const rows: [string, string][] = [
    ["Members waiting for a tribe", count(supply.membersWithForm)],
    ["Seats open in approved tribes", count(supply.seatsOpen)],
    ["Approved tribes with a certified leader", count(supply.tribesOpen)],
    ["Members who have not finished the form", count(supply.membersWithoutForm)],
  ];
  return (
    <section aria-labelledby="supply-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="supply-heading" className="t-heading">
          Who there is to place
        </h2>
        <p className="t-small text-soft">
          {windowLine(overview.window ?? (season ? { name: season.name, started: false, week: null, weeks: 0, open: true } : null), season?.startsOn ?? null, overview.window?.closesOn ?? null, formatShortDate)}A member is placed only in a tribe at or above {settings.floor}% compatibility, and a seat is always kept free.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="card flex flex-col gap-1 p-4">
            <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
            <dt className="t-small text-soft">{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

function OpenRun({ run }: { run: NonNullable<Overview["openRun"]> }) {
  return (
    <section aria-labelledby="open-heading" className="card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6" data-testid="open-run">
      <div>
        <h2 id="open-heading" className="t-heading">
          Run {run.seq} is open
        </h2>
        <p className="t-small text-soft">
          {run.rehearsal ? "A rehearsal. " : ""}
          {RUN_STATUS_TEXT[run.status] ?? run.status} · {pluralise(run.pool, "member")} in the pool
        </p>
      </div>
      <Link href={`/god/placement/${run.id}`} className="btn btn-solid inline-flex h-12 items-center rounded-[var(--radius-control)] px-5 font-semibold">
        Open run {run.seq}
      </Link>
    </section>
  );
}

function NewRun({ settings, communities, window }: { settings: Settings; communities: Community[]; window: Overview["window"] }) {
  const router = useRouter();
  const d = useDo();
  const [community, setCommunity] = useState("");
  const [zone, setZone] = useState("");
  const [pace, setPace] = useState(String(settings.pacePerHour));
  const [afterCutoff, setAfterCutoff] = useState(false);
  const off = settings.mode === "off";
  const closed = Boolean(window && window.started && !window.open);
  const inSeason = Boolean(window && window.started);

  async function start() {
    const n = Number(pace);
    let id: string | null = null;
    const ok = await d.go("new", async () => {
      const r = await newRunAction({ community: community || undefined, zone: zone || undefined, pace: Number.isFinite(n) && pace.trim() !== "" ? n : undefined, afterCutoff: closed && afterCutoff });
      if (r.ok) id = r.run;
      return r.ok ? { ok: true as const } : r;
    });
    if (ok && id) router.push(`/god/placement/${id}`);
  }

  return (
    <section aria-labelledby="new-heading" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="new-run">
      <div>
        <h2 id="new-heading" className="t-heading">
          Plan a run
        </h2>
        <p className="t-small text-soft">Nothing is placed yet. The plan is made first and you read it. For a first run, narrow it to one community or one area, and keep the pace low.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Select label="Only this community (optional)" value={community} onChange={(e) => setCommunity(e.target.value)}>
          <option value="">Everyone</option>
          {communities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select label="Only this area (optional)" value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">Everywhere</option>
          {Object.entries(ZONE_TEXT).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.95rem] font-medium">Emails an hour</span>
          <input className="input" inputMode="numeric" value={pace} onChange={(e) => setPace(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          <span className="t-small text-soft">Between {hourText(settings.sendFrom)} and {hourText(settings.sendUntil)}, Lagos time.</span>
        </label>
      </div>
      {inSeason ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-surface-strong p-4" data-testid="in-season">
          <p className="font-semibold">The season has started</p>
          <ul className="t-small flex list-disc flex-col gap-1 pl-5">
            {IN_SEASON_PROMISES.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {closed ? (
        <label className="flex items-start gap-3" data-testid="after-cutoff">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={afterCutoff} onChange={(e) => setAfterCutoff(e.target.checked)} />
          <span className="flex flex-col gap-0.5">
            <span className="text-[0.95rem] font-medium">Place after the cut-off</span>
            <span className="t-small text-soft">Joining closed on {window ? formatShortDate(window.closesOn) : ""}. Tick this only if you mean to place people now anyway.</span>
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="md" variant="solid" loading={d.busy === "new"} disabled={off || (closed && !afterCutoff)} onClick={() => void start()}>
          Plan a run
        </Button>
        {off ? <span className="t-small text-soft">Switch to Rehearsal or On first.</span> : null}
      </div>
      <Notice error={d.error} />
    </section>
  );
}

/** What admins and directors have placed from Admin, by person, and the requests they made to you. */
function Office({ counts, requests }: { counts: OfficeCounts | null; requests: OfficeRequest[] }) {
  const open = requests.filter((r) => r.status === "open");
  const closed = requests.filter((r) => r.status !== "open");
  return (
    <section aria-labelledby="office-heading" className="flex flex-col gap-4" data-testid="office-placement">
      <div className="flex flex-col gap-1">
        <h2 id="office-heading" className="t-heading">
          Placed from Admin
        </h2>
        <p className="t-small measure text-soft">
          Admins and directors can place or move one member at a time, with the same checks you have. Anything past a warning only you may accept comes to you here, and lapses after 7 days.
        </p>
      </div>
      <h3 className="font-semibold" data-testid="office-requests-heading">
        {open.length === 0 ? "No requests are waiting for you" : `${open.length} ${open.length === 1 ? "request is" : "requests are"} waiting for you`}
      </h3>
      <OfficeRequests requests={open} owner />
      {closed.length > 0 ? (
        <details>
          <summary className="t-small cursor-pointer font-semibold">Answered, taken back or lapsed in the last 30 days ({closed.length})</summary>
          <div className="mt-3">
            <OfficeRequests requests={closed} owner />
          </div>
        </details>
      ) : null}
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">By person, the last 30 days</h3>
        {counts && counts.byPerson.length > 0 ? (
          <ul className="card divide-y divide-line overflow-hidden" data-testid="office-counts">
            {counts.byPerson.map((p) => (
              <li key={`${p.name}-${p.role}`} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <p className="t-body">
                  <span className="font-semibold">{p.name}</span> <span className="text-soft">({p.role})</span>
                </p>
                <p className="t-small text-soft">
                  {p.placed} placed · {p.moved} moved · {p.undone} undone · {p.today} today{p.last ? ` · last ${formatLagosDay(p.last)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-small text-soft" data-testid="office-counts-none">
            Nobody has placed or moved anyone from Admin yet.
          </p>
        )}
      </div>
    </section>
  );
}

function PlaceOnePointer() {
  return (
    <section aria-labelledby="one-heading" className="flex flex-col gap-1" data-testid="place-one-pointer">
      <h2 id="one-heading" className="t-heading">
        Place one person
      </h2>
      <p className="t-small measure text-soft">
        To place one person in one tribe, open them in <Link href="/god/people" className="font-semibold underline underline-offset-4">People</Link> and use “Place in a tribe”, or “Move to another tribe” for a member who has a seat. It needs Placement to be On, and each warning it gives needs a tick and a reason.
      </p>
    </section>
  );
}

const FIELDS: { key: keyof Settings; column: string; name: string; hint: string; min: number; max: number }[] = [
  { key: "graceDays", column: "grace_days", name: "Days to let a member choose first", hint: "Someone who used the app this recently is left alone.", min: 0, max: 30 },
  { key: "seatsFree", column: "seats_free", name: "Seats kept free in each tribe", hint: "So a member who looks later still has room.", min: 0, max: 2 },
  { key: "minTribe", column: "min_tribe", name: "Smallest tribe worth starting", hint: "A tribe the plan would leave smaller is flagged for you.", min: 4, max: 8 },
  { key: "pacePerHour", column: "pace_per_hour", name: "Emails an hour", hint: "How fast members are told.", min: 1, max: 1000 },
  { key: "sendFrom", column: "send_from", name: "Start sending at (hour)", hint: "Lagos time, 24-hour clock.", min: 6, max: 20 },
  { key: "sendUntil", column: "send_until", name: "Stop sending at (hour)", hint: "Lagos time, 24-hour clock.", min: 7, max: 21 },
  { key: "holdHours", column: "hold_hours", name: "Hours before a leader is told", hint: "How long the leader’s first email waits, so quick yeses can be in it. Nothing opens when it ends.", min: 0, max: 72 },
  { key: "reminderDays", column: "reminder_days", name: "Days before the one reminder", hint: "Sent once, only to members who have not answered.", min: 1, max: 14 },
];

function Choices({ settings }: { settings: Settings }) {
  const d = useDo();
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key])])));
  const [holdLink, setHoldLink] = useState(settings.holdGroupLink);
  const changed = FIELDS.filter((f) => vals[f.key] !== String(settings[f.key]));
  const linkChanged = holdLink !== settings.holdGroupLink;

  async function save() {
    const changes: Record<string, number | boolean> = {};
    if (linkChanged) changes.hold_group_link = holdLink;
    for (const f of changed) {
      const n = Number(vals[f.key]);
      if (vals[f.key].trim() === "" || !Number.isInteger(n) || n < f.min || n > f.max) return d.go("choices", async () => ({ ok: false as const, message: `${f.name}: use a whole number from ${f.min} to ${f.max}.` }));
      changes[f.column] = n;
    }
    await d.go("choices", () => saveSettingsAction(changes), { saved: "Saved. A plan already made keeps the numbers it was made with." });
  }

  return (
    <details className="card p-5 sm:p-6" data-testid="choices">
      <summary className="t-heading cursor-pointer">The church’s choices</summary>
      <div className="mt-4 flex flex-col gap-4">
        <p className="t-small text-soft">The pastor’s compatibility bar ({settings.floor}%) is set with the matching model and cannot be changed here.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5">
              <span className="text-[0.95rem] font-medium">{f.name}</span>
              <input className="input" inputMode="numeric" value={vals[f.key]} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value.replace(/\D/g, "").slice(0, 4) }))} />
              <span className="t-small text-soft">{f.hint}</span>
            </label>
          ))}
        </div>
        <label className="flex items-start gap-3" data-testid="hold-group-link">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={holdLink} onChange={(e) => setHoldLink(e.target.checked)} />
          <span className="flex flex-col gap-0.5">
            <span className="text-[0.95rem] font-medium">Hold back the WhatsApp group link until a member has answered</span>
            <span className="t-small text-soft">Joining a group shows a member’s number to everyone in it, so the link waits until they say yes. Untick to give the link in the first email, as before.</span>
          </span>
        </label>
        <div className="flex items-center gap-3">
          <Button size="md" variant="solid" loading={d.busy === "choices"} disabled={changed.length === 0 && !linkChanged} onClick={() => void save()}>
            Save
          </Button>
        </div>
        <Notice error={d.error} saved={d.saved} />
      </div>
    </details>
  );
}

function Holds({ holds, onHold }: { holds: Hold[]; onHold: number }) {
  const d = useDo();
  return (
    <section aria-labelledby="holds-heading" className="flex flex-col gap-3" data-testid="holds">
      <div>
        <h2 id="holds-heading" className="t-heading">
          Set aside
        </h2>
        <p className="t-small text-soft">{onHold === 0 ? "Nobody is on hold. A member you set aside is left out of every run until you release them." : `${pluralise(onHold, "member")} on hold, left out of every run until released.`}</p>
      </div>
      <Notice error={d.error} saved={d.saved} />
      {holds.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-control)] border border-line">
          {holds.map((h) => (
            <li key={h.person} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <span className="min-w-0">
                <Link href={`/god/people/${h.person}`} className="font-semibold underline underline-offset-4">
                  {h.name}
                </Link>
                {h.since ? <span className="t-small text-soft"> · since {formatShortDate(h.since)}</span> : null}
              </span>
              <Button size="sm" variant="quiet" loading={d.busy === `hold-${h.person}`} onClick={() => void d.go(`hold-${h.person}`, () => holdClearAction(h.person), { saved: `${h.name} is released.` })}>
                Release
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Past({ runs }: { runs: Overview["runs"] }) {
  if (runs.length === 0) return null;
  return (
    <section aria-labelledby="past-heading" className="flex flex-col gap-3" data-testid="past-runs">
      <h2 id="past-heading" className="t-heading">
        Runs so far
      </h2>
      <ul className="flex flex-col gap-3">
        {runs.map((r) => (
          <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-semibold">
                {r.single ? "Single placement" : `Run ${r.seq}`} {r.rehearsal ? <Badge tone="outline">Rehearsal</Badge> : null}
                {r.inSeason ? <Badge tone="outline">Running season</Badge> : null}
              </p>
              <p className="t-small text-soft">
                {RUN_STATUS_TEXT[r.status] ?? r.status}
                {r.createdAt ? ` · ${formatShortDate(r.createdAt)}` : ""} · {pluralise(r.placed, "member")} placed · {count(r.confirmed)} said yes
                {r.note ? ` · “${r.note}”` : ""}
              </p>
            </div>
            <Link href={`/god/placement/${r.id}`} className="font-semibold underline underline-offset-4">
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
