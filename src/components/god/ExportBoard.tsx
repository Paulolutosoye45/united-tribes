"use client";

import { useState } from "react";
import { searchPeopleAction, settingsSaveAction, testerSetAction, type FoundPerson } from "@/app/(app)/god/exports/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { ExportLog } from "@/components/god/ExportLog";
import { ExportPacks } from "@/components/god/ExportPacks";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Input } from "@/components/ui/Input";
import { packInfo } from "@/lib/exports/registry";
import type { Board, LogLine } from "@/lib/exports/types";
import { DELIVERY_SWITCHES, DOOR_SWITCHES, FORMAT_SWITCHES, describeSwitch, lagosWhen, roleName } from "@/lib/exports/wording";

/**
 * The switchboard for Exports and Reports. It is part of the owner's console and the only place any switch of this feature can be moved:
 * the pack positions, the formats, the ways in, the two stops, the testers, the impact assessment and the unusual-use number. The
 * database refuses every one of these to anyone but the unlocked owner, so this page being hidden is never the only protection.
 */
export function ExportBoard({ board, log }: { board: Board; log: LogLine[] }) {
  const names = Object.fromEntries(board.packs.map((p) => [p.id, p.name]));
  return (
    <div className="flex flex-col gap-10" data-testid="export-board">
      <Summary board={board} />
      <Stops board={board} />
      <ExportPacks board={board} />
      <Ways key={board.settings.updated_at ?? "none"} board={board} />
      <Testers board={board} />
      <Assessment key={`a-${board.settings.updated_at ?? "none"}`} board={board} />
      <Unusual board={board} names={names} />
      <Changes board={board} names={names} />
      <ExportLog initial={log} packs={board.packs.map((p) => ({ id: p.id, name: p.name }))} />
    </div>
  );
}

function Summary({ board }: { board: Board }) {
  const by = (pos: string) => board.packs.filter((p) => p.position === pos).length;
  const s = board.settings;
  const rows: [string, string][] = [
    ["Packs On", String(by("on"))],
    ["Limited", String(by("limited"))],
    ["In Rehearsal", String(by("rehearsal"))],
    ["Off", String(by("off"))],
    ["Links open now", String(board.links_live)],
    ["Standing links live", String(board.feeds_live)],
  ];
  return (
    <section aria-labelledby="sum-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="sum-heading" className="t-heading">
          Where it stands
        </h2>
        <p className="t-small text-soft">
          {s.paused ? "Everything is paused: every pack acts as Off." : s.people_stopped ? "People files are stopped: every named file acts as Off. Coded reports still run." : "Nothing is paused or stopped."} Every switch below starts Off.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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

function Stops({ board }: { board: Board }) {
  const d = useDo();
  const [note, setNote] = useState("");
  const s = board.settings;
  const rows = [
    {
      key: "paused" as const,
      name: "Pause all exports",
      on: s.paused,
      line: "Every file, at once. Every pack acts as Off, links already made stop opening, and the Studio shows nothing. Nothing is lost: switch it back and the packs return as they were.",
      doing: "Pause everything",
      undoing: "Resume exports",
    },
    {
      key: "people_stopped" as const,
      name: "Stop all People files",
      on: s.people_stopped,
      line: "Every named file, at once. The coded reports keep running. Use it the moment a named file should not leave the church.",
      doing: "Stop People files",
      undoing: "Allow People files again",
    },
  ];
  return (
    <section aria-labelledby="stops-heading" className="flex flex-col gap-3" data-testid="export-stops">
      <div>
        <h2 id="stops-heading" className="t-heading">
          The two stops
        </h2>
        <p className="t-small text-soft">These act at once, and are logged. Only you can move them.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} className={`card flex flex-col gap-3 p-5 ${r.on ? "border-flame" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{r.name}</h3>
              <Badge tone={r.on ? "flame" : "outline"}>{r.on ? "Stopped" : "Not stopped"}</Badge>
            </div>
            <p className="t-small text-soft">{r.line}</p>
            <div>
              <Button size="md" variant={r.on ? "solid" : "quiet"} loading={d.busy === r.key} disabled={d.busy !== null} onClick={() => void d.go(r.key, () => settingsSaveAction({ [r.key]: !r.on }, note || undefined), { saved: r.on ? `${r.undoing}: done.` : `${r.name}: done.` })} data-testid={`stop-${r.key}`}>
                {r.on ? r.undoing : r.doing}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Input label="A note for the log (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}

type Doing = ReturnType<typeof useDo>;

function Ways({ board }: { board: Board }) {
  const d = useDo();
  return (
    <section aria-labelledby="ways-heading" className="flex flex-col gap-4" data-testid="export-ways">
      <div>
        <h2 id="ways-heading" className="t-heading">
          Formats and ways in
        </h2>
        <p className="t-small measure text-soft">A pack needs its own position <em>and</em> its format to be on. A format that is off cannot be made by anyone, whatever the packs say.</p>
      </div>
      <WaysForm key={board.settings.updated_at ?? "none"} board={board} d={d} />
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}

/** The choices being made. It starts afresh from what was saved each time a change is saved; the notice stays in the section around it. */
function WaysForm({ board, d }: { board: Board; d: Doing }) {
  const s = board.settings;
  const [formats, setFormats] = useState<string[]>(s.formats);
  const [deliveries, setDeliveries] = useState<string[]>(s.deliveries);
  const [doors, setDoors] = useState<string[]>(s.doors);
  const [reason, setReason] = useState("");
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const changed = !same(formats, s.formats) || !same(deliveries, s.deliveries) || !same(doors, s.doors);
  const toggle = (list: string[], set: (v: string[]) => void, key: string, on: boolean) => set(on ? [...list, key] : list.filter((x) => x !== key));

  function save() {
    const changes: Record<string, unknown> = {};
    if (!same(formats, s.formats)) changes.formats = formats;
    if (!same(deliveries, s.deliveries)) changes.deliveries = deliveries;
    if (!same(doors, s.doors)) changes.doors = doors;
    void d.go("ways", () => settingsSaveAction(changes, reason || undefined), { saved: "Saved." });
  }

  return (
    <>
      <Switches title="Formats" items={FORMAT_SWITCHES} on={formats} onToggle={(k, on) => toggle(formats, setFormats, k, on)} />
      <Switches title="Ways to receive a file" items={DELIVERY_SWITCHES} on={deliveries} onToggle={(k, on) => toggle(deliveries, setDeliveries, k, on)} />
      <Switches title="Doors for reporting tools" items={DOOR_SWITCHES} on={doors} onToggle={(k, on) => toggle(doors, setDoors, k, on)} />
      <p className="t-small text-soft">Sending files to a named destination (a form, a folder, another system) is not part of this release. There is no switch for it, because nothing yet leaves the church that way.</p>
      {changed ? (
        <div className="flex flex-col gap-3">
          <Input label="Why? (optional, kept in the log)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-3">
            <Button size="md" variant="solid" loading={d.busy === "ways"} disabled={d.busy !== null} onClick={save} data-testid="ways-save">
              Save these switches
            </Button>
            <Button size="md" variant="ghost" disabled={d.busy !== null} onClick={() => { setFormats(s.formats); setDeliveries(s.deliveries); setDoors(s.doors); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Switches({ title, items, on, onToggle }: { title: string; items: { key: string; name: string; line: string }[]; on: string[]; onToggle: (key: string, on: boolean) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <Choice key={i.key} type="checkbox" name={`sw-${i.key}`} value={i.key} checked={on.includes(i.key)} onChange={(e) => onToggle(i.key, e.target.checked)} title={i.name} description={i.line} />
        ))}
      </div>
    </fieldset>
  );
}

function Testers({ board }: { board: Board }) {
  const d = useDo();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FoundPerson[] | null>(null);
  const have = new Set(board.testers.map((t) => t.person_id));

  return (
    <section aria-labelledby="testers-heading" className="flex flex-col gap-4" data-testid="export-testers">
      <div>
        <h2 id="testers-heading" className="t-heading">
          Testers
        </h2>
        <p className="t-small measure text-soft">
          While a pack is in Rehearsal, only these people can make it, and every file says REHEARSAL. A good first group is one director, the data lead and three tribe leaders.
        </p>
      </div>
      {board.testers.length === 0 ? (
        <p className="t-body text-soft">No testers yet. A pack in Rehearsal cannot be made by anyone until you add some.</p>
      ) : (
        <ul className="card flex flex-col divide-y divide-line p-0">
          {board.testers.map((t) => (
            <li key={t.person_id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="tester">
              <div>
                <p className="font-semibold">{t.name}</p>
                <p className="t-small text-soft">{t.roles ? t.roles.split(", ").map(roleName).join(", ") : "No role"} · added {lagosWhen(t.added_at, true)}</p>
              </div>
              <Button size="sm" variant="ghost" loading={d.busy === t.person_id} disabled={d.busy !== null} onClick={() => void d.go(t.person_id, () => testerSetAction(t.person_id, false), { saved: `${t.name} is no longer a tester.` })}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void d.go("find", async () => {
            const r = await searchPeopleAction(q);
            if (r.ok) setFound(r.people);
            return r.ok ? { ok: true as const } : r;
          });
        }}
      >
        <div className="min-w-60 flex-1">
          <Input label="Find a person to add" value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} hint="Search by name or email." />
        </div>
        <Button size="md" variant="quiet" type="submit" loading={d.busy === "find"} disabled={q.trim().length < 2 || d.busy !== null}>
          Search
        </Button>
      </form>
      {found ? (
        found.length === 0 ? (
          <p className="t-small text-soft">Nobody matches.</p>
        ) : (
          <ul className="card flex flex-col divide-y divide-line p-0">
            {found.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{p.name}</p>
                  <p className="t-small text-soft">{p.roles.length ? p.roles.map(roleName).join(", ") : "Member"}</p>
                </div>
                {have.has(p.id) ? (
                  <Badge tone="outline">Already a tester</Badge>
                ) : (
                  <Button size="sm" variant="solid" loading={d.busy === `add-${p.id}`} disabled={d.busy !== null} onClick={() => void d.go(`add-${p.id}`, () => testerSetAction(p.id, true), { saved: `${p.name} is now a tester.`, after: () => setFound(null) })}>
                    Add as tester
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}

function Assessment({ board }: { board: Board }) {
  const d = useDo();
  return (
    <section aria-labelledby="dpia-heading" className="flex flex-col gap-4" data-testid="export-assessment">
      <div>
        <h2 id="dpia-heading" className="t-heading">
          Impact assessment and unusual use
        </h2>
        <p className="t-small measure text-soft">
          No People pack can leave Rehearsal until you record the day the data protection impact assessment was signed. More named files than the number below from one person in an hour goes in the log and sends the data lead a notice.
        </p>
      </div>
      <AssessmentForm key={`a-${board.settings.updated_at ?? "none"}`} board={board} d={d} />
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}

function AssessmentForm({ board, d }: { board: Board; d: Doing }) {
  const s = board.settings;
  const [day, setDay] = useState(s.people_cleared_on ?? "");
  const [who, setWho] = useState("");
  const [per, setPer] = useState(String(s.unusual_per_hour));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="card flex flex-col gap-3 p-5">
        <h3 className="font-semibold">Impact assessment</h3>
        <p className="t-small text-soft">{s.people_cleared_on ? `Recorded as signed on ${s.people_cleared_on}.` : "Not recorded yet."}</p>
        <Input label="Day it was signed" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <Input label="Who signed it?" value={who} maxLength={300} onChange={(e) => setWho(e.target.value)} hint="A few words, kept in the log." />
        <div className="flex flex-wrap gap-3">
          <Button size="md" variant="solid" loading={d.busy === "dpia"} disabled={!day || who.trim().length < 8 || d.busy !== null || day === s.people_cleared_on} onClick={() => void d.go("dpia", () => settingsSaveAction({ people_cleared_on: day }, who), { saved: "Recorded." })} data-testid="dpia-save">
            Record it
          </Button>
          {s.people_cleared_on ? (
            <Button size="md" variant="ghost" disabled={d.busy !== null} onClick={() => void d.go("dpia-clear", () => settingsSaveAction({ people_cleared_on: null }, who || undefined), { saved: "Cleared. People packs can no longer be opened beyond Rehearsal." })}>
              Clear it
            </Button>
          ) : null}
        </div>
      </div>
      <div className="card flex flex-col gap-3 p-5">
        <h3 className="font-semibold">Unusual use</h3>
        <Input label="Named files in one hour, from one person" inputMode="numeric" value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, "").slice(0, 3))} hint="From 1 to 100. It starts at 5." />
        <div>
          <Button size="md" variant="solid" loading={d.busy === "per"} disabled={per === String(s.unusual_per_hour) || per === "" || d.busy !== null} onClick={() => void d.go("per", () => settingsSaveAction({ unusual_per_hour: Number(per) }), { saved: "Saved." })}>
            Save the number
          </Button>
        </div>
      </div>
    </div>
  );
}

function Unusual({ board, names }: { board: Board; names: Record<string, string> }) {
  return (
    <section aria-labelledby="unusual-heading" className="flex flex-col gap-3" data-testid="export-unusual">
      <h2 id="unusual-heading" className="t-heading">
        Unusual use, last 30 days
      </h2>
      {board.unusual.length === 0 ? (
        <p className="t-body text-soft">Nobody has gone over the number.</p>
      ) : (
        <ul className="card flex flex-col divide-y divide-line p-0">
          {board.unusual.map((u, i) => (
            <li key={`${u.at}-${i}`} className="p-4 t-body">
              {u.who} <span className="text-soft">({roleName(u.role)})</span> made {names[u.pack] ?? packInfo(u.pack)?.name ?? u.pack} <span className="text-soft">on {lagosWhen(u.at, true)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Changes({ board, names }: { board: Board; names: Record<string, string> }) {
  return (
    <section aria-labelledby="changes-heading" className="flex flex-col gap-3" data-testid="export-changes">
      <div>
        <h2 id="changes-heading" className="t-heading">
          Every change to a switch
        </h2>
        <p className="t-small text-soft">The latest 40, newest first. Kept for two years.</p>
      </div>
      {board.changes.length === 0 ? (
        <p className="t-body text-soft">No switch has been moved yet.</p>
      ) : (
        <ul className="card flex flex-col divide-y divide-line p-0">
          {board.changes.map((c, i) => (
            <li key={`${c.at}-${i}`} className="flex flex-col gap-1 p-4">
              <p className="t-body">
                <span className="font-semibold">{describeSwitch(c.what, names)}</span>: {c.was ?? "none"} <span aria-hidden="true">→</span> <span className="sr-only">to</span> {c.now ?? "none"}
              </p>
              <p className="t-small text-soft">
                {lagosWhen(c.at, true)}
                {c.reason ? ` · “${c.reason}”` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

