import type { Metadata } from "next";
import { PageHead } from "@/components/admin/PageHead";
import { CentreForm, SettingsForm } from "@/components/admin/SettingsForm";
import { Badge } from "@/components/ui/Badge";
import { OFFICE_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadChurchSettings, loadMyCentres, loadPlatformStatus } from "@/lib/admin/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

const FLAG_NAMES: Record<string, string> = {
  multi_centre: "More than one centre",
  teen_track: "Tribes for ages 13 to 17",
};

export default async function SettingsPage() {
  const session = await requireRole(OFFICE_ROLES, "/admin/settings");
  const supabase = await createClient();
  const [settings, status, centres] = await Promise.all([loadChurchSettings(supabase), loadPlatformStatus(supabase), loadMyCentres(supabase)]);

  return (
    <div className="flex flex-col gap-12">
      <PageHead title="Settings">The church&rsquo;s own words, where testimonies go, and the switches that keep unfinished parts of the platform closed.</PageHead>

      <section aria-labelledby="words-heading" className="flex flex-col gap-4">
        <h2 id="words-heading" className="t-heading">
          The church&rsquo;s words
        </h2>
        {settings ? <SettingsForm settings={settings} /> : <p className="card t-body p-6 text-soft">We couldn’t load these. Try again in a moment.</p>}
      </section>

      <section aria-labelledby="switches-heading" className="flex flex-col gap-4">
        <h2 id="switches-heading" className="t-heading">
          Platform switches
        </h2>
        <p className="t-body measure text-soft">
          These stay off until the work behind them is finished. Only whoever manages the database can turn one on, so nobody opens something by accident. Each has a guide that says what must be true first.
        </p>
        <ul className="card flex flex-col divide-y divide-line p-0">
          {(status?.flags ?? []).map((f) => (
            <li key={f.key} className="flex flex-col gap-1 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{FLAG_NAMES[f.key] ?? f.key}</span>
                <Badge tone={f.enabled ? "gold" : "outline"}>{f.enabled ? "On" : "Off"}</Badge>
              </div>
              {f.note ? <p className="t-small text-soft">{f.note}</p> : null}
            </li>
          ))}
          {status === null ? <li className="px-5 py-4 text-soft">We couldn’t load the switches.</li> : null}
        </ul>
      </section>

      {centres ? (
        <section aria-labelledby="centres-heading" className="flex flex-col gap-4">
          <h2 id="centres-heading" className="t-heading">
            Centres
          </h2>
          <ul className="card flex flex-col divide-y divide-line p-0">
            {centres.centres.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                <span className="font-medium">{c.name}</span>
                <span className="flex items-center gap-2">
                  {centres.current?.id === c.id ? <Badge tone="gold">You are here</Badge> : null}
                  {c.active ? null : <Badge tone="outline">Closed</Badge>}
                </span>
              </li>
            ))}
          </ul>
          {centres.multi && hasAnyRole(session.roles, ["admin"]) ? <CentreForm /> : null}
          {centres.multi ? null : <p className="t-small text-soft">There is one centre. Opening more is behind a switch, and some office lists still show every centre together: see docs/MULTI-CENTRE.md.</p>}
        </section>
      ) : null}
    </div>
  );
}
