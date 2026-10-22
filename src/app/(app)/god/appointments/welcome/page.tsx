import type { Metadata } from "next";
import { connection } from "next/server";
import { WelcomePanel } from "@/components/god/WelcomePanel";
import { AppointTabs } from "@/components/god/AppointTabs";
import { loadAcademyModes } from "@/lib/academy/server";
import { loadWelcomeSettings } from "@/lib/god/goal-unlock-server";
import { siteOrigin } from "@/lib/leaders/origin";
import { renderEmail } from "@/lib/messaging/render";
import { WELCOME_WORDING_VERSION } from "@/lib/messaging/templates-leader-welcome";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Welcome email" };

export default async function GodWelcomeEmailPage() {
  await connection();
  const supabase = await createClient();
  const [settings, modes, site] = await Promise.all([loadWelcomeSettings(supabase), loadAcademyModes(supabase), siteOrigin()]);

  // Both emails exactly as they would be written today, to a made-up leader, with the switchboard as it is now
  const previews = settings
    ? (["choose", "fixed"] as const).map((variant) => {
        const e = renderEmail(
          {
            id: "00000000-0000-4000-8000-000000000000",
            template: "leader_welcome",
            channel: "email",
            urgency: "normal",
            attempts: 1,
            reply_token: null,
            to: { email: "ada.example@example.org", phone: null, name: "Ada Example", first_name: "Ada" },
            params: {
              choose: variant === "choose",
              community_free: false,
              goal: "Build a steady client pipeline",
              community: "Business and entrepreneurship",
              academy: modes.academy,
              declaration: modes.declaration,
              signature_name: settings.name,
              signature_title: settings.title,
              version: WELCOME_WORDING_VERSION,
            },
          },
          site,
        );
        return { variant, subject: e.subject, html: e.html, text: e.text };
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Appointments</h1>
        <p className="t-body measure text-soft">
          The welcome email a leader can be sent when you appoint them, or when you let them choose their goal. It is signed by the pastor, so it goes out only once you have read it and said he has approved it.
        </p>
      </header>
      <AppointTabs current="welcome" />
      {settings ? (
        <WelcomePanel
          settings={settings}
          version={WELCOME_WORDING_VERSION}
          previews={previews}
          modes={{ academy: modes.academy, declaration: modes.declaration }}
        />
      ) : (
        <p className="card t-body p-5 text-soft">This page is not available right now. Reload it, or unlock the console again.</p>
      )}
    </div>
  );
}
