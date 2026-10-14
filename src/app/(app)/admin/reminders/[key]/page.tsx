import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/admin/PageHead";
import { ChatButton } from "@/components/outreach/ChatButton";
import { JourneyEditor } from "@/components/outreach/JourneyEditor";
import { REMINDER_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { JOURNEYS } from "@/lib/outreach/labels";
import { loadJourneyPeople, loadReminders } from "@/lib/outreach/server";
import { siteUrl } from "@/lib/messaging/worker";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "A reminder journey" };

export default async function JourneyPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!JOURNEYS[key]) notFound();
  await requireRole(REMINDER_ROLES, `/admin/reminders/${key}`);
  const supabase = await createClient();
  const o = await loadReminders(supabase);
  const j = o?.journeys.find((x) => x.key === key);
  if (!o || !j) notFound();
  const people = o.can_see_people ? await loadJourneyPeople(supabase, key) : [];

  return (
    <div className="flex flex-col gap-10">
      <PageHead title={JOURNEYS[key].title} back={{ href: "/admin/reminders", label: "Automatic reminders" }}>
        {JOURNEYS[key].who} It stops as soon as: {JOURNEYS[key].stops.toLowerCase()} The condition is checked again just before every email.
      </PageHead>
      <JourneyEditor j={j} site={siteUrl()} church={{ name: o.settings.church_name, address: o.settings.church_address }} canChange={o.can_change} canEdit={o.can_edit_words} canApprove={o.can_approve_words} />

      {o.can_see_people ? (
        <section aria-labelledby="people-heading" className="flex flex-col gap-3">
          <h2 id="people-heading" className="t-heading">
            People in this journey
          </h2>
          <p className="t-small text-soft">Names only. You can message someone on WhatsApp if they said yes to it and you are their contact. We note that a chat was opened, never what was said.</p>
          {people.length > 0 ? (
            <ul className="card divide-y divide-line">
              {people.map((p) => (
                <li key={`${p.person_id}-${p.started_at}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="flex flex-col">
                    <span className="font-semibold">
                      {p.name} {p.rehearsal ? <span className="t-small font-normal text-soft">(rehearsal)</span> : null}
                      {p.holdout ? <span className="t-small font-normal text-soft"> (left alone on purpose)</span> : null}
                    </span>
                    <span className="t-small text-soft">
                      {p.step_done} of 4 sent
                      {p.next_due && !p.holdout ? ` · next ${new Date(p.next_due).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                    </span>
                  </span>
                  {p.can_chat ? <ChatButton person={p.person_id} context={key} name={p.name} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="card t-body p-5 text-soft">Nobody is in this journey right now.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
