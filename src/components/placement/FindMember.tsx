"use client";

import Link from "next/link";
import { useState } from "react";
import { findMemberAction } from "@/app/(app)/admin/tribes/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { FindRow } from "@/lib/placement/types";

/**
 * Finds a member by name, e-mail or phone number. A result opens the person's own page (`hrefBase`/id) or hands the person back to the page
 * that asked (`onPick`). A leader is shown but cannot be chosen: a leader does not join a tribe as a member.
 */
export function FindMember({ hrefBase, onPick, pickLabel = "Choose" }: { hrefBase?: string; onPick?: (row: FindRow) => void; pickLabel?: string }) {
  const d = useDo();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<FindRow[] | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    await d.go("find", async () => {
      const r = await findMemberAction(query);
      if (r.ok) setRows(r.rows);
      return r.ok ? { ok: true as const } : r;
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="find-member">
      <form onSubmit={(e) => void search(e)} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <Input label="Find a member" hint="Name, e-mail or phone number" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={80} data-testid="find-member-query" />
        </div>
        <Button type="submit" size="md" variant="solid" loading={d.busy === "find"} disabled={query.trim().length < 2} data-testid="find-member-go">
          Find
        </Button>
      </form>
      <Notice error={d.error} />
      {rows !== null && rows.length === 0 ? (
        <p className="t-body text-soft" data-testid="find-member-none">
          Nobody matches that. Try part of the name, the e-mail address, or the last digits of the number (at least seven).
        </p>
      ) : null}
      {rows !== null && rows.length > 0 ? (
        <ul className="card divide-y divide-line overflow-hidden" data-testid="find-member-results">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.name}</p>
                <p className="t-small truncate text-soft">{r.email}</p>
                <p className="t-small mt-1 flex flex-wrap items-center gap-2">
                  {r.tribe ? <Badge tone="gold">In {r.tribe}</Badge> : <Badge>No tribe yet</Badge>}
                  {r.hasForm ? <span className="text-soft">Finished Find my tribe</span> : <span className="text-soft">No form yet</span>}
                  {r.leads ? <span className="text-danger">Leads or supports a tribe, so cannot be placed</span> : null}
                </p>
              </div>
              {r.leads ? null : onPick ? (
                <Button size="md" variant="quiet" onClick={() => onPick(r)} data-testid={`find-member-pick-${r.id}`}>
                  {pickLabel}
                </Button>
              ) : hrefBase ? (
                <Link href={`${hrefBase}/${r.id}`} className="font-semibold underline underline-offset-4" data-testid={`find-member-open-${r.id}`}>
                  {r.tribe ? "Open · move" : "Open · place"}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
