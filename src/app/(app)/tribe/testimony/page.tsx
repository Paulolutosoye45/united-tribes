import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TestimonyForm } from "@/components/rhythm/TestimonyForm";
import { requireSession } from "@/lib/auth/session";
import { loadMyWeek, loadTestimonies } from "@/lib/rhythm/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Testimonies" };

export default async function TestimonyPage() {
  await requireSession("/tribe/testimony");
  const supabase = await createClient();
  const week = await loadMyWeek(supabase);
  if (!week.placed || week.state === "before") redirect("/tribe");
  const testimonies = await loadTestimonies(supabase);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/tribe" className="press -ml-1 w-fit rounded-lg px-1 py-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← My tribe
        </Link>
        <h1 className="t-title">Testimonies</h1>
        <p className="t-body measure text-soft">
          Telling what God has done encourages everyone. Your leader reads it first, and nothing is shown to anyone until they have. You choose who may read it and whether your name shows.
        </p>
      </header>
      <TestimonyForm testimonies={testimonies} />
      <p className="t-body text-soft">
        Want to be encouraged?{" "}
        <Link href="/testimonies" className="font-semibold text-ink underline underline-offset-4">
          Read what God is doing across the church.
        </Link>
      </p>
    </div>
  );
}
