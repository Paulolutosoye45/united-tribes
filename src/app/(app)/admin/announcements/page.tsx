import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { StatusBadge } from "@/components/outreach/StatusBadge";
import { ANNOUNCE_ROLES, ANNOUNCE_VIEW_ROLES, APPROVE_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { buttonClasses } from "@/components/ui/Button";
import { loadApprovals, loadBroadcasts } from "@/lib/outreach/server";
import type { BroadcastRow } from "@/lib/outreach/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Announcements" };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" }) : "";

function Row({ b }: { b: BroadcastRow }) {
  const total = b.snapshot_count ?? b.recipient_count ?? 0;
  const done = total > 0 ? Math.min(100, Math.round((b.sent / total) * 100)) : 0;
  return (
    <li>
      <Link href={`/admin/announcements/${b.id}`} className="card press flex flex-col gap-2 p-4 hover:bg-surface" data-testid="announcement-row">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{b.title}</span>
          <StatusBadge status={b.status} />
        </span>
        <span className="t-small text-soft">
          {b.audience_label}
          {total ? ` · ${total.toLocaleString("en")} people` : ""}
          {b.created_by ? ` · ${b.created_by_me ? "you" : b.created_by}` : ""}
          {b.scheduled_for && ["scheduled", "awaiting_approval"].includes(b.status) ? ` · goes ${when(b.scheduled_for)}` : ""}
          {b.finished_at ? ` · finished ${when(b.finished_at)}` : ""}
        </span>
        {["sending", "paused", "sent"].includes(b.status) && total > 0 ? (
          <span className="flex items-center gap-3" aria-label={`${done}% sent`}>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-strong">
              <span className="block h-full rounded-full bg-flame" style={{ width: `${done}%` }} />
            </span>
            <span className="t-small tabular-nums text-soft">
              {b.sent.toLocaleString("en")} / {total.toLocaleString("en")}
            </span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export default async function AnnouncementsPage() {
  const session = await requireRole(ANNOUNCE_VIEW_ROLES, "/admin/announcements");
  const supabase = await createClient();
  const canWrite = hasAnyRole(session.roles, ANNOUNCE_ROLES);
  const canApprove = hasAnyRole(session.roles, APPROVE_ROLES);
  const [rows, waiting] = await Promise.all([loadBroadcasts(supabase), canApprove ? loadApprovals(supabase) : Promise.resolve([])]);
  const toApprove = waiting.filter((w) => !w.mine);
  const active = rows.filter((r) => ["draft", "rejected", "awaiting_approval", "scheduled", "sending", "paused"].includes(r.status));
  const past = rows.filter((r) => ["sent", "cancelled"].includes(r.status));

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Announcements">
        Write to members from live records: people who started the form, finished it, joined a tribe and more. We leave out anyone who asked not to hear from us, and the young people’s track,
        automatically.
      </PageHead>

      <div className="flex flex-wrap gap-3">
        {canWrite ? (
          <Link href="/admin/announcements/new" className={buttonClasses({ size: "md" })}>
            <span className="relative">Write an announcement</span>
          </Link>
        ) : null}
        {canApprove ? (
          <Link href="/admin/announcements/approvals" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Waiting for approval{toApprove.length > 0 ? ` (${toApprove.length})` : ""}</span>
          </Link>
        ) : null}
        {hasAnyRole(session.roles, ["admin", "director", "pastor", "data_lead"]) ? (
          <Link href="/admin/reminders" className={buttonClasses({ variant: "ghost", size: "md" })}>
            <span className="relative">Automatic reminders</span>
          </Link>
        ) : null}
      </div>

      {toApprove.length > 0 ? (
        <p role="note" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3">
          {toApprove.length === 1 ? "An announcement is" : `${toApprove.length} announcements are`} waiting for you to read and approve.{" "}
          <Link href="/admin/announcements/approvals" className="font-semibold underline underline-offset-4">
            Open
          </Link>
        </p>
      ) : null}

      <section aria-labelledby="active-heading" className="flex flex-col gap-3">
        <h2 id="active-heading" className="t-heading">
          In progress
        </h2>
        {active.length > 0 ? (
          <ul className="flex flex-col gap-3">{active.map((b) => <Row key={b.id} b={b} />)}</ul>
        ) : (
          <p className="card t-body p-5 text-soft">Nothing in progress. {canWrite ? "Write one when you have something to say." : ""}</p>
        )}
      </section>

      {past.length > 0 ? (
        <section aria-labelledby="past-heading" className="flex flex-col gap-3">
          <h2 id="past-heading" className="t-heading">
            Sent
          </h2>
          <ul className="flex flex-col gap-3">{past.map((b) => <Row key={b.id} b={b} />)}</ul>
        </section>
      ) : null}
    </div>
  );
}
