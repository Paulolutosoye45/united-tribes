"use client";

import { useState } from "react";
import { packPreviewAction, packSetAction } from "@/app/(app)/god/exports/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FORMAT_NAMES, LANE_NAMES, packInfo } from "@/lib/exports/registry";
import type { Board, BoardPack, Position } from "@/lib/exports/types";
import { POSITION_ORDER, POSITION_WORDS, dayCount, lagosWhen, roleName } from "@/lib/exports/wording";

/** The fourteen packs, each with its own position. Opening a pack beyond the testers shows how many people it would reach before it is saved. */
export function ExportPacks({ board }: { board: Board }) {
  const signed = board.settings.people_cleared_on !== null;
  const people = board.packs.filter((p) => p.lane === "people");
  const insight = board.packs.filter((p) => p.lane === "insight");
  return (
    <section aria-labelledby="packs-heading" className="flex flex-col gap-5" data-testid="export-packs">
      <div>
        <h2 id="packs-heading" className="t-heading">
          The packs
        </h2>
        <p className="t-small measure text-soft">
          Each pack has its own switch. Everything starts Off. Rehearsal is for the named testers only. Limited opens a pack to the roles, communities or tribes you choose. On opens it to everyone whose role includes it.
        </p>
      </div>
      <Group title="People packs" line={LANE_NAMES.people.line} packs={people} board={board} signed={signed} />
      <Group title="Insight packs" line={LANE_NAMES.insight.line} packs={insight} board={board} signed={signed} />
    </section>
  );
}

function Group({ title, line, packs, board, signed }: { title: string; line: string; packs: BoardPack[]; board: Board; signed: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="t-small text-soft">{line}</p>
      </div>
      <div className="flex flex-col gap-3">
        {packs.map((p) => (
          <PackCard key={`${p.id}:${p.position}:${p.changed_at}`} pack={p} board={board} signed={signed} />
        ))}
      </div>
    </div>
  );
}

type Doing = ReturnType<typeof useDo>;

/**
 * One pack. The notice lives out here, and the draft (the position being chosen, who it is open to, the reason) lives in a part that starts
 * afresh whenever the saved position changes, so a saved change shows its confirmation and the next draft starts from what was saved.
 */
function PackCard({ pack, board, signed }: { pack: BoardPack; board: Board; signed: boolean }) {
  const d = useDo();
  const info = packInfo(pack.id);
  const [open, setOpen] = useState(false);
  return (
    <article className="card flex flex-col gap-4 p-5" data-testid={`pack-${pack.id}`} aria-labelledby={`pack-${pack.id}-name`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 id={`pack-${pack.id}-name`} className="font-semibold">
              {pack.name}
            </h4>
            <Badge tone={pack.position === "off" ? "outline" : pack.position === "on" ? "charcoal" : "gold"}>{POSITION_WORDS[pack.position].name}</Badge>
            {pack.in_force !== pack.position ? <Badge tone="flame">Held {POSITION_WORDS[pack.in_force].name} by a stop</Badge> : null}
            {!pack.released ? <Badge tone="outline">Second release</Badge> : null}
          </div>
          <p className="t-small text-soft">{info?.line}</p>
          <p className="t-small text-soft">
            For {pack.roles.map(roleName).join(", ")} · {pack.formats.map((f) => FORMAT_NAMES[f]).join(", ")}
          </p>
        </div>
        <p className="t-small text-right text-soft">
          {dayCount(pack.made_30d, "file")} in 30 days
          {Object.keys(pack.by_role).length > 0 ? <span className="block">{Object.entries(pack.by_role).map(([r, n]) => `${roleName(r)} ${n}`).join(" · ")}</span> : null}
        </p>
      </header>

      <PackEditor key={`${pack.position}:${pack.changed_at}`} pack={pack} board={board} signed={signed} d={d} />
      <Notice error={d.error} saved={d.saved} />

      <button type="button" className="press t-small w-fit font-medium text-soft hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide the details" : "Show the details"}
      </button>
      {open ? (
        <dl className="t-small grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Fact k="In force now" v={POSITION_WORDS[pack.in_force].name} />
          <Fact k="First tried in Rehearsal" v={pack.rehearsed_at ? lagosWhen(pack.rehearsed_at, true) : "Not yet"} />
          <Fact k="Last changed" v={pack.changed_at ? lagosWhen(pack.changed_at, true) : "Never"} />
          <Fact k="Reason given" v={pack.reason ?? "None"} />
          {pack.position === "limited" ? <Fact k="Open to" v={`${pack.limited_roles.length} roles, ${pack.limited_communities.length} communities, ${pack.limited_tribes.length} tribes`} /> : null}
        </dl>
      ) : null}
    </article>
  );
}

function PackEditor({ pack, board, signed, d }: { pack: BoardPack; board: Board; signed: boolean; d: Doing }) {
  const [position, setPosition] = useState<Position>(pack.position);
  const [roles, setRoles] = useState<string[]>(pack.limited_roles);
  const [communities, setCommunities] = useState<string[]>(pack.limited_communities);
  const [tribes, setTribes] = useState<string[]>(pack.limited_tribes);
  const [reason, setReason] = useState("");
  const [find, setFind] = useState("");
  const [reach, setReach] = useState<number | null>(null);

  const changed = position !== pack.position || (position === "limited" && (differs(roles, pack.limited_roles) || differs(communities, pack.limited_communities) || differs(tribes, pack.limited_tribes)));
  const wide = position === "limited" || position === "on";
  const byTribe = pack.scope === "tribe" || pack.scope === "tribes";
  const byCommunity = byTribe || pack.scope === "community";
  const rehearsed = pack.rehearsed_at !== null || pack.position === "rehearsal";
  const gate = pack.lane === "people" && wide ? (!rehearsed ? "Try this pack in Rehearsal first, then come back." : !signed ? "Record that the impact assessment is signed (below) before a People pack leaves Rehearsal." : null) : null;
  const limitedEmpty = position === "limited" && roles.length === 0 && communities.length === 0 && tribes.length === 0;
  const reasonOk = !wide || reason.trim().length >= 8;
  const needsPreview = wide;
  const canSave = changed && !gate && !limitedEmpty && reasonOk && (!needsPreview || reach !== null);

  const input = () => ({ pack: pack.id, position, roles: position === "limited" ? roles : [], communities: position === "limited" ? communities : [], tribes: position === "limited" ? tribes : [], reason });
  const edit = (fn: () => void) => {
    fn();
    setReach(null);
  };
  const shownTribes = board.tribes.filter((t) => !find.trim() || `${t.name} ${t.community ?? ""}`.toLowerCase().includes(find.trim().toLowerCase()));

  return (
    <>
      <div role="group" aria-label={`${pack.name} position`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {POSITION_ORDER.map((p) => {
          const blocked = !pack.released && p !== "off";
          return (
            <button
              key={p}
              type="button"
              aria-pressed={position === p}
              disabled={blocked || d.busy !== null}
              onClick={() => edit(() => setPosition(p))}
              data-testid={`pack-${pack.id}-${p}`}
              className={`press flex min-h-12 flex-col items-start rounded-[var(--radius-control)] border-[1.5px] px-3 py-2 text-left disabled:opacity-50 ${position === p ? "border-ink bg-surface-strong" : "border-line hover:border-soft"}`}
            >
              <span className="font-semibold">
                {POSITION_WORDS[p].name}
                {pack.position === p ? <span className="t-small font-normal text-soft"> · now</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className="t-small text-soft">{pack.released ? POSITION_WORDS[position].line : "This pack arrives in a later release and can only be Off for now."}</p>

      {position === "limited" ? (
        <div className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-line p-4" data-testid={`pack-${pack.id}-limits`}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[0.95rem] font-medium">Roles</legend>
            <div className="flex flex-wrap gap-2">
              {pack.roles.map((r) => (
                <Check key={r} label={roleName(r)} on={roles.includes(r)} onChange={(on) => edit(() => setRoles(on ? [...roles, r] : roles.filter((x) => x !== r)))} />
              ))}
            </div>
          </fieldset>
          {byCommunity ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[0.95rem] font-medium">Communities</legend>
              <div className="flex flex-wrap gap-2">
                {board.communities.map((c) => (
                  <Check key={c.id} label={c.name} on={communities.includes(c.id)} onChange={(on) => edit(() => setCommunities(on ? [...communities, c.id] : communities.filter((x) => x !== c.id)))} />
                ))}
              </div>
            </fieldset>
          ) : null}
          {byTribe ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[0.95rem] font-medium">Tribes {tribes.length > 0 ? <span className="t-small font-normal text-soft">({tribes.length} chosen)</span> : null}</legend>
              <Input label="Find a tribe" value={find} onChange={(e) => setFind(e.target.value)} className="h-11" />
              <div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
                {shownTribes.slice(0, 80).map((t) => (
                  <label key={t.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-surface">
                    <input type="checkbox" checked={tribes.includes(t.id)} onChange={(e) => edit(() => setTribes(e.target.checked ? [...tribes, t.id] : tribes.filter((x) => x !== t.id)))} />
                    <span className="t-small">
                      {t.name}
                      {t.community ? <span className="text-soft"> · {t.community}</span> : null}
                    </span>
                  </label>
                ))}
                {shownTribes.length === 0 ? <p className="t-small text-soft">No tribe matches.</p> : null}
              </div>
            </fieldset>
          ) : null}
          {limitedEmpty ? <p className="t-small text-soft">Choose at least one role, community or tribe.</p> : null}
        </div>
      ) : null}

      {wide ? (
        <Input label="Why open it? (a few words, kept in the log)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} hint="At least 8 characters." />
      ) : null}
      {gate ? (
        <p role="note" className="t-small rounded-[var(--radius-control)] bg-gold/25 px-4 py-3" data-testid={`pack-${pack.id}-gate`}>
          {gate}
        </p>
      ) : null}

      {changed ? (
        <div className="flex flex-wrap items-center gap-3">
          {needsPreview ? (
            <Button
              size="md"
              variant="quiet"
              loading={d.busy === "preview"}
              disabled={d.busy !== null || !!gate || limitedEmpty}
              onClick={() => void d.go("preview", async () => { const r = await packPreviewAction(input()); if (r.ok) setReach(r.people); return r.ok ? { ok: true as const } : r; })}
            >
              Check who this reaches
            </Button>
          ) : null}
          {reach !== null ? (
            <span role="status" className="t-small font-semibold" data-testid={`pack-${pack.id}-reach`}>
              Reaches {dayCount(reach, "person", "people")}
            </span>
          ) : null}
          <Button size="md" variant="solid" loading={d.busy === "save"} disabled={!canSave || d.busy !== null} onClick={() => void d.go("save", () => packSetAction(input()), { saved: `${pack.name} is ${POSITION_WORDS[position].name}.` })} data-testid={`pack-${pack.id}-save`}>
            Save {POSITION_WORDS[position].name}
          </Button>
          <Button size="md" variant="ghost" disabled={d.busy !== null} onClick={() => { setPosition(pack.position); setRoles(pack.limited_roles); setCommunities(pack.limited_communities); setTribes(pack.limited_tribes); setReach(null); setReason(""); }}>
            Cancel
          </Button>
        </div>
      ) : null}
    </>
  );
}

const differs = (a: string[], b: string[]) => a.length !== b.length || a.some((x) => !b.includes(x));

function Check({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.92rem] font-medium ${on ? "border-ink bg-surface-strong" : "border-line hover:border-soft"}`}>
      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-40 shrink-0 font-semibold">{k}</dt>
      <dd className="text-soft">{v}</dd>
    </div>
  );
}
