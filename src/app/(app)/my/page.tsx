import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MyFacts } from "@/components/profile/MyFacts";
import { requireSession } from "@/lib/auth/session";
import { loadMyPage } from "@/lib/profile/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My page" };

/**
 * My page: what the church holds about you that only you can confirm. The first layer, for leaders. While the function is Off for a person
 * this page does not exist for them (the database answers "not enabled" and the page is a plain not-found, exactly as before it was built).
 */
export default async function MyPage() {
  await requireSession("/my");
  const page = await loadMyPage(await createClient());
  if (!page.enabled) notFound();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">{page.first ? `${page.first}, this is your page.` : "Your page."}</h1>
        <p className="t-body measure text-soft">These are details the church holds that only you can confirm. Nothing changes until you press a button, and a change that touches others is looked at by a pastor first.</p>
      </header>
      {page.facts.length > 0 ? <MyFacts facts={page.facts} /> : <p className="card t-body p-5 text-soft">There is nothing for you to check right now.</p>}
    </div>
  );
}
