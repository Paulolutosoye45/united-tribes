"use client";

import { useState } from "react";
import { feedCreateAction, feedRenewAction, feedRevokeAction, type FeedMade } from "@/app/(app)/exports/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { FEED_SCHEMA } from "@/lib/exports/feeds";
import { feedUrl } from "@/lib/exports/links";
import { FEED_TABLES, type FeedLink, type FeedTable } from "@/lib/exports/types";
import { lagosWhen } from "@/lib/exports/wording";

/**
 * Standing links for reporting tools. A tool that fetches a web address on a schedule reads one coded table, read only, for 90 days.
 * The address is shown once and cannot be shown again; renew it before it ends, or revoke it and it stops at once.
 */
export function FeedsPanel({ links, open }: { links: FeedLink[]; open: boolean }) {
  const d = useDo();
  const [table, setTable] = useState<FeedTable>("kpi_daily");
  const [label, setLabel] = useState("");
  const [made, setMade] = useState<(FeedMade & { ok: true }) | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    const ok = await d.go("create", async () => {
      const r = await feedCreateAction(table, label);
      if (r.ok) setMade(r);
      return r.ok ? { ok: true as const } : r;
    });
    if (ok) {
      setLabel("");
      setCopied(false);
    }
  }

  const address = made ? feedUrl(typeof window === "undefined" ? "" : window.location.origin, made.token, made.table) : "";

  return (
    <div className="flex flex-col gap-8" data-testid="feeds-panel">
      {open ? (
        <section aria-labelledby="new-feed" className="card flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h2 id="new-feed" className="t-heading">
              Make a standing link
            </h2>
            <p className="t-small text-soft">One coded table, no names, read only. The address is shown once, so paste it into the reporting tool straight away.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Table" value={table} onChange={(e) => setTable(e.target.value as FeedTable)}>
              {FEED_TABLES.map((t) => (
                <option key={t} value={t}>
                  {FEED_SCHEMA[t].title}
                </option>
              ))}
            </Select>
            <Input label="What is it for?" hint="For example, the board dashboard." value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <p className="t-small text-soft">{FEED_SCHEMA[table].about}</p>
          <div>
            <Button size="md" variant="solid" loading={d.busy === "create"} disabled={label.trim().length < 2 || d.busy !== null} onClick={() => void create()}>
              Make the link
            </Button>
          </div>
          {made ? (
            <div role="status" className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-gold/20 p-4" data-testid="feed-made">
              <p className="font-semibold">Copy this address now. It cannot be shown again.</p>
              <code className="t-small break-all rounded-md bg-raised p-3">{address}</code>
              <div>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    void navigator.clipboard?.writeText(address).then(
                      () => setCopied(true),
                      () => setCopied(false),
                    );
                  }}
                >
                  {copied ? "Copied" : "Copy the address"}
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="card t-body p-6 text-soft" data-testid="feeds-closed">
          Standing links are not open yet. You can still make the Open Data Pack from Exports to try the tables.
        </p>
      )}
      <Notice error={d.error} saved={d.saved} />
      <section aria-labelledby="live-feeds" className="flex flex-col gap-3">
        <h2 id="live-feeds" className="t-heading">
          Links that exist
        </h2>
        {links.length === 0 ? (
          <p className="t-body text-soft">No standing link has been made.</p>
        ) : (
          <ul className="card flex flex-col divide-y divide-line p-0">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="feed-link">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{l.label}</span>
                    <Badge tone="outline">{FEED_SCHEMA[l.table].title}</Badge>
                    <Badge tone={l.live ? "gold" : "neutral"}>{l.revoked_at ? "Revoked" : l.live ? "Live" : "Ended"}</Badge>
                  </div>
                  <p className="t-small text-soft">
                    Made by {l.by} · {l.revoked_at ? "revoked" : l.live ? "ends" : "ended"} {lagosWhen(l.revoked_at ?? l.expires_at, true)} · read {l.reads.toLocaleString("en")} {l.reads === 1 ? "time" : "times"}
                    {l.last_read_at ? `, last ${lagosWhen(l.last_read_at, true)}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!l.revoked_at && open ? (
                    <Button size="sm" variant="quiet" disabled={d.busy !== null} loading={d.busy === `renew-${l.id}`} onClick={() => void d.go(`renew-${l.id}`, async () => { const r = await feedRenewAction(l.id); return r.ok ? { ok: true as const } : r; }, { saved: "Renewed for 90 days." })}>
                      Renew
                    </Button>
                  ) : null}
                  {!l.revoked_at ? (
                    <Button size="sm" variant="ghost" disabled={d.busy !== null} loading={d.busy === `revoke-${l.id}`} onClick={() => void d.go(`revoke-${l.id}`, () => feedRevokeAction(l.id), { saved: "Revoked. The address stops working at once." })}>
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
