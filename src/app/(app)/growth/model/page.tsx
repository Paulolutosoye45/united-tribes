import type { Metadata } from "next";
import { ModelBoard } from "@/components/growth/ModelBoard";
import { MODEL_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadModels, loadRetrainPreview } from "@/lib/growth/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Matching model" };

export default async function ModelPage() {
  const session = await requireRole(MODEL_ROLES, "/growth/model");
  const supabase = await createClient();
  // A pastor reads the versions, but only the admin, directors and the data lead see what would be learned.
  const canPreview = hasAnyRole(session.roles, ["admin", "director", "data_lead"]);
  const canChange = hasAnyRole(session.roles, ["admin", "director"]);

  const [models, preview] = await Promise.all([loadModels(supabase), canPreview ? loadRetrainPreview(supabase) : Promise.resolve(null)]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Matching model</h1>
        <p className="t-body measure text-soft">
          The weights decide how much each part of a member&rsquo;s answers counts toward their Degree of Compatibility. After enough seasons, they can be nudged
          toward what the results show: which kinds of fit went with members who thrived. A new version is made switched off, and nobody&rsquo;s matches change until it is
          switched on.
        </p>
      </header>
      <ModelBoard models={models} preview={preview} canChange={canChange} canPreview={canPreview} />
    </div>
  );
}
