import type { Metadata } from "next";
import { PageHead } from "@/components/admin/PageHead";
import { SignInActivity } from "@/components/admin/SignInActivity";
import { SignInControls } from "@/components/admin/SignInControls";
import { SignInLimits } from "@/components/admin/SignInLimits";
import { SIGNIN_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { currentChannel } from "@/lib/signin/deps";
import { readOverview } from "@/lib/signin/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "WhatsApp sign-in" };

export default async function SignInAdminPage() {
  await requireRole(SIGNIN_ROLES, "/admin/signin");
  const supabase = await createClient();
  const [overview, channel] = await Promise.all([supabase.rpc("signin_admin_overview"), currentChannel()]);
  const data = readOverview(overview.data);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="WhatsApp sign-in">
        Whether people can get their sign-in code on WhatsApp, how many codes may go out, and what happens if something looks wrong. Email codes are never affected by anything on this page.
      </PageHead>
      {data ? (
        <>
          <SignInControls overview={data} setup={{ configured: channel.available, number: channel.number }} />
          <SignInLimits overview={data} />
          <SignInActivity overview={data} />
        </>
      ) : (
        <p className="card t-body p-6 text-soft">We couldn’t load this screen. The WhatsApp sign-in database changes may not be applied yet. Try again in a moment.</p>
      )}
    </div>
  );
}
