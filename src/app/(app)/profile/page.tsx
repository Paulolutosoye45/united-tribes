import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAnswers } from "@/components/profile/DeleteAnswers";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ContactCard } from "@/components/profile/ContactCard";
import { PhotoCard } from "@/components/profile/PhotoCard";
import { YourData } from "@/components/profile/YourData";
import { EmailSwitches } from "@/components/profile/EmailSwitches";
import { WhatsAppSignInCard } from "@/components/profile/WhatsAppSignInCard";
import { MyNotices } from "@/components/profile/MyNotices";
import { loadMyNoticePrefs } from "@/lib/admin/notices-server";
import { loadMySwitches } from "@/lib/outreach/server";
import { providerFromEnv } from "@/lib/ai/suggest";
import { requireSession } from "@/lib/auth/session";
import { hasAnyRole } from "@/lib/auth/roles";
import { formatShortDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { readContact } from "@/lib/messaging/contact";
import { loadReach } from "@/lib/contact-gaps/server";
import { loadNumberRule } from "@/lib/messaging/number-rule-server";
import { NumberNotice } from "@/components/profile/NumberNotice";
import { ReachNotice } from "@/components/profile/ReachNotice";
import { readMyRequest } from "@/lib/privacy/wording";
import { currentChannel } from "@/lib/signin/deps";
import { setAssistantAction } from "./actions";

export const metadata: Metadata = { title: "Privacy and my data" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const session = await requireSession("/profile");
  const { deleted } = await searchParams;
  const supabase = await createClient();
  const signInChannel = await currentChannel();

  const leads = hasAnyRole(session.roles, ["leader", "assistant_leader", "coach"]);
  const staff = hasAnyRole(session.roles, ["admin", "pastor", "director", "care_lead", "coach"]);
  const [profile, draft, ai, contactRow, photoRow, erasure, switches, noticePrefs, numberRule, reach] = await Promise.all([
    supabase.from("member_profiles").select("submitted_at").eq("person_id", session.person.id).maybeSingle(),
    supabase.from("intake_drafts").select("updated_at").eq("person_id", session.person.id).maybeSingle(),
    supabase.rpc("has_consent", { p_purpose: "ai_assist" }),
    supabase.rpc("my_contact"),
    leads ? supabase.rpc("my_photo_info") : Promise.resolve({ data: null }),
    supabase.rpc("my_erasure_request"),
    loadMySwitches(supabase),
    staff ? loadMyNoticePrefs() : Promise.resolve([]),
    // The compulsory phone number: Off (or not in the database yet), nothing here changes
    loadNumberRule(supabase),
    // How a leader can reach this person: the prompt and the sign-in number offer. Off (or not in the database yet), nothing here changes
    loadReach(supabase),
  ]);
  const photo = (photoRow.data as { has?: boolean; updated_at?: string | null } | null) ?? null;
  const contact = readContact(contactRow.data);
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
                <span className="relative">Find my tribe</span>
              </Link>
            </>
          )}
        </div>
      </section>

      {signInChannel.available ? <WhatsAppSignInCard linked={session.signInPhone} channel={signInChannel} /> : null}

      <section id="contact" aria-labelledby="contact-heading" className="flex flex-col gap-4">
        <h2 id="contact-heading" className="t-heading">
          How we reach you
        </h2>
        <NumberNotice rule={numberRule} here="profile" />
        <ReachNotice reach={reach} numberPromptShown={numberRule.prompt} here="profile" />
        <ContactCard contact={contact} numberRequired={numberRule.required} reach={reach} />
      </section>

      {switches ? (
        <section aria-labelledby="email-heading" className="flex flex-col gap-4">
          <h2 id="email-heading" className="t-heading">
            Emails from us
          </h2>
          <EmailSwitches initial={switches} />
        </section>
      ) : null}

      {noticePrefs.length > 0 ? (
        <section aria-labelledby="notices-heading" className="flex flex-col gap-4">
          <h2 id="notices-heading" className="t-heading">
            My notices
          </h2>
          <MyNotices prefs={noticePrefs} />
        </section>
      ) : null}

      {leads ? (
        <section aria-labelledby="photo-heading" className="flex flex-col gap-4">
          <h2 id="photo-heading" className="t-heading">
            Your photo
          </h2>
          <PhotoCard personId={session.person.id} name={session.person.preferredName ?? session.person.fullName ?? "You"} has={Boolean(photo?.has)} updatedAt={photo?.updated_at ?? null} />
        </section>
      ) : null}

      <section aria-labelledby="data-heading" className="flex flex-col gap-4">
        <h2 id="data-heading" className="t-heading">
          Your data
        </h2>
        <YourData request={readMyRequest(erasure.data)} />
      </section>

      <section aria-labelledby="choices-heading" className="flex flex-col gap-4">
        {aiAvailable ? (
          <>
            <h2 id="choices-heading" className="t-heading">
              Your choices
            </h2>
            <ul className="card divide-y divide-line">
              <li className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="max-w-[52ch]">
                  <p className="font-semibold">Suggestions from an AI assistant</p>
                  <p className="t-small text-soft">
                    When on, a sentence you write about your season is read by an AI service to suggest a community and goal.
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
            </ul>
          </>
        ) : null}
        <p className="t-small text-soft">
          Read the full <Link href="/privacy" className="font-semibold text-ink underline underline-offset-4">privacy notice</Link>.
        </p>
      </section>
    </div>
  );
}
