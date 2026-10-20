import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DeclarationForm } from "@/components/academy/DeclarationForm";
import { requireRole } from "@/lib/auth/session";
import { SwitchedOff } from "@/components/academy/SwitchedOff";
import { parseAcademyModes } from "@/lib/academy/modes";
import { loadMyAcademy } from "@/lib/academy/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Safeguarding declaration" };

export default async function DeclarationPage() {
  const session = await requireRole(["leader", "assistant_leader"], "/lead/academy/declaration");
  const supabase = await createClient();
  const my = await loadMyAcademy(supabase);
  if (!my) redirect("/lead/academy");
  const modes = parseAcademyModes(my.modes);
  const careModule = my.modules.find((m) => m.slug === "care-and-safeguarding");
  // The care and safeguarding module comes first only when the Academy is required. Otherwise the declaration can be signed now.
  const unlocked = modes.academy !== "required" || careModule?.passed === true;
  const off = modes.declaration === "off";

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/lead/academy" className="press -ml-1 inline-flex min-h-10 w-fit items-center rounded-lg px-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← Training
        </Link>
        <h1 className="t-title">Safeguarding declaration</h1>
        <p className="t-body measure text-soft">
          {off
            ? "Eight promises you make to the people in your tribe and to the church."
            : "Eight promises you make to the people in your tribe and to the church. Read them slowly. Signing is part of becoming certified."}
        </p>
      </header>
      {off && !my.declaration ? (
        <SwitchedOff title="The declaration is not being asked for right now" since={modes.declarationSince} testId="declaration-off">
          Nothing needs signing at the moment. If the church asks for it again, you will find it here.
        </SwitchedOff>
      ) : unlocked || my.declaration ? (
        <DeclarationForm signed={my.declaration} defaultName={session.person.fullName ?? ""} />
      ) : (
        <section className="card flex flex-col gap-3 p-6">
          <h2 className="t-heading">First, the care and safeguarding module</h2>
          <p className="t-body measure text-soft">The declaration makes sense once you have been through the lesson and the quiz. It opens as soon as you pass.</p>
          <div>
            <Link href="/lead/academy/care-and-safeguarding" className="inline-flex min-h-10 items-center font-semibold underline underline-offset-4">
              Open the module
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
