import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DeclarationForm } from "@/components/academy/DeclarationForm";
import { requireRole } from "@/lib/auth/session";
import { loadMyAcademy } from "@/lib/academy/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Safeguarding declaration" };

export default async function DeclarationPage() {
  const session = await requireRole(["leader", "assistant_leader"], "/lead/academy/declaration");
  const supabase = await createClient();
  const my = await loadMyAcademy(supabase);
  if (!my) redirect("/lead/academy");
  const careModule = my.modules.find((m) => m.slug === "care-and-safeguarding");
  const unlocked = careModule?.passed === true;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/lead/academy" className="press -ml-1 w-fit rounded-lg px-1 py-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← Training
        </Link>
        <h1 className="t-title">Safeguarding declaration</h1>
        <p className="t-body measure text-soft">
          Eight promises you make to the people in your Tribe and to the church. Read them slowly. Signing is part of becoming certified.
        </p>
      </header>
      {unlocked || my.declaration ? (
        <DeclarationForm signed={my.declaration} defaultName={session.person.fullName ?? ""} />
      ) : (
        <section className="card flex flex-col gap-3 p-6">
          <h2 className="t-heading">First, the care and safeguarding module</h2>
          <p className="t-body measure text-soft">The declaration makes sense once you have been through the lesson and the quiz. It opens as soon as you pass.</p>
          <div>
            <Link href="/lead/academy/care-and-safeguarding" className="font-semibold underline underline-offset-4">
              Open the module
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
