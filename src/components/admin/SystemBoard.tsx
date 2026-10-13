"use client";

import { useState } from "react";
import { createTokenAction, refreshBiAction, revokeTokenAction } from "@/app/(app)/admin/system/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatShortDate, plural } from "@/lib/dates";
import type { BiStatus, TokenRow } from "@/lib/admin/types";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

/** The copy of the data that Power BI or Looker reads, and the one-way key the sending service uses. */
export function BiPanel({ status, canRefresh }: { status: BiStatus; canRefresh: boolean }) {
  const d = useDo();
  return (
    <div className="card flex flex-col gap-4 p-5 sm:p-6">
      <p className="t-body">
        {status.refreshed_at ? (
          <>
            Last refreshed <strong>{formatShortDate(status.refreshed_at)}</strong>.
          </>
        ) : (
          <>It has never been filled. Refresh it once to create the first copy.</>
        )}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {status.views.map((v) => (
          <li key={v.name} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-2.5">
            <code className="t-small">{v.name}</code>
            <span className="t-small text-soft">{plural(v.rows, "row")}</span>
          </li>
        ))}
      </ul>
      <p className="t-small text-soft">
        A BI tool connects to the database as the role <code>{status.reader_role}</code> and reads only these views. They hold no names, contact details, free text or care notes: each person is a code that cannot be turned back into a name.
      </p>
      <Notice error={d.error} saved={d.saved} />
      {canRefresh ? (
        <div>
          <Button size="md" variant="solid" loading={d.busy === "refresh"} onClick={() => void d.go("refresh", () => refreshBiAction(), { saved: "Refreshed." })}>
            Refresh now
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function TokenPanel({ tokens }: { tokens: TokenRow[] }) {
  const d = useDo();
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const active = tokens.filter((t) => !t.revoked_at);
  const revoked = tokens.filter((t) => t.revoked_at);

  async function make() {
    if (d.busy) return;
    const ok = await d.go("create", async () => {
      const result = await createTokenAction(label);
      if (!result.ok) return result;
      setSecret(result.secret);
      return { ok: true } as const;
    });
    if (ok) setLabel("");
  }

  return (
    <div className="flex flex-col gap-4">
      {secret ? (
        <div role="status" className="card flex flex-col gap-3 border-flame p-5">
          <h3 className="font-semibold">Copy this now. It is shown only once.</h3>
          <code className="t-small block break-all rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid="new-token">
            {secret}
          </code>
          <p className="t-small text-soft">
            Put it in the sending service&rsquo;s settings as <code>WORKER_TOKEN</code>. The database keeps only a fingerprint of it, so it cannot be shown again; if it is lost, make another and revoke this one.
          </p>
          <div>
            <Button size="sm" variant="quiet" onClick={() => setSecret(null)}>
              I have copied it
            </Button>
          </div>
        </div>
      ) : null}

      {active.length === 0 ? (
        <p className="card t-body p-5 text-soft">No sending token yet. Without one, nothing is sent: no WhatsApp, no email, no text.</p>
      ) : (
        <ul className="card flex flex-col divide-y divide-line p-0">
          {active.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <span className="flex flex-col">
                <span className="font-medium">{t.label}</span>
                <span className="t-small text-soft">
                  Made {formatShortDate(t.created_at)} · {t.last_used_at ? `last seen ${formatShortDate(t.last_used_at)}` : "never used"}
                </span>
              </span>
              <Button
                size="sm"
                variant="quiet"
                loading={d.busy === t.id}
                disabled={d.busy !== null}
                onClick={() => {
                  if (window.confirm(`Revoke “${t.label}”? Whatever uses it will stop sending until it has a new token.`)) void d.go(t.id, () => revokeTokenAction(t.id));
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      {revoked.length > 0 ? (
        <details>
          <summary className="t-small cursor-pointer text-soft">{revoked.length} revoked</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {revoked.map((t) => (
              <li key={t.id} className="t-small flex items-center gap-2 text-soft">
                <Badge tone="outline">Revoked</Badge>
                {t.label}, {t.revoked_at ? formatShortDate(t.revoked_at) : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <form
        noValidate
        aria-label="Make a sending token"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <div className="flex-1">
          <Input label="Make a new token" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Vercel production" />
        </div>
        <Button type="submit" size="md" variant="quiet" loading={d.busy === "create"} disabled={label.trim().length < 2}>
          Make the token
        </Button>
      </form>
      <Notice error={d.error} />
    </div>
  );
}
