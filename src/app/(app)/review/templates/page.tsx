import type { Metadata } from "next";
import { TemplateBoard } from "@/components/cards/TemplateBoard";
import { ReviewTabs } from "@/components/leaders/ReviewTabs";
import { TEMPLATE_SIGN_ROLES, TEMPLATE_VIEW_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { parseTemplateList } from "@/lib/cards/templates";
import { loadLeaderCatalogue } from "@/lib/leaders/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review: Ready-made cards" };

export default async function ReviewTemplatesPage() {
  const session = await requireRole(TEMPLATE_VIEW_ROLES, "/review/templates");
  const supabase = await createClient();
  const [raw, catalogue] = await Promise.all([supabase.rpc("card_template_list"), loadLeaderCatalogue(supabase, { includeRetired: true })]);
  const list = raw.error ? null : parseTemplateList(raw.data);
  const canSign = hasAnyRole(session.roles, TEMPLATE_SIGN_ROLES);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="t-title">Review leaders</h1>
          <p className="t-body measure text-soft">
            Every goal a leader can run has a ready-made card: who it is for, the three Success Picture lines, the weekly ideas, a guardrail, and a hidden note on what it asks of its leader. Nothing is live until a pastor or director signs it off. Sign off a community at a time, and read the sensitive ones one by one.
          </p>
        </div>
        <ReviewTabs />
      </header>
      {list ? (
        <TemplateBoard list={list} tracks={catalogue.tracks.map((t) => ({ slug: t.slug, name: t.name }))} canEdit canSign={canSign} />
      ) : (
        <p className="card t-body p-6 text-soft">We could not read the cards just now. Try the page again in a moment.</p>
      )}
    </div>
  );
}
