"use client";

import { useState } from "react";
import { saveGroupAction, type GroupInput } from "@/app/(app)/god/leader-desk/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { DeskChoices } from "@/lib/god/desk-server";
import { KINDS, LAGOS_ZONES, SLOTS, ZONES } from "@/lib/god/desk";

const SELECT = "h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base";

function Pick({ id, label, value, onChange, children, optional }: { id: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-[0.95rem] font-medium">
        <span>{label}</span>
        {optional ? <span className="t-small font-normal text-soft">Optional</span> : null}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>
        {children}
      </select>
    </div>
  );
}

/**
 * Makes a draft group, or changes one. A draft is not a tribe: it has no leader and no seats, and nobody is told about it. The database checks every field and
 * says in words what is wrong.
 */
export function DeskGroupForm({
  choices,
  initial,
  groupId = null,
  submitLabel = "Make the draft",
  onDone,
}: {
  choices: DeskChoices;
  initial?: Partial<Omit<GroupInput, "id">>;
  groupId?: string | null;
  submitLabel?: string;
  onDone?: () => void;
}) {
  const d = useDo();
  const [name, setName] = useState(initial?.name ?? "");
  const [track, setTrack] = useState(initial?.track ?? "");
  const [community, setCommunity] = useState(initial?.community ?? "");
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [slot, setSlot] = useState(initial?.slot ?? "");
  const [mode, setMode] = useState<"online" | "in_person">(initial?.mode ?? "online");
  const [zone, setZone] = useState(initial?.zone ?? "");
  const [type, setType] = useState<"mixed" | "women" | "men">(initial?.type ?? "mixed");
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 8));
  const [note, setNote] = useState(initial?.note ?? "");
  const goals = choices.goals.filter((g) => community !== "" && g.communityId === community);

  const input = (): GroupInput => ({
    id: groupId,
    name,
    track,
    community: community === "" ? null : community,
    goal: goal === "" ? null : goal,
    slot,
    mode,
    zone: mode === "in_person" && zone !== "" ? zone : null,
    type,
    capacity: Number(capacity),
    note,
  });

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="desk-group-form"
      onSubmit={(e) => {
        e.preventDefault();
        void d.go("save", () => saveGroupAction(input()), {
          saved: groupId ? "Saved." : "The draft is made.",
          after: () => {
            if (!groupId) {
              setName("");
              setNote("");
            }
            onDone?.();
          },
        });
      }}
    >
      <Input label="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} hint="3 to 60 characters. Only you see it." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Pick id={`gf-track-${groupId ?? "new"}`} label="Life stage" value={track} onChange={setTrack}>
          <option value="">Choose…</option>
          {choices.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Pick>
        <Pick id={`gf-slot-${groupId ?? "new"}`} label="When it meets" value={slot} onChange={setSlot}>
          <option value="">Choose…</option>
          {Object.entries(SLOTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Pick>
        <Pick id={`gf-mode-${groupId ?? "new"}`} label="How it meets" value={mode} onChange={(v) => setMode(v === "in_person" ? "in_person" : "online")}>
          <option value="online">Online</option>
          <option value="in_person">In person</option>
        </Pick>
        {mode === "in_person" ? (
          <Pick id={`gf-zone-${groupId ?? "new"}`} label="Where, in Lagos" value={zone} onChange={setZone}>
            <option value="">Choose…</option>
            {LAGOS_ZONES.map((z) => (
              <option key={z} value={z}>
                {ZONES[z]}
              </option>
            ))}
          </Pick>
        ) : null}
        <Pick id={`gf-type-${groupId ?? "new"}`} label="Who it is for" value={type} onChange={(v) => setType(v === "women" || v === "men" ? v : "mixed")}>
          <option value="mixed">{KINDS.mixed}</option>
          <option value="women">{KINDS.women}</option>
          <option value="men">{KINDS.men}</option>
        </Pick>
        <Input label="Most people" type="number" inputMode="numeric" min={4} max={12} value={capacity} onChange={(e) => setCapacity(e.target.value)} hint="4 to 12." />
        <Pick id={`gf-community-${groupId ?? "new"}`} label="Community" value={community} onChange={(v) => { setCommunity(v); setGoal(""); }} optional>
          <option value="">Not chosen</option>
          {choices.communities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Pick>
        <Pick id={`gf-goal-${groupId ?? "new"}`} label="Goal" value={goal} onChange={setGoal} optional>
          <option value="">{community === "" ? "Choose a community first" : "Not chosen"}</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </Pick>
      </div>
      <Input label="Note to yourself" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} optional />
      <Notice error={d.error} saved={d.saved} />
      <div>
        <Button type="submit" size="md" loading={d.busy === "save"}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
