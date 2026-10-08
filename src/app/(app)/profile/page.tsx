import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAnswers } from "@/components/profile/DeleteAnswers";
import { Button, buttonClasses } from "@/components/ui/Button";
import { WhatsAppSignInCard } from "@/components/profile/WhatsAppSignInCard";
import { providerFromEnv } from "@/lib/ai/suggest";
import { requireSession } from "@/lib/auth/session";
import { formatShortDate } from "@/lib/dates";
import { whatsappSignInEnabled } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { setAssistantAction, stopWhatsappAction } from "./actions";

export const metadata: Metadata = { title: "Privacy and my data" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const session = await requireSession("/profile");
  const { deleted } = await searchParams;
  const supabase = await createClient();

  const [profile, draft, ai, whatsapp] = await Promise.all([
    supabase.from("member_profiles").select("submitted_at, whatsapp").eq("person_id", session.person.id).maybeSingle(),
    supabase.from("intake_drafts").select("updated_at").eq("person_id", session.person.id).maybeSingle(),
    supabase.rpc("has_consent", { p_purpose: "ai_assist" }),
    supabase.rpc("has_consent", { p_purpose: "whatsapp" }),
  ]);
  const aiOn = ai.data === true;
  const aiAvailable = providerFromEnv() !== null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Privacy and my data</h1>
        <p className="t-body measure text-soft">
          You decide how your answers are used. Everything here takes effect straight away.
        </p>
      </header>

      {deleted ? (
        <p role="status" className="pop-in rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium">
          Your answers have been deleted.
        </p>
      ) : null}

      <section aria-labelledby="answers-heading" className="flex flex-col gap-4">
        <h2 id="answers-heading" className="t-heading">
          Your answers
        </h2>
        <div className="card flex flex-col gap-4 p-5 sm:p-6">
          {profile.data ? (
            <>
              <p>
                Saved on <strong>{formatShortDate(profile.data.submitted_at)}</strong>. Only you can see them today.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/join?edit=1" className={buttonClasses({ variant: "quiet", size: "md" })}>
                  <span className="relative">Change my answers</span>
                </Link>
                <DeleteAnswers />
              </div>
            </>
          ) : draft.data ? (
            <>
              <p>You have a form in progress. Nothing is shared until you finish.</p>
              <div className="flex flex-wrap gap-3">
                <Link href="/join" className={buttonClasses({ size: "md" })}>
                  <span className="relative">Continue the form</span>
                </Link>
                <DeleteAnswers />
              </div>
            </>
          ) : (
            <>
              <p className="text-soft">We don’t hold any answers from you yet.</p>
              <Link href="/join" className={buttonClasses({ size: "md", className: "w-fit" })}>
                <span className="relative">Find my circle</span>
              </Link>
            </>
          )}
        </div>
      </section>

      {whatsappSignInEnabled() ? <WhatsAppSignInCard linked={session.signInPhone} /> : null}

      <section aria-labelledby="choices-heading" className="flex flex-col gap-4">
        <h2 id="choices-heading" className="t-heading">
          Your choices
        </h2>
        <ul className="card divide-y divide-line">
          {aiAvailable ? (
            <li className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="max-w-[52ch]">
                <p className="font-semibold">Suggestions from an AI assistant</p>
                <p className="t-small text-soft">
                  When on, a sentence you write about your season is read by an AI service to suggest a tribe and goal.
                  Contact details are removed first and nothing else is shared. Currently <strong>{aiOn ? "on" : "off"}</strong>.
                </p>
              </div>
              <form action={setAssistantAction}>
                <input type="hidden" name="granted" value={aiOn ? "no" : "yes"} />
                <Button type="submit" variant="quiet" size="md">
                  {aiOn ? "Turn off" : "Turn on"}
                </Button>
              </form>
            </li>
          ) : null}
          <li className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="max-w-[52ch]">
              <p className="font-semibold">WhatsApp reminders</p>
              <p className="t-small text-soft">
                {whatsapp.data === true && profile.data?.whatsapp
                  ? "You’ve allowed WhatsApp messages about your circle."
                  : "You haven’t allowed WhatsApp messages. Add a number in the form if you’d like reminders."}
              </p>
            </div>
            {whatsapp.data === true && profile.data?.whatsapp ? (
              <form action={stopWhatsappAction}>
                <Button type="submit" variant="quiet" size="md">
                  Stop messages
                </Button>
              </form>
            ) : null}
          </li>
        </ul>
        <p className="t-small text-soft">
          Read the full <Link href="/privacy" className="font-semibold text-ink underline underline-offset-4">privacy notice</Link>.
        </p>
      </section>
    </div>
  );
}
