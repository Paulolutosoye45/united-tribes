"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { recordPracticeAction } from "@/app/(app)/review/academy/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Segmented } from "@/components/ui/Choice";
import { Select, Textarea } from "@/components/ui/Input";
import { CARD_STATUS, PRACTICE_FORMATS, SESSION_KINDS } from "@/lib/academy/options";
import type { CohortRow, SessionKind } from "@/lib/academy/types";
import { cn } from "@/lib/cn";

type Filter = "all" | "practice" | "certified";

const WORKSHOP_WORDS: Record<string, string> = {
  attended: "Attended",
  booked: "Booked",
  missed: "Missed",
  to_mark: "Register not marked",
};

export function CohortList({ rows }: { rows: CohortRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const waiting = rows.filter((r) => r.state.modules_done && !r.state.practice && !r.state.certified);
  const shown = rows.filter((r) => (filter === "certified" ? r.state.certified : filter === "practice" ? waiting.includes(r) : true));

  return (
    <section aria-labelledby="cohort-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cohort-heading" className="t-heading">
          Leaders in training
        </h2>
        <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
          <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
            All {rows.length}
          </Chip>
          <Chip selected={filter === "practice"} onClick={() => setFilter("practice")}>
            Ready for a practice session {waiting.length}
          </Chip>
          <Chip selected={filter === "certified"} onClick={() => setFilter("certified")}>
            Certified {rows.filter((r) => r.state.certified).length}
          </Chip>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="card t-body p-6 text-soft">
          {rows.length === 0 ? "No one is in training yet. Leaders appear here as soon as the pastor approves their application." : "No one matches this filter."}
        </p>
      ) : (
        <ul className="stagger flex flex-col gap-3">
          {shown.map((r, i) => (
            <li key={r.person_id} style={{ ["--i" as string]: Math.min(i, 8) }}>
              <Row row={r} open={openId === r.person_id} onToggle={() => setOpenId(openId === r.person_id ? null : r.person_id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ row, open, onToggle }: { row: CohortRow; open: boolean; onToggle: () => void }) {
  const s = row.state;
  const pct = s.modules_total > 0 ? (s.modules_passed / s.modules_total) * 100 : 0;
  return (
    <article className="card flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">{row.name}</h3>
          <p className="t-small text-soft">{row.role === "leader" ? "Circle leader" : "Assistant leader"}</p>
        </div>
        {s.certified ? <Badge tone="gold">Certified</Badge> : <Badge tone="outline">In training</Badge>}
      </div>

      <div className="flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Modules passed"
          aria-valuemin={0}
          aria-valuemax={s.modules_total}
          aria-valuenow={s.modules_passed}
        >
          <span className="block h-full rounded-full bg-flame transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
        <span className="t-small shrink-0 text-soft">
          {s.modules_passed} of {s.modules_total} modules
        </span>
      </div>

      <ul className="flex flex-wrap gap-2" aria-label="Where they stand">
        <Pill ok={s.declaration} label={s.declaration ? "Declaration signed" : "Declaration not signed"} />
        <Pill ok={row.practice?.ready === true} warn={row.practice?.ready === false} label={row.practice ? (row.practice.ready ? "Practice ready" : "Practice: not yet") : "Practice not marked"} />
        {s.card_required ? (
          <Pill ok={row.card?.status === "approved"} warn={row.card?.status === "changes_requested"} label={row.card ? `Card: ${CARD_STATUS[row.card.status]?.label ?? row.card.status}` : "No card yet"} />
        ) : null}
        {(Object.keys(SESSION_KINDS) as SessionKind[]).map((k) => (
          <Pill key={k} ok={row.workshops[k] === "attended"} label={`${SESSION_KINDS[k].short}: ${row.workshops[k] ? WORKSHOP_WORDS[row.workshops[k]!] : "not booked"}`} />
        ))}
      </ul>

      {row.practice?.note ? <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3">Your note: {row.practice.note}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant={open ? "quiet" : "solid"} size="sm" aria-expanded={open} onClick={onToggle}>
          {open ? "Close" : row.practice ? "Update the practice session" : "Mark the practice session"}
        </Button>
        {row.card ? (
          <a href={`/review/cards/${row.card.id}`} className="t-small font-semibold underline underline-offset-4">
            Open the Circle Card
          </a>
        ) : null}
      </div>

      {open ? <PracticeForm row={row} onDone={onToggle} /> : null}
    </article>
  );
}

function Pill({ ok, warn = false, label }: { ok: boolean; warn?: boolean; label: string }) {
  return (
    <li
      className={cn(
        "t-small inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium",
        ok ? "bg-gold/30 text-ink" : warn ? "bg-flame/15 text-ink" : "bg-surface text-soft",
      )}
    >
      <span aria-hidden="true">{ok ? "✓" : warn ? "!" : "·"}</span>
      {label}
    </li>
  );
}

function PracticeForm({ row, onDone }: { row: CohortRow; onDone: () => void }) {
  const router = useRouter();
  const [format, setFormat] = useState<string>(row.practice?.format ?? "co_lead");
  const [ready, setReady] = useState<boolean | null>(row.practice?.ready ?? null);
  const [note, setNote] = useState(row.practice?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsNote = ready === false;
  const ok = ready !== null && (!needsNote || note.trim().length >= 3);

  async function save() {
    if (ready === null) return;
    setBusy(true);
    setError(null);
    const result = await recordPracticeAction(row.person_id, format, ready, note);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
    onDone();
  }

  return (
    <form
      noValidate
      className="step-forward flex flex-col gap-4 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) void save();
      }}
    >
      <Select label="How was it done" name="format" value={format} onChange={(e) => setFormat(e.target.value)}>
        {PRACTICE_FORMATS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </Select>
      <div className="flex flex-col gap-2">
        <p className="text-[0.95rem] font-medium">Your call</p>
        <Segmented
          name={`ready-${row.person_id}`}
          label="Ready or not yet"
          value={ready === null ? null : ready ? "ready" : "not-yet"}
          options={[
            { value: "ready", label: "Ready" },
            { value: "not-yet", label: "Not yet" },
          ]}
          onChange={(v) => setReady(v === "ready")}
        />
      </div>
      <Textarea
        label={needsNote ? "What to work on" : "A word of encouragement"}
        name="note"
        value={note}
        rows={3}
        maxLength={600}
        optional={!needsNote}
        hint="The leader reads this note. Keep it kind and specific."
        onChange={(e) => setNote(e.target.value)}
      />
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="md" loading={busy} disabled={!ok}>
          Save
        </Button>
      </div>
    </form>
  );
}
