import type { Metadata } from "next";
import { CohortList } from "@/components/academy/CohortList";
import { SessionManager } from "@/components/academy/SessionManager";
import { SwitchedOff } from "@/components/academy/SwitchedOff";
import { PanelTabs } from "@/components/leaders/PanelTabs";
import { REVIEW_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadAcademyModes } from "@/lib/academy/server";
import type { CohortRow, SessionAdmin } from "@/lib/academy/types";
import { plural } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review: Academy" };

export default async function ReviewAcademyPage() {
  const session = await requireRole([...REVIEW_ROLES, "admin"], "/review/academy");
  const isPanel = hasAnyRole(session.roles, REVIEW_ROLES);
  const supabase = await createClient();
  const [cohort, sessions, modes] = await Promise.all([
    isPanel ? supabase.rpc("academy_cohort") : Promise.resolve({ data: [] }),
    supabase.rpc("academy_sessions_admin"),
    loadAcademyModes(supabase),
  ]);

  const rows = (cohort.data as CohortRow[] | null) ?? [];
  const list = (sessions.data as SessionAdmin[] | null) ?? [];
  const upcoming = list.filter((s) => !s.started);

  const tiles = [
    { label: "In training", value: String(rows.filter((r) => !r.state.certified).length), note: `${rows.length} approved in all` },
    { label: "Certified", value: String(rows.filter((r) => r.state.certified).length), note: `${rows.filter((r) => r.state.certified && r.role === "leader").length} tribe leaders` },
    modes.academy === "required"
      ? { label: "Ready for practice", value: String(rows.filter((r) => r.state.modules_done && !r.state.practice && !r.state.certified).length), note: "modules done, no practice yet" }
      : { label: "Academy", value: modes.academy === "off" ? "Off" : "Optional", note: "not needed for certification" },
    { label: "Workshops ahead", value: String(upcoming.length), note: plural(upcoming.reduce((n, s) => n + s.booked, 0), "booking") },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="t-title">Review leaders</h1>
          <p className="t-body measure text-soft">
            {modes.academy === "required" && modes.declaration === "required"
              ? "See where every approved leader stands on the four conditions for certification, run the workshop registers, and mark practice sessions ready."
              : "See where every approved leader stands on what certification needs, and run the workshop registers."}
          </p>
        </div>
        <PanelTabs />
      </header>

      {isPanel ? (
        <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t, i) => (
            <div key={t.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
              <dt className="t-small text-soft">{t.label}</dt>
              <dd className="t-figure !text-[clamp(2rem,9vw,3rem)]">{t.value}</dd>
              <dd className="t-small text-soft">{t.note}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {modes.academy === "off" ? (
        <SwitchedOff title="The Academy is switched off" since={modes.academySince}>
          Leaders cannot take the modules, book a workshop or be marked ready for practice, and certification does not need them. Everything already done is kept, and the workshop dates and registers below stay as they are.
        </SwitchedOff>
      ) : null}
      {isPanel ? <CohortList rows={rows} modes={modes} /> : null}
      <SessionManager sessions={list} canAdd={hasAnyRole(session.roles, ["admin", "director", "pastor"])} canMark={isPanel} />
    </div>
  );
}
