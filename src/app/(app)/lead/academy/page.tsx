import type { Metadata } from "next";
import Link from "next/link";
import { Checklist } from "@/components/academy/Checklist";
import { SwitchedOff } from "@/components/academy/SwitchedOff";
import { ModuleGrid } from "@/components/academy/ModuleGrid";
import { PracticeCard } from "@/components/academy/PracticeCard";
import { TrainingHero } from "@/components/academy/TrainingHero";
import { Workshops } from "@/components/academy/Workshops";
import { loadChurchSettings } from "@/lib/admin/server";
import { requireRole } from "@/lib/auth/session";
import { academyOpen, parseAcademyModes, trainingShown } from "@/lib/academy/modes";
import { loadMyAcademy } from "@/lib/academy/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leader Academy" };

export default async function AcademyPage() {
  await requireRole(["leader", "assistant_leader"], "/lead/academy");
  const supabase = await createClient();
  const [my, words] = await Promise.all([loadMyAcademy(supabase), loadChurchSettings(supabase)]);
  if (!my) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="t-title">Leader Academy</h1>
        <p className="t-body measure text-soft">We couldn’t load your training. Check your connection and refresh.</p>
      </div>
    );
  }

  const modes = parseAcademyModes(my.modes);
  const back = (
    <Link href="/lead" className="press -mb-4 -ml-1 inline-flex min-h-10 w-fit items-center rounded-lg px-1 text-[0.95rem] font-medium text-soft hover:text-ink">
      ← Lead a tribe
    </Link>
  );

  // Both switched off: there is no training to show. What there is, the notice says.
  if (!trainingShown(modes)) {
    return (
      <div className="flex flex-col gap-8">
        {back}
        <h1 className="t-title">Leader Academy</h1>
        <SwitchedOff title="The Academy is switched off" since={modes.academySince}>
          There are no modules, workshops or declaration to do right now. Anything you have already done is kept.
        </SwitchedOff>
      </div>
    );
  }

  // The Academy off, the declaration still asked for: the declaration is the only training there is.
  if (!academyOpen(modes)) {
    return (
      <div className="flex flex-col gap-8">
        {back}
        <TrainingHero my={my} />
        <SwitchedOff title="The Academy is switched off" since={modes.academySince}>
          The modules, workshops and practice session are closed for now, and certification does not need them. Anything you have already done is kept.
        </SwitchedOff>
        <Checklist my={my} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {back}
      <TrainingHero my={my} />
      {words?.vision || words?.mission ? (
        <section aria-labelledby="church-words" className="card flex flex-col gap-4 p-5 sm:p-6">
          <h2 id="church-words" className="t-heading">
            In the church’s own words
          </h2>
          <dl className="grid gap-5 sm:grid-cols-2">
            {words.vision ? (
              <div className="flex flex-col gap-1">
                <dt className="t-small font-semibold text-soft">Vision</dt>
                <dd className="t-body measure whitespace-pre-line">{words.vision}</dd>
              </div>
            ) : null}
            {words.mission ? (
              <div className="flex flex-col gap-1">
                <dt className="t-small font-semibold text-soft">Mission</dt>
                <dd className="t-body measure whitespace-pre-line">{words.mission}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[1fr_1.15fr] lg:items-start">
        <Checklist my={my} />
        <PracticeCard my={my} optional={modes.academy === "optional"} />
      </div>
      <ModuleGrid modules={my.modules} optional={modes.academy === "optional"} />
      <Workshops sessions={my.sessions} attended={my.attended} optional={modes.academy === "optional"} />
    </div>
  );
}
