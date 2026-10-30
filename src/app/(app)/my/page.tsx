import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { MyDetails } from "@/components/profile/MyDetails";
import { MyFacts } from "@/components/profile/MyFacts";
import { MyPanels } from "@/components/profile/MyPanels";
import { OfficeAskCard } from "@/components/profile/OfficeAskCard";
import { requireSession } from "@/lib/auth/session";
import { NumberNotice } from "@/components/profile/NumberNotice";
import { loadNumberRule } from "@/lib/messaging/number-rule-server";
import { loadMyPage } from "@/lib/profile/server";
import { DETAILS_HEADING, DETAILS_LINE, PANELS_HEADING, STORY_HEADING, STORY_LINE } from "@/lib/profile/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My page" };

/**
 * My page: what the church holds about you that only you can confirm, the few details you type yourself, your own story, and one short panel for each role
 * you hold. Each part appears only while its own function is On for the person. While My page is Off for a person this page does not exist for them (the
 * database answers "not enabled" and the page is a plain not-found, exactly as before it was built).
 */
export default async function MyPage() {
  await requireSession("/my");
  const supabase = await createClient();
  const page = await loadMyPage(supabase);
  if (!page.enabled) notFound();
  // The compulsory phone number: the prompt for a member with none, and the note when the sign-in number and the contact number differ
  const numberRule = await loadNumberRule(supabase);
  const nothing = page.facts.length === 0 && page.details.length === 0 && page.story.length === 0 && page.panels.length === 0 && !page.canAsk;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">{page.first ? `${page.first}, this is your page.` : "Your page."}</h1>
        <p className="t-body measure text-soft">These are details the church holds that only you can confirm. Nothing changes until you press a button, and a change that touches others is looked at by a pastor first.</p>
      </header>
      <NumberNotice rule={numberRule} />
      {page.facts.length > 0 ? <MyFacts facts={page.facts} /> : null}
      {page.details.length > 0 ? (
        <Part id="details" heading={DETAILS_HEADING} line={DETAILS_LINE}>
          <MyDetails items={page.details} testPrefix="details" />
        </Part>
      ) : null}
      {page.story.length > 0 ? (
        <Part id="story" heading={STORY_HEADING} line={STORY_LINE}>
          <MyDetails items={page.story} testPrefix="story" />
        </Part>
      ) : null}
      {page.panels.length > 0 ? (
        <Part id="panels" heading={PANELS_HEADING}>
          <MyPanels panels={page.panels} />
        </Part>
      ) : null}
      {page.canAsk ? <OfficeAskCard office={page.office} /> : null}
      {nothing ? <p className="card t-body p-5 text-soft">There is nothing for you to check right now.</p> : null}
    </div>
  );
}

function Part({ id, heading, line, children }: { id: string; heading: string; line?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`part-${id}-h`} className="flex flex-col gap-4" data-testid={`my-part-${id}`}>
      <div className="flex flex-col gap-1">
        <h2 id={`part-${id}-h`} className="t-heading">
          {heading}
        </h2>
        {line ? <p className="t-body measure text-soft">{line}</p> : null}
      </div>
      {children}
    </section>
  );
}
