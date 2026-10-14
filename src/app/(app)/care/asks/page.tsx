import type { Metadata } from "next";
import { ChatButton } from "@/components/outreach/ChatButton";
import { PageHead } from "@/components/admin/PageHead";
import { AskDone } from "@/components/outreach/AskDone";
import { ASK_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { ASKS, JOURNEYS } from "@/lib/outreach/labels";
import { loadAsks } from "@/lib/outreach/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Asked for a person" };

export default async function AsksPage() {
  await requireRole(ASK_ROLES, "/care/asks");
  const supabase = await createClient();
  const rows = await loadAsks(supabase);
  const open = rows.filter((r) => r.status === "open");
  const closed = rows.filter((r) => r.status !== "open");
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Asked for a person" back={{ href: "/admin", label: "Admin" }}>
        These people answered a reminder email by asking for someone to reach out. Please contact each one personally within two days, kindly and without pressure.
      </PageHead>
      <section aria-labelledby="open-heading" className="flex flex-col gap-3">
        <h2 id="open-heading" className="t-heading">
          Waiting for someone
        </h2>
        {open.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {open.map((r) => (
              <li key={r.id} className="card flex flex-col gap-3 p-4" data-testid="ask-row">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">{r.name}</span>
                  <span className="t-small text-soft">
                    {ASKS[r.kind]?.label ?? r.kind}
                    {r.journey ? ` · after “${JOURNEYS[r.journey]?.short ?? r.journey}”` : ""} · {new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                </div>
                <div className="flex flex-wrap items-start gap-3">
                  {r.can_chat ? <ChatButton person={r.person_id} context={r.journey ?? "member_form"} name={r.name} /> : <p className="t-small text-soft">No WhatsApp consent: please phone, or ask their leader.</p>}
                  <AskDone id={r.id} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card t-body p-5 text-soft">Nobody is waiting. Good.</p>
        )}
      </section>
      {closed.length > 0 ? (
        <section aria-labelledby="done-heading" className="flex flex-col gap-3">
          <h2 id="done-heading" className="t-heading">
            Reached
          </h2>
          <ul className="card divide-y divide-line">
            {closed.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="t-small">
                  <strong>{r.name}</strong> · {ASKS[r.kind]?.label ?? r.kind}
                </span>
                <span className="t-small text-soft">{r.handled_by ? `by ${r.handled_by}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
