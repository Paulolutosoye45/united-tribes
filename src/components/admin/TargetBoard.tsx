"use client";

import { useState } from "react";
import { resetTargetAction, setTargetAction } from "@/app/(app)/admin/targets/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatShortDate } from "@/lib/dates";
import type { TargetRow } from "@/lib/admin/types";
import { TARGET_GROUPS, TARGET_INFO, targetChanged, targetFromInput, targetRange, targetText, targetToInput, targetUnit } from "@/lib/admin/wording";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

export function TargetBoard({ targets, canEdit }: { targets: TargetRow[]; canEdit: boolean }) {
  const byKey = new Map(targets.map((t) => [t.key, t]));
  return (
    <div className="flex flex-col gap-10">
      {TARGET_GROUPS.map((group) => {
        const rows = group.keys.map((k) => byKey.get(k)).filter((r): r is TargetRow => Boolean(r));
        if (rows.length === 0) return null;
        return (
          <section key={group.title} aria-label={group.title} className="flex flex-col gap-4">
            <h2 className="t-heading">{group.title}</h2>
            <ul className="card flex flex-col divide-y divide-line p-0">
              {rows.map((r) => (
                <TargetRowView key={`${r.key}:${r.value}`} row={r} canEdit={canEdit} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TargetRowView({ row, canEdit }: { row: TargetRow; canEdit: boolean }) {
  const d = useDo();
  const info = TARGET_INFO[row.key];
  const [value, setValue] = useState(targetToInput(row.key, row.value));
  const [problem, setProblem] = useState<string | null>(null);
  const typed = targetFromInput(row.key, value);
  const changed = targetChanged(row.key, value, row.value);
  const id = `target-${row.key}`;

  /** The database also checks the range, but its numbers are the stored ones (0.3, not 30%): say it the way the box does. */
  function submit() {
    if (typed === null || !changed) return;
    if (typed < row.min - 1e-9 || typed > row.max + 1e-9) {
      return setProblem(`Choose a number from ${targetRange(row.key, row.min, row.max)}.`);
    }
    if (row.whole && !Number.isInteger(typed)) return setProblem("Use a whole number.");
    setProblem(null);
    void d.go("save", () => setTargetAction(row.key, typed), { saved: "Saved." });
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <label htmlFor={id} className="flex flex-wrap items-center gap-2 font-semibold">
            {info?.label ?? row.key}
            {row.custom ? <Badge tone="gold">Changed</Badge> : null}
          </label>
          <p className="t-small text-soft">{info?.help ?? ""}</p>
          <p className="t-small text-soft">
            Usual setting {targetText(row.key, row.default)}. Allowed from {targetRange(row.key, row.min, row.max)}.
            {row.custom && row.updated_at ? ` Changed by ${row.updated_by ?? "the office"}, ${formatShortDate(row.updated_at)}.` : ""}
          </p>
        </div>
        <form
          noValidate
          aria-label={info?.label ?? row.key}
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            id={id}
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setProblem(null);
            }}
            disabled={!canEdit}
            className="h-12 w-24 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-right text-base focus:border-ink focus:outline-none"
          />
          <span className="t-small w-16 text-soft">{targetUnit(row.key)}</span>
          {canEdit ? (
            <Button type="submit" size="sm" loading={d.busy === "save"} disabled={!changed}>
              Save
            </Button>
          ) : null}
        </form>
      </div>
      {canEdit && row.custom ? (
        <div>
          <Button size="sm" variant="ghost" loading={d.busy === "reset"} disabled={d.busy !== null} onClick={() => void d.go("reset", () => resetTargetAction(row.key), { saved: "Back to the usual setting." })}>
            Go back to {targetText(row.key, row.default)}
          </Button>
        </div>
      ) : null}
      <Notice error={problem ?? d.error} saved={problem ? null : d.saved} />
    </li>
  );
}
