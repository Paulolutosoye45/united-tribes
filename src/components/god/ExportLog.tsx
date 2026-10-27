"use client";

import { useState } from "react";
import { logAction } from "@/app/(app)/god/exports/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { PURPOSES } from "@/lib/exports/purposes";
import { FORMAT_NAMES } from "@/lib/exports/registry";
import type { LogLine } from "@/lib/exports/types";
import { STATUS_WORDS, lagosWhen, roleName } from "@/lib/exports/wording";

/**
 * Who made which file, when, as which role, for what reason and how many rows. Never what was in it. Kept two years, then removed
 * by the daily clean-up.
 */
export function ExportLog({ initial, packs }: { initial: LogLine[]; packs: { id: string; name: string }[] }) {
  const d = useDo();
  const [lines, setLines] = useState(initial);
  const [pack, setPack] = useState("");
  const [more, setMore] = useState(initial.length >= 40);

  async function load(reset: boolean, which = pack) {
    const before = reset || lines.length === 0 ? null : lines[lines.length - 1].at;
    await d.go("log", async () => {
      const r = await logAction(before, which || null);
      if (!r.ok) return r;
      setLines(reset ? r.lines : [...lines, ...r.lines]);
      setMore(r.lines.length >= 40);
      return { ok: true as const };
    });
  }

  return (
    <section aria-labelledby="log-heading" className="flex flex-col gap-3" data-testid="export-log">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="log-heading" className="t-heading">
            Files made
          </h2>
          <p className="t-small text-soft">Who, when, which pack, and why. Never what was in the file.</p>
        </div>
        <div className="w-64 max-w-full">
          <Select
            label="Pack"
            value={pack}
            onChange={(e) => {
              setPack(e.target.value);
              void load(true, e.target.value);
            }}
          >
            <option value="">All packs</option>
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <Notice error={d.error} />
      {lines.length === 0 ? (
        <p className="t-body text-soft">No file has been made.</p>
      ) : (
        <ul className="card flex flex-col divide-y divide-line p-0">
          {lines.map((l) => (
            <li key={l.id} className="flex flex-col gap-1 p-4" data-testid="log-line">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{l.name}</span>
                <Badge tone="outline">{FORMAT_NAMES[l.format]}</Badge>
                {l.lane === "people" ? <Badge tone="neutral">People</Badge> : null}
                {l.rehearsal ? <Badge tone="gold">Rehearsal</Badge> : null}
                {l.flagged ? <Badge tone="flame">Unusual use</Badge> : null}
              </div>
              <p className="t-small text-soft">
                {l.who} ({roleName(l.role)}) · {lagosWhen(l.at, true)}
                {l.purpose ? ` · ${PURPOSES[l.purpose]}` : ""}
                {l.status === "delivered" && l.rows !== null ? ` · ${l.rows.toLocaleString("en")} rows` : ` · ${STATUS_WORDS[l.status] ?? l.status}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      {more ? (
        <div>
          <Button size="md" variant="quiet" loading={d.busy === "log"} disabled={d.busy !== null} onClick={() => void load(false)}>
            Show more
          </Button>
        </div>
      ) : null}
    </section>
  );
}
