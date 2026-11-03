import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/admin/PageHead";
import { ApproveControls, SendControls } from "@/components/outreach/AnnouncementActions";
import { Composer } from "@/components/outreach/Composer";
import { EmailFrame } from "@/components/outreach/EmailFrame";
import { Results } from "@/components/outreach/Results";
import { StatusBadge } from "@/components/outreach/StatusBadge";
import { ANNOUNCE_ROLES, ANNOUNCE_VIEW_ROLES, APPROVE_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadContactGapsOn } from "@/lib/contact-gaps/server";
import { isUuid } from "@/lib/leaders/errors";
import { announcementSpec } from "@/lib/outreach/compose";
import { loadAnnounceContext, loadBroadcast, loadResults } from "@/lib/outreach/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Announcement" };

const stamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" }) : "";

export default async function AnnouncementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { id } = await params;
  const { sent } = await searchParams;
  if (!isUuid(id)) notFound();
  const session = await requireRole(ANNOUNCE_VIEW_ROLES, `/admin/announcements/${id}`);
  const supabase = await createClient();
  const b = await loadBroadcast(supabase, id);
  if (!b) notFound();

  const canWrite = hasAnyRole(session.roles, ANNOUNCE_ROLES);
  const canApprove = hasAnyRole(session.roles, APPROVE_ROLES);
  const ctx = await loadAnnounceContext(supabase, session);

  // A draft, or one sent back, is still a draft: back into the composer.
  if ((b.status === "draft" || b.status === "rejected") && canWrite) {
    return (
      <div className="flex flex-col gap-8">
        <PageHead title={b.title} back={{ href: "/admin/announcements", label: "Announcements" }}>
          {b.status === "rejected" ? <span className="block rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 text-ink">Sent back{b.reject_note ? `: “${b.reject_note}”` : "."} Change it and send it again.</span> : "A draft. Nothing has been sent."}
        </PageHead>
        <Composer
          initial={b}
          saved={ctx.saved}
          communities={ctx.communities}
          champion={ctx.champion}
          site={ctx.site}
          church={ctx.church}
          threshold={ctx.threshold}
          perMinute={ctx.perMinute}
          hours={ctx.hours}
          reach={await loadContactGapsOn(supabase)}
        />
      </div>
    );
  }

  const results = ["sending", "paused", "sent", "cancelled"].includes(b.status) ? await loadResults(supabase, id) : null;
  const spec = announcementSpec({ subject: b.subject, paragraphs: b.paragraphs, button_label: b.button_label, button_target: b.button_target }, { first_name: "Adaeze", tribe: "Builders Tribe", season_starts: "the start of the season", my_page: "/home" }, ctx.site, ctx.church);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title={b.title} back={{ href: "/admin/announcements", label: "Announcements" }}>
        <span className="flex flex-wrap items-center gap-3">
          <StatusBadge status={b.status} />
          <span>
            For {b.audience_label}
            {b.snapshot_count ? ` · ${b.snapshot_count.toLocaleString("en")} people` : ""} · by {b.created_by_me ? "you" : (b.created_by ?? "someone")}
          </span>
        </span>
      </PageHead>

      {sent === "awaiting_approval" ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium">
          Sent for approval. We have told the people who can approve it. Nothing goes out until someone other than you says yes.
        </p>
      ) : sent === "scheduled" ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium">
          Scheduled. It goes {stamp(b.scheduled_for)} Lagos time (or as soon after as the sending hours allow).
        </p>
      ) : null}

      {b.status === "awaiting_approval" ? (
        <section className="card flex flex-col gap-4 p-5" aria-labelledby="wait-heading">
          <h2 id="wait-heading" className="t-heading">
            Waiting for approval
          </h2>
          <p className="t-body text-soft">Because it goes to {(b.snapshot_count ?? 0).toLocaleString("en")} people, a second person has to read it first.</p>
          {canApprove ? <ApproveControls id={b.id} mine={b.created_by_me} /> : null}
          {canWrite ? <SendControls id={b.id} status={b.status} canControl={b.created_by_me || canApprove} /> : null}
        </section>
      ) : null}

      {["scheduled", "sending", "paused"].includes(b.status) ? (
        <section className="card flex flex-col gap-3 p-5" aria-labelledby="go-heading">
          <h2 id="go-heading" className="t-heading">
            {b.status === "paused" ? "Paused" : b.status === "sending" ? "Sending now" : "Scheduled"}
          </h2>
          <p className="t-small text-soft">
            {b.approved_by ? `Approved by ${b.approved_by}. ` : ""}
            {b.status === "scheduled" ? `Goes ${stamp(b.scheduled_for)}.` : "Sent a few hundred a minute, only during the sending hours."}
          </p>
          <SendControls id={b.id} status={b.status} canControl={canApprove || b.created_by_me} />
        </section>
      ) : null}

      {results ? <Results r={results} /> : null}

      <section aria-labelledby="words-heading" className="flex flex-col gap-3">
        <h2 id="words-heading" className="t-heading">
          What it says
        </h2>
        <EmailFrame spec={spec} />
      </section>
    </div>
  );
}
